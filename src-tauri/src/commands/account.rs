use crate::api::client::ZhipuClient;
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
    // 检查 alias + purpose 是否重复
    {
        let conn = db.conn.lock().unwrap();
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM accounts WHERE alias = ?1 AND purpose = ?2 AND is_active = 1",
                rusqlite::params![alias, purpose],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if exists {
            return Err(format!(
                "账号 '{}' 已存在用途 '{}'，请使用不同用途",
                alias, purpose
            ));
        }
    }

    // 验证 API Key
    let client = ZhipuClient::new(&api_key);
    let quota = tauri::async_runtime::block_on(client.get_quota_limit())
        .map_err(|e| format!("API Key 验证失败: {}", e))?;

    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();

    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO accounts (id, alias, purpose, platform, level, api_key, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'zhipu', ?4, ?5, 1, ?6, ?7)",
            rusqlite::params![id, alias, purpose, quota.level, api_key, now, now],
        )
        .map_err(|e| e.to_string())?;
    }

    let _ = app.emit("accounts-changed", ());

    Ok(Account {
        id,
        alias,
        purpose,
        platform: "zhipu".to_string(),
        level: Some(quota.level),
        is_active: true,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn list_accounts(db: State<'_, Database>) -> Result<Vec<Account>, String> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, alias, purpose, platform, level, is_active, created_at, updated_at FROM accounts WHERE is_active = 1")
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
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
        let conn = db.conn.lock().unwrap();
        // 按外键依赖顺序删除
        conn.execute(
            "DELETE FROM alert_history WHERE account_id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM alert_rules WHERE account_id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM usage_snapshots WHERE account_id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM accounts WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
    }
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
        let conn = db.conn.lock().unwrap();
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
