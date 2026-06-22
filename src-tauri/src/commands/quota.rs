use crate::api::client::ZhipuClient;
use crate::api::types::QuotaData;
use crate::crypto;
use crate::db::{self, Database};
use crate::fetch_today_tokens;
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
    }).ok_or("API Key 未找到".to_string())?;

    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    let quota = tauri::async_runtime::block_on(client.get_quota_limit())
        .map_err(|e| e.to_string())?;

    // 获取真实的今日 token 用量（修复此前硬编码 0.0 导致趋势图被污染的 bug）
    let today_tokens = fetch_today_tokens(&client);

    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    db::record_quota_snapshot(&conn, &account_id, &quota, today_tokens)
        .map_err(|e| e.to_string())?;

    Ok(quota)
}
