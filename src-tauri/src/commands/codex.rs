use crate::api::types::QuotaData;
use crate::codex;
use crate::codex::usage_to_quota_data;
use crate::db::models::Account;
use crate::db::Database;
use chrono::Utc;
use serde::Serialize;
use tauri::{Emitter, State};
use uuid::Uuid;

const GIST_URL_KEY: &str = "codex_gist_url";
const GITHUB_TOKEN_KEY: &str = "codex_github_token";
const CODEX_ROLE_KEY: &str = "codex_role";

/// 读取设置值
fn read_setting(db: &Database, key: &str) -> Option<String> {
    let conn = db.conn.lock().ok()?;
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

/// 从 Keychain 读取 codex 凭证并查询额度，返回统一 QuotaData
fn fetch_codex_usage(db: &Database, account_id: &str) -> Result<QuotaData, String> {
    let auth = codex::auth::read_auth_from_keychain(account_id)?;
    let usage = tauri::async_runtime::block_on(codex::client::CodexClient::get_usage(
        &crate::HTTP_CLIENT,
        &auth.tokens.access_token,
    ))
    .map_err(|e| e.to_string())?;

    let quota = usage_to_quota_data(&usage);
    Ok(quota)
}

/// 查询 Codex 账号额度（写入快照，复用现有 record_quota_snapshot）
#[tauri::command]
pub fn get_codex_quota(db: State<'_, Database>, account_id: String) -> Result<QuotaData, String> {
    let quota = fetch_codex_usage(&db, &account_id)?;

    if let Ok(conn) = db.conn.lock() {
        // Codex 没有"今日 token"概念，传 0.0
        let _ = crate::db::record_quota_snapshot(&conn, &account_id, &quota, 0.0);
    }

    Ok(quota)
}

/// 读取本机 ~/.codex/auth.json 摘要（脱敏）
#[tauri::command]
pub fn read_local_codex_auth() -> codex::types::AuthSummary {
    codex::auth::read_local_auth_summary()
}

/// 导入本机 Codex 账号（检测 ~/.codex/auth.json → 验证 → 存库）
#[tauri::command]
pub async fn add_codex_account(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    alias: String,
) -> Result<Account, String> {
    // 1. 读取本机 auth.json
    let auth = codex::auth::read_local_auth_json()?;

    if auth.tokens.access_token.is_empty() {
        return Err("auth.json 中无 access_token".to_string());
    }

    // 2. 验证：用 access_token 调 wham/usage
    let usage = codex::client::CodexClient::get_usage(&crate::HTTP_CLIENT, &auth.tokens.access_token)
        .await
        .map_err(|e| format!("验证失败（access_token 可能已失效）: {}", e))?;

    // 3. 存库
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let level = usage.plan_type.unwrap_or_default();

    {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        conn.execute(
            "INSERT INTO accounts (id, alias, purpose, platform, level, api_key, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'codex', ?4, '', 1, ?5, ?6)",
            rusqlite::params![id, alias, "codex", level, now, now],
        )
        .map_err(|e| e.to_string())?;

        // 如果是第一个 codex 账号，设为主账号
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM accounts WHERE platform = 'codex' AND is_active = 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if count == 1 {
            let _ = conn.execute(
                "UPDATE accounts SET is_primary = 1 WHERE id = ?1",
                rusqlite::params![id],
            );
        }
    }

    // 4. 凭证存 Keychain
    codex::auth::store_auth_to_keychain(&id, &auth)
        .map_err(|e| format!("凭证存储失败: {}", e))?;

    let _ = app.emit("accounts-changed", ());

    let is_primary = count_is_primary(&db, &id);

    Ok(Account {
        id,
        alias,
        purpose: "codex".to_string(),
        platform: "codex".to_string(),
        level: Some(level),
        is_active: true,
        is_primary,
        created_at: now.clone(),
        updated_at: now,
    })
}

fn count_is_primary(db: &Database, id: &str) -> bool {
    db.conn
        .lock()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT COALESCE(is_primary, 0) FROM accounts WHERE id = ?1",
                rusqlite::params![id],
                |row| row.get::<_, i32>(0),
            )
            .ok()
        })
        .map(|v| v == 1)
        .unwrap_or(false)
}

/// 上传鉴权：读本机 auth.json → 加密 → 推送到 Gist
#[tauri::command]
pub async fn upload_codex_auth(db: State<'_, Database>) -> Result<(), String> {
    // 1. 读本机 auth.json
    let auth = codex::auth::read_local_auth_json()?;

    // 2. 序列化 + 加密
    let json = serde_json::to_string(&auth).map_err(|e| format!("序列化失败: {}", e))?;
    let encrypted = codex::crypto::encrypt(&json)?;

    // 3. 读 Gist URL + GitHub Token
    let gist_url = read_setting(&db, GIST_URL_KEY)
        .ok_or("未配置 Gist URL，请在设置中填写")?;
    let github_token = read_setting(&db, GITHUB_TOKEN_KEY)
        .ok_or("未配置 GitHub Token，请在设置中填写")?;

    // 4. 推送
    codex::sync::push_to_gist(&crate::HTTP_CLIENT, &gist_url, &github_token, &encrypted).await?;

    // 5. 记录上传时间
    {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        let now = Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('codex_last_upload', ?1)",
            rusqlite::params![now],
        );
    }

    Ok(())
}

/// 同步鉴权（用户端）：从 Gist 拉取 → 解密 → 写入本机 + 关联账号 Keychain
#[tauri::command]
pub async fn sync_codex_auth(db: State<'_, Database>) -> Result<(), String> {
    // 1. 读 Gist URL
    let gist_url = read_setting(&db, GIST_URL_KEY)
        .ok_or("未配置 Gist URL，请在设置中填写")?;

    // 2. 解析 raw URL（优先尝试直接当 raw URL，失败则用 token 解析）
    let encrypted = match codex::sync::fetch_from_gist(&crate::HTTP_CLIENT, &gist_url).await {
        Ok(content) => content,
        Err(_) => {
            // 如果直接访问失败，尝试用 GitHub Token 解析 gist raw URL
            let token = read_setting(&db, GITHUB_TOKEN_KEY)
                .ok_or("无法拉取 Gist 且未配置 GitHub Token")?;
            let raw_url =
                codex::sync::resolve_gist_raw_url(&crate::HTTP_CLIENT, &gist_url, &token).await?;
            codex::sync::fetch_from_gist(&crate::HTTP_CLIENT, &raw_url).await?
        }
    };

    // 3. 解密
    let json = codex::crypto::decrypt(&encrypted)?;
    let auth: codex::types::AuthJson =
        serde_json::from_str(&json).map_err(|e| format!("解析凭证失败: {}", e))?;

    // 4. 写入本机 ~/.codex/auth.json
    codex::auth::write_local_auth_json(&auth)?;

    // 5. 更新所有已导入 codex 账号的 Keychain 凭证
    {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        let mut stmt = conn
            .prepare("SELECT id FROM accounts WHERE platform = 'codex' AND is_active = 1")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        drop(conn);

        for id in &ids {
            let _ = codex::auth::store_auth_to_keychain(id, &auth);
        }
    }

    // 6. 记录同步时间
    {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        let now = Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('codex_last_sync', ?1)",
            rusqlite::params![now],
        );
    }

    Ok(())
}

/// 测试 Codex 连接（验证 access_token 是否有效）
#[tauri::command]
pub async fn test_codex_connection(db: State<'_, Database>, account_id: String) -> Result<codex::types::UsageResponse, String> {
    let auth = codex::auth::read_auth_from_keychain(&account_id)?;
    let usage = codex::client::CodexClient::get_usage(&crate::HTTP_CLIENT, &auth.tokens.access_token)
        .await
        .map_err(|e| e.to_string())?;
    Ok(usage)
}

// ========== 配置命令 ==========

#[tauri::command]
pub fn set_codex_gist_url(db: State<'_, Database>, url: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![GIST_URL_KEY, url],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_codex_gist_url(db: State<'_, Database>) -> Result<Option<String>, String> {
    Ok(read_setting(&db, GIST_URL_KEY))
}

#[tauri::command]
pub fn set_codex_github_token(db: State<'_, Database>, token: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![GITHUB_TOKEN_KEY, token],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_codex_github_token(db: State<'_, Database>) -> Result<Option<String>, String> {
    Ok(read_setting(&db, GITHUB_TOKEN_KEY))
}

#[tauri::command]
pub fn set_codex_role(db: State<'_, Database>, role: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![CODEX_ROLE_KEY, role],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_codex_role(db: State<'_, Database>) -> Result<String, String> {
    Ok(read_setting(&db, CODEX_ROLE_KEY).unwrap_or_else(|| "owner".to_string()))
}

/// 上次上传/同步时间
#[derive(Debug, Serialize)]
pub struct CodexSyncInfo {
    pub last_upload: Option<String>,
    pub last_sync: Option<String>,
}

#[tauri::command]
pub fn get_codex_sync_info(db: State<'_, Database>) -> Result<CodexSyncInfo, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let last_upload: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'codex_last_upload'",
            [],
            |row| row.get(0),
        )
        .ok();
    let last_sync: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'codex_last_sync'",
            [],
            |row| row.get(0),
        )
        .ok();
    Ok(CodexSyncInfo {
        last_upload,
        last_sync,
    })
}

const AUTO_UPLOAD_KEY: &str = "codex_auto_upload";

#[tauri::command]
pub fn set_codex_auto_upload(db: State<'_, Database>, enabled: bool) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![AUTO_UPLOAD_KEY, enabled.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_codex_auto_upload(db: State<'_, Database>) -> Result<bool, String> {
    Ok(read_setting(&db, AUTO_UPLOAD_KEY)
        .map(|v| v == "true")
        .unwrap_or(false))
}
