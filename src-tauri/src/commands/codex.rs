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
fn fetch_codex_usage(_db: &Database, account_id: &str) -> Result<QuotaData, String> {
    let auth = codex::auth::read_auth_from_keychain(account_id)?;
    let usage = tauri::async_runtime::block_on(codex::client::CodexClient::get_usage(
        crate::proxy_http_client(),
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
    let usage = codex::client::CodexClient::get_usage(crate::proxy_http_client(), &auth.tokens.access_token)
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
    codex::sync::push_to_gist(crate::proxy_http_client(), &gist_url, &github_token, &encrypted).await?;

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

/// 从 Gist 拉取加密的鉴权内容（按 URL 类型分流）
/// - raw URL (gistusercontent.com)：直接匿名 fetch
/// - 网页 URL / API URL：用 GitHub Token 解析出 raw URL 后再 fetch
///   （旧实现的“先试 raw、失败再 resolve”无效：网页/API URL 都返回 HTTP 200，
///    永远不会触发 fallback，导致 HTML/JSON 被当成 base64 送进 decrypt）
pub async fn fetch_codex_gist_encrypted(db: &Database) -> Result<String, String> {
    let gist_url = read_setting(db, GIST_URL_KEY)
        .ok_or("未配置 Gist URL，请在设置中填写")?;
    if gist_url.contains("gistusercontent.com") {
        codex::sync::fetch_from_gist(crate::proxy_http_client(), &gist_url).await
    } else {
        // 网页 URL / API URL → resolve 出 raw URL
        // consumer 角色无 token 字段，但 gist 是 unlisted，匿名 resolve 也能工作；
        // 有 token 时携带，提升 GitHub API 速率限制
        let token = read_setting(db, GITHUB_TOKEN_KEY).unwrap_or_default();
        let raw_url =
            codex::sync::resolve_gist_raw_url(crate::proxy_http_client(), &gist_url, &token).await?;
        codex::sync::fetch_from_gist(crate::proxy_http_client(), &raw_url).await
    }
}

/// 解密并应用 codex 鉴权：写本机 ~/.codex/auth.json + 更新已导入账号 Keychain + 记录同步时间
pub async fn apply_codex_auth(encrypted: &str, db: &Database) -> Result<(), String> {
    // 解密
    let json = codex::crypto::decrypt(encrypted)?;
    let auth: codex::types::AuthJson =
        serde_json::from_str(&json).map_err(|e| format!("解析凭证失败: {}", e))?;

    // 写入本机 ~/.codex/auth.json
    codex::auth::write_local_auth_json(&auth)?;

    // 更新所有已导入 codex 账号的 Keychain 凭证
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

    // 记录同步时间
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

/// 同步鉴权（用户端）：从 Gist 拉取 → 解密 → 写入本机 + 关联账号 Keychain
#[tauri::command]
pub async fn sync_codex_auth(db: State<'_, Database>) -> Result<(), String> {
    let encrypted = fetch_codex_gist_encrypted(&db).await?;
    apply_codex_auth(&encrypted, &db).await
}

/// 测试 Codex 连接（验证 access_token 是否有效）
#[tauri::command]
pub async fn test_codex_connection(_db: State<'_, Database>, account_id: String) -> Result<codex::types::UsageResponse, String> {
    let auth = codex::auth::read_auth_from_keychain(&account_id)?;
    let usage = codex::client::CodexClient::get_usage(crate::proxy_http_client(), &auth.tokens.access_token)
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

const AUTO_SYNC_KEY: &str = "codex_auto_sync";

/// 设置 Codex 鉴权自动同步开关（consumer 角色用，从 Gist 拉取最新鉴权）
#[tauri::command]
pub fn set_codex_auto_sync(db: State<'_, Database>, enabled: bool) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![AUTO_SYNC_KEY, enabled.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取自动同步开关。未设置时默认开启（consumer 开箱即自动同步）
#[tauri::command]
pub fn get_codex_auto_sync(db: State<'_, Database>) -> Result<bool, String> {
    Ok(read_setting(&db, AUTO_SYNC_KEY)
        .map(|v| v == "true")
        .unwrap_or(true))
}

const PROXY_KEY: &str = "codex_proxy";

/// 设置 Codex/Gist 代理地址（如 http://127.0.0.1:7897）。
/// 空字符串表示使用默认代理。修改后需重启 app 生效。
#[tauri::command]
pub fn set_codex_proxy(db: State<'_, Database>, url: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![PROXY_KEY, url],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_codex_proxy(db: State<'_, Database>) -> Result<Option<String>, String> {
    Ok(read_setting(&db, PROXY_KEY))
}
