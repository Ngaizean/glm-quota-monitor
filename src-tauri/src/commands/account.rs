use crate::api::client::ZhipuClient;
use crate::crypto;
use crate::db::models::Account;
use crate::db::Database;
use chrono::Utc;
use tauri::{Emitter, State};
use uuid::Uuid;

#[tauri::command]
pub fn add_account(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    alias: String,
    purpose: String,
    api_key: String,
) -> Result<Account, String> {
    {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM accounts WHERE alias = ?1 AND purpose = ?2 AND is_active = 1",
                rusqlite::params![alias, purpose],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if exists {
            return Err(format!("账号 '{}' 已存在用途 '{}'，请使用不同用途", alias, purpose));
        }
    }

    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    let quota = tauri::async_runtime::block_on(client.get_quota_limit())
        .map_err(|e| format!("API Key 验证失败: {}", e))?;

    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();

    let is_primary = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        conn.execute(
            "INSERT INTO accounts (id, alias, purpose, platform, level, api_key, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'zhipu', ?4, '', 1, ?5, ?6)",
            rusqlite::params![id, alias, purpose, quota.level, now, now],
        )
        .map_err(|e| e.to_string())?;

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM accounts WHERE is_active = 1", [], |row| row.get(0))
            .unwrap_or(0);
        let primary = count == 1;
        if primary {
            let _ = conn.execute("UPDATE accounts SET is_primary = 1 WHERE id = ?1", rusqlite::params![id]);
        }
        primary
    };

    if let Err(e) = crypto::store_api_key(&id, &api_key) {
        let _ = db.conn.lock().map(|c| c.execute("DELETE FROM accounts WHERE id = ?1", rusqlite::params![id]));
        return Err(format!("凭据存储失败: {}", e));
    }

    let _ = app.emit("accounts-changed", ());

    Ok(Account {
        id,
        alias,
        purpose,
        platform: "zhipu".to_string(),
        level: Some(quota.level),
        is_active: true,
        is_primary,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn list_accounts(db: State<'_, Database>) -> Result<Vec<Account>, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, alias, purpose, platform, level, is_active, is_primary, created_at, updated_at FROM accounts WHERE is_active = 1")
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
        .filter_map(|a| a.ok())
        .collect();

    Ok(accounts)
}

#[tauri::command]
pub fn delete_account(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        // 清理指向该账号的 agent 绑定（agent_claude_code/agent_openclaw 等），避免删除后悬空引用
        tx.execute(
            "DELETE FROM app_settings WHERE value = ?1 AND key LIKE 'agent\\_%' ESCAPE '\\'",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM alert_history WHERE account_id = ?1", rusqlite::params![id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM alert_rules WHERE account_id = ?1", rusqlite::params![id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM usage_snapshots WHERE account_id = ?1", rusqlite::params![id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM accounts WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;

        // 如果没有主账号了，自动提升第一个
        let has_primary: bool = conn
            .query_row(
                "SELECT COALESCE(MAX(is_primary), 0) FROM accounts WHERE is_active = 1",
                [],
                |row| row.get::<_, i32>(0),
            )
            .map(|v| v == 1)
            .unwrap_or(false);
        if !has_primary {
            let _ = conn.execute(
                "UPDATE accounts SET is_primary = 1 WHERE id = (SELECT id FROM accounts WHERE is_active = 1 LIMIT 1)",
                [],
            );
        }
    }

    let _ = crypto::delete_api_key(&id);
    let _ = app.emit("accounts-changed", ());
    Ok(())
}

#[tauri::command]
pub fn update_account_alias(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    id: String,
    alias: String,
) -> Result<(), String> {
    {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE accounts SET alias = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![alias, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    let _ = app.emit("accounts-changed", ());
    Ok(())
}

#[tauri::command]
pub fn set_primary_account(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        // 切换逻辑：读取当前状态并翻转，不影响其他账号（支持多个收藏）
        let current: i32 = conn
            .query_row(
                "SELECT COALESCE(is_primary, 0) FROM accounts WHERE id = ?1 AND is_active = 1",
                rusqlite::params![id],
                |row| row.get(0),
            )
            .map_err(|_| "账号不存在或已停用".to_string())?;
        let new_val = if current == 1 { 0 } else { 1 };
        conn.execute(
            "UPDATE accounts SET is_primary = ?1 WHERE id = ?2",
            rusqlite::params![new_val, id],
        )
        .map_err(|e| e.to_string())?;
    }
    let _ = app.emit("accounts-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn validate_api_key(api_key: String) -> Result<String, String> {
    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    client
        .get_quota_limit()
        .await
        .map(|quota| quota.level)
        .map_err(|e| format!("API Key 验证失败: {}", e))
}

#[tauri::command]
pub fn mask_api_key(account_id: String) -> Result<String, String> {
    let api_key = crypto::get_api_key(&account_id)
        .map_err(|e| format!("API Key 读取失败: {}", e))?;
    Ok(crypto::mask_key(&api_key))
}

/// 获取账号的明文 API Key（用于复制到剪贴板）。仅从 Keychain 读取。
#[tauri::command]
pub fn get_api_key_raw(account_id: String) -> Result<String, String> {
    crypto::get_api_key(&account_id)
        .map_err(|e| format!("API Key 读取失败: {}", e))
}

/// 修改账号的 API Key
/// 先用新 Key 调智谱接口验证有效性（与 add_account 一致），通过后覆盖 Keychain 记录并刷新套餐等级
#[tauri::command]
pub fn update_api_key(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    account_id: String,
    new_api_key: String,
) -> Result<(), String> {
    // 1. 验证新 Key 有效性
    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &new_api_key);
    let quota = tauri::async_runtime::block_on(client.get_quota_limit())
        .map_err(|e| format!("API Key 验证失败: {}", e))?;

    // 2. 覆盖 Keychain 记录
    crypto::store_api_key(&account_id, &new_api_key)
        .map_err(|e| format!("凭据存储失败: {}", e))?;

    // 3. 刷新账号套餐等级 + updated_at，并清除残留的 DB 明文
    {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE accounts SET level = ?1, api_key = '', updated_at = ?2 WHERE id = ?3",
            rusqlite::params![quota.level, now, account_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let _ = app.emit("accounts-changed", ());
    Ok(())
}
