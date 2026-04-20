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

    crypto::store_api_key(&id, &api_key)
        .map_err(|e| format!("凭据存储失败: {}", e))?;

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
        conn.execute("UPDATE accounts SET is_primary = 0", [])
            .map_err(|e| e.to_string())?;
        conn.execute("UPDATE accounts SET is_primary = 1 WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| e.to_string())?;
    }
    let _ = app.emit("accounts-changed", ());
    Ok(())
}
