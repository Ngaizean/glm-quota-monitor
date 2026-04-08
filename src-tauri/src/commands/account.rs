use crate::api::client::ZhipuClient;
use crate::crypto;
use crate::db::models::Account;
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::db::Database;

#[tauri::command]
pub fn add_account(
    db: State<'_, Database>,
    alias: String,
    api_key: String,
) -> Result<Account, String> {
    // 先验证 API Key 是否有效
    let client = ZhipuClient::new(&api_key);
    let quota = tauri::async_runtime::block_on(client.get_quota_limit())
        .map_err(|e| format!("API Key 验证失败: {}", e))?;

    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();

    // API Key 存到系统 Keychain，数据库只存 id 和元数据
    crypto::store_api_key(&id, &api_key).map_err(|e| e.to_string())?;

    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO accounts (id, alias, platform, level, api_key, is_active, created_at, updated_at)
         VALUES (?1, ?2, 'zhipu', ?3, 'stored-in-keychain', 1, ?4, ?5)",
        rusqlite::params![id, alias, quota.level, now, now],
    )
    .map_err(|e| {
        // 数据库写入失败时清理 Keychain
        let _ = crypto::delete_api_key(&id);
        e.to_string()
    })?;

    Ok(Account {
        id,
        alias,
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
        .prepare("SELECT id, alias, platform, level, is_active, created_at, updated_at FROM accounts WHERE is_active = 1")
        .map_err(|e| e.to_string())?;

    let accounts = stmt
        .query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                alias: row.get(1)?,
                platform: row.get(2)?,
                level: row.get(3)?,
                is_active: row.get::<_, i32>(4)? == 1,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|a| a.ok())
        .collect();

    Ok(accounts)
}

#[tauri::command]
pub fn delete_account(db: State<'_, Database>, id: String) -> Result<(), String> {
    // 先从 Keychain 删除
    let _ = crypto::delete_api_key(&id);

    let conn = db.conn.lock().unwrap();
    conn.execute("DELETE FROM accounts WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM usage_snapshots WHERE account_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_account_alias(
    db: State<'_, Database>,
    id: String,
    alias: String,
) -> Result<(), String> {
    let conn = db.conn.lock().unwrap();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE accounts SET alias = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![alias, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
