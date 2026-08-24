//! sub2api 管理命令：连接配置、一键部署（导入→绑组→密钥）、本地/远程 codex 接入。

use crate::db::Database;
use crate::sub2api::{DeployResult, ImportStats, Sub2ApiClient};
use serde_json::Value;
use tauri::State;

const BASE_URL_KEY: &str = "sub2api_base_url";
const ADMIN_EMAIL_KEY: &str = "sub2api_admin_email";
const MODEL_KEY: &str = "sub2api_default_model";
const PASSWORD_KEYCHAIN_KEY: &str = "sub2api_admin_password";
const API_KEY_NAME: &str = "quota-monitor";

fn read_setting(db: &Database, key: &str) -> Option<String> {
    let conn = db.conn.lock().ok()?;
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .ok()
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

fn stored_password() -> Option<String> {
    crate::crypto::get_api_key(PASSWORD_KEYCHAIN_KEY)
        .ok()
        .filter(|s| !s.trim().is_empty())
}

fn base_url(db: &Database) -> String {
    read_setting(db, BASE_URL_KEY).unwrap_or_else(|| "http://localhost:8080".to_string())
}

/// 登录后的客户端（email 取库，password 参数优先于 Keychain）
async fn make_client(
    db: &Database,
    password_override: Option<&str>,
) -> Result<Sub2ApiClient, String> {
    let email =
        read_setting(db, ADMIN_EMAIL_KEY).ok_or("未配置 sub2api 管理员邮箱，请先在设置中填写")?;
    let password = password_override
        .map(|s| s.to_string())
        .or_else(stored_password)
        .ok_or("未配置 sub2api 管理员密码，请先在设置中填写")?;
    let mut client = Sub2ApiClient::new(&base_url(db));
    client.login(&email, &password).await?;
    Ok(client)
}

// ========== 配置读写 ==========

#[tauri::command]
pub fn get_sub2api_config(db: State<'_, Database>) -> Result<Value, String> {
    Ok(serde_json::json!({
        "base_url": base_url(&db),
        "admin_email": read_setting(&db, ADMIN_EMAIL_KEY),
        "has_password": stored_password().is_some(),
        "model": read_setting(&db, MODEL_KEY).unwrap_or_else(|| "gpt-5.6-sol".to_string()),
        "lan_ip": crate::sub2api::codex_config::probe_lan_ip(),
    }))
}

#[tauri::command]
pub fn set_sub2api_config(
    db: State<'_, Database>,
    base_url: Option<String>,
    admin_email: Option<String>,
    admin_password: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    if let Some(url) = base_url {
        write_setting(&db, BASE_URL_KEY, url.trim())?;
    }
    if let Some(email) = admin_email {
        write_setting(&db, ADMIN_EMAIL_KEY, email.trim())?;
    }
    if let Some(password) = admin_password {
        if password.trim().is_empty() {
            let _ = crate::crypto::delete_api_key(PASSWORD_KEYCHAIN_KEY);
        } else {
            crate::crypto::store_api_key(PASSWORD_KEYCHAIN_KEY, password.trim())
                .map_err(|e| format!("密码存入 Keychain 失败: {e}"))?;
        }
    }
    if let Some(model) = model {
        write_setting(&db, MODEL_KEY, model.trim())?;
    }
    Ok(())
}

/// 连接测试：health + 登录 + 返回账号/分组数量
#[tauri::command]
pub async fn sub2api_test_connection(
    db: State<'_, Database>,
    password: Option<String>,
) -> Result<Value, String> {
    let client_base = base_url(&db);
    let probe = Sub2ApiClient::new(&client_base);
    probe.health().await?;
    let client = make_client(&db, password.as_deref()).await?;
    let accounts = client.list_accounts().await?;
    let groups = client.list_groups().await?;
    Ok(serde_json::json!({
        "accounts": accounts.len(),
        "groups": groups.len(),
    }))
}

/// 从导入 JSON 里提取第一个 openai 账号的 plan_type（credentials.plan_type 或 JWT 解码）
fn extract_plan_type(data: &Value) -> Option<String> {
    let accounts = data.get("accounts")?.as_array()?;
    for acc in accounts {
        if acc.get("platform").and_then(|p| p.as_str()) != Some("openai") {
            continue;
        }
        if let Some(plan) = acc
            .get("credentials")
            .and_then(|c| c.get("plan_type"))
            .and_then(|p| p.as_str())
        {
            return Some(plan.to_string());
        }
        if let Some(token) = acc
            .get("credentials")
            .and_then(|c| c.get("access_token"))
            .and_then(|t| t.as_str())
        {
            let parsed = crate::codex::import_json::parse_codex_accounts_json(
                &serde_json::to_string(acc).unwrap_or_default(),
            )
            .ok()
            .and_then(|mut list| list.pop());
            if let Some(item) = parsed {
                if let Some(plan) = item.plan_type {
                    return Some(plan);
                }
                let _ = token;
            }
        }
    }
    None
}

/// 一键部署：导入账号 → 确保分组并绑定 → 确保 API Key。
/// 返回 api_key 供前端继续「应用到本地/远程 codex」。
#[tauri::command]
pub async fn sub2api_deploy(
    db: State<'_, Database>,
    password: Option<String>,
    json: String,
) -> Result<DeployResult, String> {
    let data: Value =
        serde_json::from_str(json.trim()).map_err(|e| format!("JSON 解析失败: {e}"))?;
    if data
        .get("accounts")
        .and_then(|a| a.as_array())
        .is_none_or(|a| a.is_empty())
    {
        return Err("JSON 中没有 accounts 数组（需要 sub2api 导出格式）".to_string());
    }

    let client = make_client(&db, password.as_deref()).await?;

    // 导入前记录已有账号，导入后差集 = 本次新导入
    let before: std::collections::HashSet<i64> = client
        .list_accounts()
        .await?
        .into_iter()
        .map(|a| a.id)
        .collect();

    let stats = client.import_accounts(&data).await?;
    if stats.account_created == 0 && stats.account_failed == 0 {
        // sub2api 对重复导入返回 0/0 —— 按名字匹配已有账号继续流程
    }

    // 分组：优先按 plan_type 命名（如 K12），找不到则创建
    let plan = extract_plan_type(&data);
    let group_name = plan
        .as_deref()
        .map(|p| p.to_uppercase())
        .unwrap_or_else(|| "Imported".to_string());
    let groups = client.list_groups().await?;
    let group = match groups
        .into_iter()
        .find(|g| g.platform == "openai" && g.name.eq_ignore_ascii_case(&group_name))
    {
        Some(g) => g,
        None => client.create_group(&group_name, "openai").await?,
    };

    // 绑定：新导入的账号 + 与 JSON 同名的存量账号
    let names: Vec<String> = data
        .get("accounts")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|acc| {
                    acc.get("name")
                        .and_then(|n| n.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default();

    let after = client.list_accounts().await?;
    let mut bound_ids = Vec::new();
    for account in &after {
        let is_new = !before.contains(&account.id);
        let is_named = names.iter().any(|n| n == &account.name);
        if account.platform == "openai" && (is_new || is_named) {
            client
                .bind_account_groups(account.id, &[group.id])
                .await
                .map_err(|e| format!("账号 {} 绑定分组失败: {e}", account.name))?;
            bound_ids.push(account.id);
        }
    }

    let api_key = client
        .ensure_api_key(API_KEY_NAME, group.id)
        .await
        .map_err(|e| format!("确保 API Key 失败: {e}"))?;

    Ok(DeployResult {
        import_stats: ImportStats {
            account_created: stats.account_created,
            account_failed: stats.account_failed,
            errors: Vec::new(),
        },
        group_name: group.name,
        api_key,
        bound_account_ids: bound_ids,
    })
}

/// 把 sub2api 写入本机 ~/.codex/config.toml（幂等，先备份）
#[tauri::command]
pub fn sub2api_apply_local(db: State<'_, Database>, api_key: String) -> Result<Value, String> {
    let base = base_url(&db);
    let model = read_setting(&db, MODEL_KEY).unwrap_or_else(|| "gpt-5.6-sol".to_string());
    let url = format!("{}/v1", base.trim_end_matches('/'));
    let backup = crate::sub2api::codex_config::apply_local_config(&url, &api_key, &model)?;
    Ok(serde_json::json!({ "backup": backup, "base_url": url, "model": model }))
}

/// 把 sub2api 写入远程 ~/.codex/config.toml（base_url 用本机局域网 IP）
#[tauri::command]
pub fn sub2api_apply_remote(
    db: State<'_, Database>,
    host: String,
    password: Option<String>,
    api_key: String,
) -> Result<Value, String> {
    let lan_ip = crate::sub2api::codex_config::probe_lan_ip()
        .ok_or("无法探测本机局域网 IP（检查网络连接）")?;
    let base = base_url(&db)
        .trim_end_matches('/')
        .replace("localhost", &lan_ip)
        .replace("127.0.0.1", &lan_ip);
    let url = format!("{}/v1", base);
    let model = read_setting(&db, MODEL_KEY).unwrap_or_else(|| "gpt-5.6-sol".to_string());

    let stored_pw = crate::codex::ssh::read_ssh_password(&host);
    let pw = password
        .as_deref()
        .or(if crate::codex::ssh::is_passwordless(&host) {
            None
        } else {
            stored_pw.as_deref()
        });
    crate::codex::ssh::write_remote_codex_config(&host, pw, &url, &api_key, &model)
        .map_err(|e| format!("远程应用失败: {e}"))?;
    Ok(serde_json::json!({ "base_url": url, "model": model }))
}

/// 状态：账号列表（不返回 key 明文以外的敏感信息）
#[tauri::command]
pub async fn sub2api_status(db: State<'_, Database>) -> Result<Value, String> {
    let client = make_client(&db, None).await?;
    let accounts = client.list_accounts().await?;
    let groups = client.list_groups().await?;
    Ok(serde_json::json!({ "accounts": accounts, "groups": groups }))
}

/// 给管理员充值余额（sub2api 内部计费）
#[tauri::command]
pub async fn sub2api_topup(
    db: State<'_, Database>,
    password: Option<String>,
    amount: f64,
) -> Result<f64, String> {
    if amount <= 0.0 || amount > 10000.0 {
        return Err("充值金额需在 (0, 10000] 之间".to_string());
    }
    let client = make_client(&db, password.as_deref()).await?;
    client.topup(1, amount).await
}
