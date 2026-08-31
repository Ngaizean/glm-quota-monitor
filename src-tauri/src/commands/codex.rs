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
const CODEX_RUNTIME_MODE_KEY: &str = "codex_runtime_mode";
const CODEX_RELAY_URL_KEY: &str = "codex_relay_base_url";
const CODEX_RELAY_MODEL_KEY: &str = "codex_relay_model";
const CODEX_RELAY_SECRET_KEY: &str = "codex_relay_api_key";
const CODEX_ACTIVE_OFFICIAL_ACCOUNT_KEY: &str = "codex_active_official_account";
const DEFAULT_RELAY_URL: &str = "https://pixarsubtoapi.stream/v1";
const DEFAULT_RELAY_MODEL: &str = "gpt-5.6-sol";

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

fn delete_setting(db: &Database, key: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {e}"))?;
    conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        rusqlite::params![key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn write_setting(db: &Database, key: &str, value: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct CodexRuntimeConfig {
    pub active_mode: String,
    pub relay_base_url: String,
    pub relay_model: String,
    pub relay_key_configured: bool,
    pub active_official_account_id: Option<String>,
}

fn runtime_config(db: &Database) -> CodexRuntimeConfig {
    let detected_relay = codex::relay::detect_local_relay_config();
    let detected_distribution = codex::relay::detect_local_relay_distribution_config();
    let active_mode = if detected_relay.is_some() {
        "relay".to_string()
    } else {
        "official".to_string()
    };
    CodexRuntimeConfig {
        active_mode,
        relay_base_url: read_setting(db, CODEX_RELAY_URL_KEY)
            .or_else(|| {
                detected_relay
                    .as_ref()
                    .map(|config| config.base_url.clone())
            })
            .unwrap_or_else(|| DEFAULT_RELAY_URL.to_string()),
        relay_model: read_setting(db, CODEX_RELAY_MODEL_KEY)
            .or_else(|| detected_distribution.map(|config| config.model))
            .unwrap_or_else(|| DEFAULT_RELAY_MODEL.to_string()),
        relay_key_configured: read_relay_secret().is_ok(),
        active_official_account_id: read_setting(db, CODEX_ACTIVE_OFFICIAL_ACCOUNT_KEY),
    }
}

fn read_relay_secret() -> Result<String, String> {
    if let Ok(key) = crate::crypto::get_api_key(CODEX_RELAY_SECRET_KEY) {
        if !key.trim().is_empty() {
            return Ok(key);
        }
    }
    if let Some(config) = codex::relay::detect_local_relay_config() {
        if let Some(key) = config.bearer_token {
            if !key.trim().is_empty() {
                return Ok(key);
            }
        }
        return codex::auth::read_local_auth_json()
            .ok()
            .and_then(|auth| codex::relay::api_key_from_auth(&auth))
            .ok_or_else(|| "没有可用的中转 Key".to_string());
    }
    Err("没有可用的中转 Key".to_string())
}

#[tauri::command]
pub fn get_codex_runtime_config(db: State<'_, Database>) -> CodexRuntimeConfig {
    runtime_config(&db)
}

#[tauri::command]
pub fn set_codex_relay_config(
    db: State<'_, Database>,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<CodexRuntimeConfig, String> {
    let normalized = crate::sub2api::codex_config::normalize_relay_base_url(&base_url)?;
    let model = model.trim();
    if model.is_empty() || model.chars().any(char::is_control) {
        return Err("中转模型不能为空或包含控制字符".to_string());
    }
    if let Some(key) = api_key {
        let key = key.trim();
        if key.is_empty() {
            let _ = crate::crypto::delete_api_key(CODEX_RELAY_SECRET_KEY);
        } else {
            crate::crypto::store_api_key(CODEX_RELAY_SECRET_KEY, key)
                .map_err(|e| format!("保存中转 Key 失败: {e}"))?;
        }
    }
    write_setting(&db, CODEX_RELAY_URL_KEY, &normalized)?;
    write_setting(&db, CODEX_RELAY_MODEL_KEY, model)?;
    Ok(runtime_config(&db))
}

#[tauri::command]
pub fn get_codex_relay_key() -> Result<String, String> {
    read_relay_secret().map_err(|e| format!("读取中转 Key 失败: {e}"))
}

#[tauri::command]
pub fn switch_codex_runtime(
    db: State<'_, Database>,
    mode: String,
    account_id: Option<String>,
) -> Result<CodexRuntimeConfig, String> {
    match mode.as_str() {
        "official" => {
            if let Some(id) = account_id.as_deref() {
                let auth = codex::auth::read_auth_from_keychain(id)?;
                codex::auth::write_local_auth_json(&auth)?;
                write_setting(&db, CODEX_ACTIVE_OFFICIAL_ACCOUNT_KEY, id)?;
            } else {
                let auth = codex::auth::read_local_auth_json()?;
                if auth.tokens.access_token.trim().is_empty() {
                    return Err("当前没有可用的官方 Codex 登录".to_string());
                }
            }
            crate::sub2api::codex_config::apply_official_local_config()?;
        }
        "relay" => {
            let config = runtime_config(&db);
            let key = read_relay_secret().map_err(|_| "请先保存中转 Key".to_string())?;
            if key.trim().is_empty() {
                return Err("请先保存中转 Key".to_string());
            }
            crate::sub2api::codex_config::apply_local_config(
                &config.relay_base_url,
                &key,
                &config.relay_model,
            )?;
        }
        _ => return Err("Codex 运行模式仅支持 official 或 relay".to_string()),
    }
    write_setting(&db, CODEX_RUNTIME_MODE_KEY, &mode)?;
    Ok(runtime_config(&db))
}

fn find_codex_binary() -> Result<std::path::PathBuf, String> {
    if let Ok(output) = std::process::Command::new("which").arg("codex").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(path.into());
            }
        }
    }
    for path in [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        "/usr/bin/codex",
    ] {
        let candidate = std::path::PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("未找到 codex CLI，请先安装并确认 codex 在 PATH 中".to_string())
}

fn run_official_login() -> Result<codex::types::AuthJson, String> {
    let temp_home = std::env::temp_dir().join(format!(
        "glm-quota-monitor-codex-login-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_home).map_err(|e| format!("创建登录临时目录失败: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temp_home, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("收紧登录临时目录权限失败: {e}"))?;
    }
    let result = (|| {
        codex::auth::write_sensitive_file(
            &temp_home.join("config.toml"),
            b"cli_auth_credentials_store = \"file\"\n",
        )?;
        let output = std::process::Command::new(find_codex_binary()?)
            .arg("login")
            .env("CODEX_HOME", &temp_home)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("启动 codex login 失败: {e}"))?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if error.is_empty() {
                "Codex 官方登录未完成".to_string()
            } else {
                format!("Codex 官方登录失败: {error}")
            });
        }
        let content = std::fs::read_to_string(temp_home.join("auth.json"))
            .map_err(|e| format!("登录成功但未找到 auth.json: {e}"))?;
        let auth: codex::types::AuthJson =
            serde_json::from_str(&content).map_err(|e| format!("解析登录凭据失败: {e}"))?;
        if auth.tokens.access_token.trim().is_empty() || auth.tokens.account_id.trim().is_empty() {
            return Err("登录凭据缺少 access_token 或 account_id".to_string());
        }
        Ok(auth)
    })();
    let _ = std::fs::remove_dir_all(&temp_home);
    result
}

#[tauri::command]
pub async fn login_codex_official(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    alias: Option<String>,
) -> Result<Account, String> {
    let auth = tauri::async_runtime::spawn_blocking(run_official_login)
        .await
        .map_err(|e| format!("等待 Codex 登录失败: {e}"))??;
    let proxy = crate::proxy_http_client();
    let usage = codex::client::CodexClient::get_usage_with_fallback(
        &proxy,
        &crate::HTTP_CLIENT,
        &auth.tokens.access_token,
        &auth.tokens.account_id,
    )
    .await
    .map_err(|e| format!("登录凭据验证失败: {e}"))?;

    let existing_accounts: Vec<Account> = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {e}"))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, alias, purpose, platform, level, is_active, is_primary, created_at, updated_at
                 FROM accounts WHERE platform = 'codex' AND is_active = 1",
            )
            .map_err(|e| e.to_string())?;
        let accounts = stmt
            .query_map([], |row| {
                Ok(Account {
                    id: row.get(0)?,
                    alias: row.get(1)?,
                    purpose: row.get(2)?,
                    platform: row.get(3)?,
                    level: row.get(4)?,
                    is_active: row.get::<_, i32>(5)? == 1,
                    is_primary: row.get::<_, i32>(6)? == 1,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        accounts
    };
    let ids: Vec<String> = existing_accounts
        .iter()
        .map(|account| account.id.clone())
        .collect();
    let matched_id = find_matching_account_id(&ids, &auth.tokens.account_id, |id| {
        codex::auth::read_auth_from_keychain(id)
            .ok()
            .map(|stored| stored.tokens.account_id)
    });
    let level = usage.plan_type.unwrap_or_default();
    let account = if let Some(id) = matched_id {
        codex::auth::store_auth_to_keychain(&id, &auth)?;
        let now = Utc::now().to_rfc3339();
        {
            let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {e}"))?;
            conn.execute(
                "UPDATE accounts SET level = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![level, now, id],
            )
            .map_err(|e| e.to_string())?;
        }
        let mut account = existing_accounts
            .into_iter()
            .find(|account| account.id == id)
            .ok_or_else(|| "官方账号档案已发生变化，请重试".to_string())?;
        account.level = Some(level);
        account.updated_at = now;
        account
    } else {
        let existing_aliases: Vec<String> = existing_accounts
            .iter()
            .map(|account| account.alias.clone())
            .collect();
        let requested = alias
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("官方订阅");
        let account_alias = unique_codex_alias(&existing_aliases, requested);
        store_codex_account(&app, &db, account_alias, level, &auth)?
    };
    codex::auth::write_local_auth_json(&auth)?;
    crate::sub2api::codex_config::apply_official_local_config()?;
    write_setting(&db, CODEX_ACTIVE_OFFICIAL_ACCOUNT_KEY, &account.id)?;
    write_setting(&db, CODEX_RUNTIME_MODE_KEY, "official")?;
    Ok(account)
}

/// 从系统 Keychain 读取 GitHub Token；首次读取时自动迁移旧版 SQLite 明文。
pub(crate) fn read_github_token(db: &Database) -> Option<String> {
    if let Ok(token) = crate::crypto::get_api_key(GITHUB_TOKEN_KEY) {
        if !token.trim().is_empty() {
            return Some(token);
        }
    }

    let legacy = read_setting(db, GITHUB_TOKEN_KEY)?;
    if legacy.trim().is_empty() {
        let _ = delete_setting(db, GITHUB_TOKEN_KEY);
        return None;
    }

    if crate::crypto::store_api_key(GITHUB_TOKEN_KEY, &legacy).is_ok() {
        let _ = delete_setting(db, GITHUB_TOKEN_KEY);
    }
    Some(legacy)
}

/// 从 Keychain 读取 codex 凭证并查询额度，返回统一 QuotaData
fn fetch_codex_usage(_db: &Database, account_id: &str) -> Result<QuotaData, String> {
    let auth = codex::auth::read_auth_from_keychain(account_id)?;
    let proxy = crate::proxy_http_client();
    let usage =
        tauri::async_runtime::block_on(codex::client::CodexClient::get_usage_with_fallback(
            &proxy,
            &crate::HTTP_CLIENT,
            &auth.tokens.access_token,
            &auth.tokens.account_id,
        ))
        .map_err(|e| e.to_string())?;

    let quota = usage_to_quota_data(&usage);
    Ok(quota)
}

/// 中转站模式：config.toml 指向非官方端点且 auth.json 配有 API Key 时拉 /v1/usage。
/// 未配置中转站或拉取失败返回 None（调用方回落官方通路）。
fn fetch_relay_quota_if_configured() -> Option<QuotaData> {
    let cfg = codex::relay::detect_local_relay_config()?;
    let api_key = cfg.bearer_token.clone().or_else(|| {
        codex::auth::read_local_auth_json()
            .ok()
            .and_then(|a| codex::relay::api_key_from_auth(&a))
    })?;
    let proxy = crate::proxy_http_client();
    let usage = tauri::async_runtime::block_on(codex::relay::fetch_relay_usage(
        &crate::HTTP_CLIENT,
        &proxy,
        &cfg.base_url,
        &api_key,
    ))
    .ok()?;
    Some(codex::relay::relay_usage_to_quota_data(&usage))
}

/// 查询 Codex 账号额度（官方通路写入快照，复用现有 record_quota_snapshot）
#[tauri::command]
pub fn get_codex_quota(db: State<'_, Database>, account_id: String) -> Result<QuotaData, String> {
    // 中转站模式：钱包余额，无百分比列，不写快照（避免 0 值污染趋势图）
    if let Some(relay_quota) = fetch_relay_quota_if_configured() {
        return Ok(relay_quota);
    }

    let quota = fetch_codex_usage(&db, &account_id)?;

    if let Ok(conn) = db.conn.lock() {
        // Codex 没有"今日 token/调用数"概念，均传 0.0
        let _ = crate::db::record_quota_snapshot(&conn, &account_id, &quota, 0.0, 0.0);
    }

    Ok(quota)
}

/// 查询中转站 /v1/usage 富视图（余额 + 今日/累计用量）。
/// 未配置中转站或 auth.json 无 API Key 时返回错误说明。
#[tauri::command]
pub async fn get_relay_usage() -> Result<codex::relay::RelayUsageView, String> {
    let cfg = codex::relay::detect_local_relay_config()
        .ok_or("未检测到中转站配置（config.toml 的 model_provider 需指向非官方 base_url）")?;
    let api_key = cfg
        .bearer_token
        .clone()
        .or_else(|| {
            codex::auth::read_local_auth_json()
                .ok()
                .and_then(|auth| codex::relay::api_key_from_auth(&auth))
        })
        .ok_or("当前中转档案没有可用的 API Key")?;
    let proxy = crate::proxy_http_client();
    let usage =
        codex::relay::fetch_relay_usage(&crate::HTTP_CLIENT, &proxy, &cfg.base_url, &api_key)
            .await?;
    Ok(codex::relay::relay_usage_to_view(&usage))
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

    // 2. 按当前本机配置验证：中转站用 API Key，官方用 access_token。
    let proxy = crate::proxy_http_client();
    let level = if let (Some(config), Some(api_key)) = (
        codex::relay::detect_local_relay_config(),
        codex::relay::api_key_from_auth(&auth),
    ) {
        let usage = codex::relay::fetch_relay_usage(
            &crate::HTTP_CLIENT,
            &proxy,
            &config.base_url,
            &api_key,
        )
        .await
        .map_err(|e| format!("中转站验证失败: {e}"))?;
        usage.plan_name.unwrap_or(config.provider_name)
    } else {
        if auth.tokens.access_token.is_empty() {
            return Err("auth.json 中既无中转站 API Key，也无官方 access_token".to_string());
        }
        codex::client::CodexClient::get_usage_with_fallback(
            &proxy,
            &crate::HTTP_CLIENT,
            &auth.tokens.access_token,
            &auth.tokens.account_id,
        )
        .await
        .map_err(|e| format!("官方 Codex 验证失败: {e}"))?
        .plan_type
        .unwrap_or_default()
    };

    // 3. 存库 + Keychain
    let account = store_codex_account(&app, &db, alias, level, &auth)?;

    let _ = app.emit("accounts-changed", ());
    Ok(account)
}

/// 验证通过后的落库：accounts 表插入 + Keychain 凭证存储 + 首账号设主账号。
/// 失败时回滚已插入的行。
fn store_codex_account(
    app: &tauri::AppHandle,
    db: &Database,
    alias: String,
    level: String,
    auth: &codex::types::AuthJson,
) -> Result<Account, String> {
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();

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

    // 凭证存 Keychain
    if let Err(e) = codex::auth::store_auth_to_keychain(&id, auth) {
        let _ = db
            .conn
            .lock()
            .map(|conn| conn.execute("DELETE FROM accounts WHERE id = ?1", rusqlite::params![id]));
        return Err(format!("凭证存储失败: {}", e));
    }

    let _ = app.emit("accounts-changed", ());

    let is_primary = count_is_primary(db, &id);

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

/// 预览：解析粘贴的 JSON，返回识别出的账号列表（脱敏，不含 token 明文）
#[tauri::command]
pub fn parse_codex_accounts_json_preview(
    json: String,
) -> Result<Vec<codex::import_json::ParsedCodexAccount>, String> {
    codex::import_json::parse_codex_accounts_json(&json).map(|list| {
        list.into_iter()
            .map(|mut a| {
                a.auth.tokens.access_token = String::new();
                a.auth.tokens.refresh_token = String::new();
                a.auth.tokens.id_token = String::new();
                a
            })
            .collect()
    })
}

/// 单个账号的导入结果
#[derive(Debug, Serialize)]
pub struct CodexJsonImportResult {
    pub alias: String,
    pub success: bool,
    pub error: Option<String>,
    pub account_id: Option<String>,
}

fn unique_codex_alias(existing: &[String], suggested: &str) -> String {
    if !existing.iter().any(|alias| alias == suggested) {
        return suggested.to_string();
    }
    let mut suffix = 2;
    loop {
        let candidate = format!("{suggested}-{suffix}");
        if !existing.iter().any(|alias| alias == &candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

fn find_matching_account_id<F>(
    ids: &[String],
    openai_account_id: &str,
    mut load_identity: F,
) -> Option<String>
where
    F: FnMut(&str) -> Option<String>,
{
    ids.iter()
        .find(|id| load_identity(id).as_deref() == Some(openai_account_id))
        .cloned()
}

/// 从粘贴的 JSON 批量导入 Codex 账号：解析 → 逐个验证（wham/usage）→ 入库。
/// 单个失败不影响其余账号，结果逐条返回。
#[tauri::command]
pub async fn add_codex_accounts_from_json(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    json: String,
) -> Result<Vec<CodexJsonImportResult>, String> {
    let parsed = codex::import_json::parse_codex_accounts_json(&json)?;

    // 同名账号自动加序号后缀
    let mut existing: Vec<String> = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {e}"))?;
        let mut stmt = conn
            .prepare("SELECT alias FROM accounts WHERE platform = 'codex'")
            .map_err(|e| e.to_string())?;
        let rows: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let mut results = Vec::new();
    for item in parsed {
        let alias = unique_codex_alias(&existing, &item.suggested_alias);

        let proxy = crate::proxy_http_client();
        let verify = codex::client::CodexClient::get_usage_with_fallback(
            &proxy,
            &crate::HTTP_CLIENT,
            &item.auth.tokens.access_token,
            &item.auth.tokens.account_id,
        )
        .await;

        match verify {
            Ok(usage) => {
                let level = usage
                    .plan_type
                    .clone()
                    .or_else(|| item.plan_type.clone())
                    .unwrap_or_default();
                match store_codex_account(&app, &db, alias.clone(), level, &item.auth) {
                    Ok(acc) => {
                        existing.push(alias.clone());
                        results.push(CodexJsonImportResult {
                            alias,
                            success: true,
                            error: None,
                            account_id: Some(acc.id),
                        });
                    }
                    Err(e) => results.push(CodexJsonImportResult {
                        alias,
                        success: false,
                        error: Some(e),
                        account_id: None,
                    }),
                }
            }
            Err(e) => results.push(CodexJsonImportResult {
                alias,
                success: false,
                error: Some(format!("验证失败: {e}")),
                account_id: None,
            }),
        }
    }

    let _ = app.emit("accounts-changed", ());
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{find_matching_account_id, unique_codex_alias};

    #[test]
    fn batch_import_aliases_skip_all_existing_suffixes() {
        let existing = vec![
            "team".to_string(),
            "team-2".to_string(),
            "team-3".to_string(),
        ];
        assert_eq!(unique_codex_alias(&existing, "new"), "new");
        assert_eq!(unique_codex_alias(&existing, "team"), "team-4");
    }

    #[test]
    fn official_login_reuses_matching_openai_identity() {
        let ids = vec!["local-a".to_string(), "local-b".to_string()];
        let matched = find_matching_account_id(&ids, "openai-b", |id| match id {
            "local-a" => Some("openai-a".to_string()),
            "local-b" => Some("openai-b".to_string()),
            _ => None,
        });

        assert_eq!(matched.as_deref(), Some("local-b"));
        assert_eq!(find_matching_account_id(&ids, "openai-c", |_| None), None);
    }
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
    let gist_url = read_setting(&db, GIST_URL_KEY).ok_or("未配置 Gist URL，请在设置中填写")?;
    let github_token = read_github_token(&db).ok_or("未配置 GitHub Token，请在设置中填写")?;

    // 4. 推送
    let proxy = crate::proxy_http_client();
    codex::sync::push_to_gist(&proxy, &gist_url, &github_token, &encrypted).await?;

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
/// - raw URL (githubusercontent.com)：直接匿名 fetch
/// - 网页 URL / API URL：用 GitHub Token 解析出 raw URL 后再 fetch
///   （旧实现的“先试 raw、失败再 resolve”无效：网页/API URL 都返回 HTTP 200，
///   永远不会触发 fallback，导致 HTML/JSON 被当成 base64 送进 decrypt）
pub async fn fetch_codex_gist_encrypted(db: &Database) -> Result<String, String> {
    let gist_url = read_setting(db, GIST_URL_KEY).ok_or("未配置 Gist URL，请在设置中填写")?;
    let proxy = crate::proxy_http_client();
    // 实际 raw 域名是 gist.githubusercontent.com / gist.githubusercontent.com，
    // 都以 githubusercontent.com 结尾；匹配后者才能命中（"gistusercontent.com"
    // 不是其子串，旧写法导致 raw URL 也走 API 分支）
    if gist_url.contains("githubusercontent.com") {
        codex::sync::fetch_from_gist(&proxy, &gist_url).await
    } else {
        // 网页 URL / API URL → resolve 出 raw URL
        // consumer 角色无 token 字段，但 gist 是 unlisted，匿名 resolve 也能工作；
        // 有 token 时携带，提升 GitHub API 速率限制
        let token = read_github_token(db).unwrap_or_default();
        let raw_url = codex::sync::resolve_gist_raw_url(&proxy, &gist_url, &token).await?;
        codex::sync::fetch_from_gist(&proxy, &raw_url).await
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

    // 只更新同一 OpenAI account_id 的存档，避免同步一个账号时抹掉其他官方账号。
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
            let same_identity = codex::auth::read_auth_from_keychain(id)
                .is_ok_and(|stored| stored.tokens.account_id == auth.tokens.account_id);
            if same_identity {
                let _ = codex::auth::store_auth_to_keychain(id, &auth);
            }
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
pub async fn test_codex_connection(
    _db: State<'_, Database>,
    account_id: String,
) -> Result<codex::types::UsageResponse, String> {
    let auth = codex::auth::read_auth_from_keychain(&account_id)?;
    let proxy = crate::proxy_http_client();
    let usage = codex::client::CodexClient::get_usage_with_fallback(
        &proxy,
        &crate::HTTP_CLIENT,
        &auth.tokens.access_token,
        &auth.tokens.account_id,
    )
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
    if token.trim().is_empty() {
        let _ = crate::crypto::delete_api_key(GITHUB_TOKEN_KEY);
        return delete_setting(&db, GITHUB_TOKEN_KEY);
    }

    crate::crypto::store_api_key(GITHUB_TOKEN_KEY, &token)
        .map_err(|e| format!("GitHub Token 存入 Keychain 失败: {e}"))?;
    delete_setting(&db, GITHUB_TOKEN_KEY)
}

#[tauri::command]
pub fn get_codex_github_token(db: State<'_, Database>) -> Result<Option<String>, String> {
    Ok(read_github_token(&db))
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

/// 设置 Codex/Gist 代理地址（如 http://127.0.0.1:50470）。
/// 空字符串表示使用默认代理，保存后立即生效。
#[tauri::command]
pub fn set_codex_proxy(db: State<'_, Database>, url: String) -> Result<(), String> {
    crate::set_proxy_client(&url)?;
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

// ========== SSH 远程覆盖 ==========

/// 扫描本机 ~/.ssh/config，返回可用主机列表
#[tauri::command]
pub fn scan_ssh_hosts() -> Vec<codex::ssh::SshHost> {
    codex::ssh::scan_ssh_hosts()
}

/// 检查主机是否免密（key-based）登录
#[tauri::command]
pub fn check_ssh_passwordless(host: String) -> bool {
    codex::ssh::is_passwordless(&host)
}

/// 手动同步本机 Codex 鉴权及当前中转配置到远程
/// password: Some = 密码登录；None = 免密
#[tauri::command]
pub fn ssh_push_auth(host: String, password: Option<String>) -> Result<(), String> {
    codex::ssh::push_codex_setup(&host, password.as_deref())
}

/// 单个主机的 SSH 覆盖状态（前端展示用）
#[derive(Debug, Serialize)]
pub struct SshOverrideState {
    pub host: String,
    pub auto_enabled: bool,
    pub has_password: bool,
}

/// 获取所有已开启自动覆盖主机的状态
#[tauri::command]
pub fn get_ssh_override_state(db: State<'_, Database>) -> Vec<SshOverrideState> {
    let conn = match db.conn.lock() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut stmt = match conn
        .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'ssh_auto_override_%'")
    {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    });
    if let Ok(rows) = rows {
        for r in rows.flatten() {
            if r.1 != "true" {
                continue;
            }
            if let Some(alias) = r.0.strip_prefix("ssh_auto_override_") {
                out.push(SshOverrideState {
                    host: alias.to_string(),
                    auto_enabled: true,
                    has_password: codex::ssh::has_ssh_password(alias),
                });
            }
        }
    }
    out
}

const SSH_AUTO_OVERRIDE_PREFIX: &str = "ssh_auto_override_";

#[tauri::command]
pub fn set_ssh_auto_override(
    db: State<'_, Database>,
    host: String,
    enabled: bool,
) -> Result<(), String> {
    codex::ssh::validate_ssh_alias(&host)?;
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![
            format!("{SSH_AUTO_OVERRIDE_PREFIX}{host}"),
            enabled.to_string()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_ssh_auto_override(db: State<'_, Database>, host: String) -> Result<bool, String> {
    codex::ssh::validate_ssh_alias(&host)?;
    Ok(
        read_setting(&db, &format!("{SSH_AUTO_OVERRIDE_PREFIX}{host}"))
            .map(|v| v == "true")
            .unwrap_or(false),
    )
}

/// 保存 SSH 密码到 Keychain（供自动覆盖使用）
#[tauri::command]
pub fn set_ssh_password(host: String, password: String) -> Result<(), String> {
    codex::ssh::store_ssh_password(&host, &password)
}

#[tauri::command]
pub fn has_ssh_password(host: String) -> bool {
    codex::ssh::has_ssh_password(&host)
}

#[tauri::command]
pub fn delete_ssh_password(host: String) -> Result<(), String> {
    codex::ssh::delete_ssh_password(&host)
}

// ========== 远程 Claude Code 切换 ==========
//
// 把本机「Claude Code 切换 GLM/DeepSeek」能力通过 SSH 复用到远程主机：
// 检测远程 claude CLI → 读现有 env → 用本机账号凭证重新生成 env 块推过去。
// 远程独立模型：远程与本机可绑不同账号/模型，互不影响。
//
// 密码策略：password=Some 直接用；password=None 时按免密处理，失败再回退到 keychain
// 已存密码（与 run_ssh_auto_override 调度逻辑一致），避免明文密码到前端。

/// 把命令传入的 password 标准化为「最终用于 ssh 的密码」。
/// None → 先尝试免密；非免密且 keychain 有密码则返回该密码；都没有则 None（让 ssh 报错）。
fn resolve_ssh_password(host: &str, password: &Option<String>) -> Option<String> {
    if let Some(p) = password {
        return Some(p.clone());
    }
    // 免密优先：若可免密则不需要密码
    if codex::ssh::is_passwordless(host) {
        return None;
    }
    // 非免密：取 keychain 已存密码（codex auth 推送时存入的）
    codex::ssh::read_ssh_password(host)
}

/// 检测远程 Claude Code 状态：CLI 是否安装 + 当前 settings.json 的 base_url/model。
#[tauri::command]
pub fn ssh_check_claude_code(
    host: String,
    password: Option<String>,
) -> Result<codex::ssh::RemoteCcState, String> {
    let pw = resolve_ssh_password(&host, &password);
    let installed = codex::ssh::remote_has_claude_code(&host, pw.as_deref())?;
    // settings 读取失败（无文件/解析错）不应阻断检测，降级为空状态
    let mut state =
        codex::ssh::read_remote_cc_settings(&host, pw.as_deref()).unwrap_or_else(|_| {
            codex::ssh::RemoteCcState {
                installed: false,
                base_url: None,
                model: None,
                platform: "unknown".to_string(),
            }
        });
    state.installed = installed;
    Ok(state)
}

/// 远程切换 Claude Code 端点：按本机账号 platform 解析 api_key/model/base_url，写入远程 settings.json。
#[tauri::command]
pub fn ssh_bind_claude_code(
    db: State<'_, Database>,
    host: String,
    password: Option<String>,
    account_id: String,
    model: Option<String>,
) -> Result<(), String> {
    let pw = resolve_ssh_password(&host, &password);
    let (api_key, model_val, base_url) =
        super::agent::resolve_cc_bind_params(&db, &account_id, model.as_deref())?;
    codex::ssh::write_remote_cc_env(&host, pw.as_deref(), &api_key, &model_val, &base_url)
}

/// 远程解绑：清除 settings.json 中所有 ANTHROPIC_* 字段。
#[tauri::command]
pub fn ssh_unbind_claude_code(host: String, password: Option<String>) -> Result<(), String> {
    let pw = resolve_ssh_password(&host, &password);
    codex::ssh::unbind_remote_cc_env(&host, pw.as_deref())
}
