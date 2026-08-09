use crate::db::models::Account;
use crate::db::Database;
use crate::deepseek::client::{DeepSeekApiError, DeepSeekClient};
use crate::deepseek::{
    self, balance_view_entries, DeepSeekBalanceEntry, DeepSeekBalancePoint, DeepSeekBalanceView,
};
use chrono::Utc;
use rusqlite::Connection;
use tauri::{Emitter, State};
use uuid::Uuid;

/// 把 DeepSeekApiError 映射为对用户友好的中文文案（与 lib.rs build_offline_quota 一致）。
pub(crate) fn deepseek_error_msg(e: &DeepSeekApiError) -> String {
    match e {
        DeepSeekApiError::InvalidKey => "DeepSeek API Key 无效或未授权".to_string(),
        DeepSeekApiError::InsufficientBalance => "DeepSeek 余额不足".to_string(),
        DeepSeekApiError::RateLimited => "DeepSeek 请求过于频繁（429）".to_string(),
        DeepSeekApiError::NoApiKey => "未配置 DeepSeek API Key".to_string(),
        other => other.to_string(),
    }
}

/// 读取账号在 deepseek_snapshots 中最近一次快照的所有币种条目。
///
/// DeepSeek 一次拉取的多个币种共享同一 timestamp（record_deepseek_snapshot 一并写入），
/// 因此取 MAX(timestamp) 后按该时间戳取所有行即可还原「最近一次」余额全貌。
fn read_latest_deepseek_balances(conn: &Connection, account_id: &str) -> Vec<DeepSeekBalanceEntry> {
    let latest_ts: Option<String> = conn
        .query_row(
            "SELECT MAX(timestamp) FROM deepseek_snapshots WHERE account_id = ?1",
            rusqlite::params![account_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();
    let Some(ts) = latest_ts else {
        return Vec::new();
    };
    let mut stmt = match conn.prepare(
        "SELECT currency, total_balance, granted_balance, topped_up_balance
         FROM deepseek_snapshots WHERE account_id = ?1 AND timestamp = ?2",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    stmt.query_map(rusqlite::params![account_id, ts], |row| {
        Ok(DeepSeekBalanceEntry {
            currency: row.get::<_, String>(0)?,
            total: row.get::<_, f64>(1)?,
            granted: row.get::<_, f64>(2)?,
            topped_up: row.get::<_, f64>(3)?,
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

fn count_deepseek_primary(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM accounts WHERE platform = 'deepseek' AND is_active = 1",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

/// 新增 DeepSeek 账号：经 /user/balance 验证 Key → 入库 platform='deepseek' → Keychain。
///
/// 与 GLM add_account 同为同步 + block_on 风格（DeepSeek 是 Bearer Key 流，非 OAuth）。
/// is_primary 计数按平台 scope（镜像 codex.rs:100），首个 DeepSeek 账号自动设主，不扰 GLM/Codex 主。
#[tauri::command]
pub fn add_deepseek_account(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    alias: String,
    api_key: String,
) -> Result<Account, String> {
    // 1. 验证 Key（拉一次余额）
    let balance =
        tauri::async_runtime::block_on(DeepSeekClient::get_balance(&crate::HTTP_CLIENT, &api_key))
            .map_err(|e| format!("API Key 验证失败: {}", deepseek_error_msg(&e)))?;

    // 2. 入库
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let is_primary = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        conn.execute(
            "INSERT INTO accounts (id, alias, purpose, platform, level, api_key, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'deepseek', NULL, '', 1, ?4, ?5)",
            rusqlite::params![id, alias, "deepseek", now, now],
        )
        .map_err(|e| e.to_string())?;

        // 首个 DeepSeek 账号设为主（按平台 scope 计数）
        let primary = count_deepseek_primary(&conn) == 1;
        if primary {
            let _ = conn.execute(
                "UPDATE accounts SET is_primary = 1 WHERE id = ?1",
                rusqlite::params![id],
            );
        }

        // 写一次快照，让历史图与离线重建立即可用
        let _ = crate::db::record_deepseek_snapshot(&conn, &id, &balance);
        primary
    };

    // 3. Keychain
    if let Err(e) = deepseek::auth::store_api_key(&id, &api_key) {
        // 快照有外键，必须先删快照再删账号，否则 accounts 删除会被约束拒绝。
        if let Ok(conn) = db.conn.lock() {
            let _ = conn.execute(
                "DELETE FROM deepseek_snapshots WHERE account_id = ?1",
                rusqlite::params![id],
            );
            let _ = conn.execute("DELETE FROM accounts WHERE id = ?1", rusqlite::params![id]);
        }
        return Err(format!("凭据存储失败: {}", e));
    }

    let _ = app.emit("accounts-changed", ());

    Ok(Account {
        id,
        alias,
        purpose: "deepseek".to_string(),
        platform: "deepseek".to_string(),
        level: None,
        is_active: true,
        is_primary,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// 实时拉取 DeepSeek 余额 + 模型，写快照，返回富视图（非 QuotaData）。
///
/// 即使 API 失败也返回 Ok(view)（is_offline=true + error），让 popover 卡片渲染错误串而非整卡空白；
/// 失败时尝试从最近一次 snapshot 还原 balances，最大化「离线也可见」。
#[tauri::command]
pub fn get_deepseek_balance(
    db: State<'_, Database>,
    account_id: String,
) -> Result<DeepSeekBalanceView, String> {
    let api_key = deepseek::auth::get_api_key(&account_id)?;
    let http = &crate::HTTP_CLIENT;

    let balance = tauri::async_runtime::block_on(DeepSeekClient::get_balance(http, &api_key));

    match balance {
        Ok(b) => {
            // 写快照（每币种一行）
            if let Ok(conn) = db.conn.lock() {
                let _ = crate::db::record_deepseek_snapshot(&conn, &account_id, &b);
            }
            // 模型列表：失败不致命，置空即可
            let models: Vec<String> =
                tauri::async_runtime::block_on(DeepSeekClient::get_models(http, &api_key))
                    .ok()
                    .map(|m| {
                        m.data
                            .into_iter()
                            .map(|e| e.id)
                            .filter(|s| !s.is_empty())
                            .collect()
                    })
                    .unwrap_or_default();

            Ok(DeepSeekBalanceView {
                is_available: b.is_available,
                balances: balance_view_entries(&b),
                models,
                level: None,
                last_active: Some(Utc::now().to_rfc3339()),
                error: if b.is_available {
                    None
                } else {
                    Some("DeepSeek 账户不可用（is_available=false）".to_string())
                },
                is_offline: false,
            })
        }
        Err(e) => {
            let balances = db
                .conn
                .lock()
                .map(|conn| read_latest_deepseek_balances(&conn, &account_id))
                .unwrap_or_default();
            Ok(DeepSeekBalanceView {
                is_available: false,
                balances,
                models: Vec::new(),
                level: None,
                last_active: None,
                error: Some(deepseek_error_msg(&e)),
                is_offline: true,
            })
        }
    }
}

/// 仅拉取模型列表（DeepSeekModelList 展开时实时刷新用）。返回原始 ModelsResponse，最大化信息。
#[tauri::command]
pub fn get_deepseek_models(
    account_id: String,
) -> Result<crate::deepseek::types::ModelsResponse, String> {
    let api_key = deepseek::auth::get_api_key(&account_id)?;
    let resp =
        tauri::async_runtime::block_on(DeepSeekClient::get_models(&crate::HTTP_CLIENT, &api_key))
            .map_err(|e| deepseek_error_msg(&e))?;
    Ok(resp)
}

/// 读取余额趋势（读 deepseek_snapshots，每币种一条时间序列点）。
#[tauri::command]
pub fn get_deepseek_balance_history(
    db: State<'_, Database>,
    account_id: String,
    days: Option<i64>,
) -> Result<Vec<DeepSeekBalancePoint>, String> {
    let days = days.unwrap_or(30).max(1);
    let cutoff = (chrono::Local::now() - chrono::Duration::days(days)).to_rfc3339();
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT timestamp, currency, total_balance, granted_balance, topped_up_balance
             FROM deepseek_snapshots
             WHERE account_id = ?1 AND timestamp >= ?2
             ORDER BY timestamp ASC",
        )
        .map_err(|e| e.to_string())?;
    let points = stmt
        .query_map(rusqlite::params![account_id, cutoff], |row| {
            Ok(DeepSeekBalancePoint {
                timestamp: row.get(0)?,
                currency: row.get(1)?,
                total_balance: row.get(2)?,
                granted_balance: row.get(3)?,
                topped_up_balance: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(points)
}

/// 验证 DeepSeek API Key 有效性，成功返回「币种 余额」摘要（兼作校验回显）。
#[tauri::command]
pub fn validate_deepseek_api_key(api_key: String) -> Result<String, String> {
    let balance =
        tauri::async_runtime::block_on(DeepSeekClient::get_balance(&crate::HTTP_CLIENT, &api_key))
            .map_err(|e| format!("API Key 验证失败: {}", deepseek_error_msg(&e)))?;
    let entry = balance_view_entries(&balance)
        .into_iter()
        .next()
        .ok_or_else(|| "响应中无有效余额条目".to_string())?;
    Ok(format!("{} {:.2}", entry.currency, entry.total))
}

/// DeepSeek 账号 API Key 脱敏（与 GLM mask_api_key 同形）。
#[tauri::command]
pub fn mask_deepseek_api_key(account_id: String) -> Result<String, String> {
    let api_key =
        deepseek::auth::get_api_key(&account_id).map_err(|e| format!("API Key 读取失败: {}", e))?;
    Ok(crate::crypto::mask_key(&api_key))
}

/// 获取 DeepSeek 账号明文 API Key（复制到剪贴板用）。
#[tauri::command]
pub fn get_deepseek_api_key_raw(account_id: String) -> Result<String, String> {
    deepseek::auth::get_api_key(&account_id).map_err(|e| format!("API Key 读取失败: {}", e))
}

/// 修改 DeepSeek 账号 API Key：先验证新 Key，通过后覆盖 Keychain 记录。
#[tauri::command]
pub fn update_deepseek_api_key(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    account_id: String,
    new_api_key: String,
) -> Result<(), String> {
    // 1. 验证新 Key
    let balance = tauri::async_runtime::block_on(DeepSeekClient::get_balance(
        &crate::HTTP_CLIENT,
        &new_api_key,
    ))
    .map_err(|e| format!("API Key 验证失败: {}", deepseek_error_msg(&e)))?;

    // 2. 覆盖 Keychain
    deepseek::auth::store_api_key(&account_id, &new_api_key)
        .map_err(|e| format!("凭据存储失败: {}", e))?;

    // 3. 刷新 updated_at，清残留明文，并写一次新快照
    {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE accounts SET api_key = '', updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, account_id],
        )
        .map_err(|e| e.to_string())?;
        let _ = crate::db::record_deepseek_snapshot(&conn, &account_id, &balance);
    }

    let _ = app.emit("accounts-changed", ());
    Ok(())
}
