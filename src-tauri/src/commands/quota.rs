use crate::api::client::ZhipuClient;
use crate::api::types::QuotaData;
use crate::crypto;
use crate::db::{self, Database};
use tauri::State;

#[tauri::command]
pub fn get_quota(db: State<'_, Database>, account_id: String) -> Result<QuotaData, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let db_key: String = conn
        .query_row(
            "SELECT api_key FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("账号不存在: {}", e))?;
    drop(conn);

    let api_key = crypto::resolve_api_key(&account_id, &db_key, &|| {
        if let Ok(c) = db.conn.lock() {
            let _ = c.execute("UPDATE accounts SET api_key = '' WHERE id = ?1", rusqlite::params![account_id]);
        }
    }).ok_or("API key not found".to_string())?;

    let client = ZhipuClient::new(&api_key);
    let quota = tauri::async_runtime::block_on(client.get_quota_limit())
        .map_err(|e| e.to_string())?;

    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    db::record_quota_snapshot(&conn, &account_id, &quota)
        .map_err(|e| e.to_string())?;

    Ok(quota)
}
