use crate::api::client::ZhipuClient;
use crate::api::types::QuotaData;
use crate::crypto;
use crate::db::Database;
use chrono::Utc;
use tauri::State;

#[tauri::command]
pub fn get_quota(db: State<'_, Database>, account_id: String) -> Result<QuotaData, String> {
    let api_key = get_decrypted_api_key(&db, &account_id)?;
    let client = ZhipuClient::new(&api_key);
    let quota = tauri::async_runtime::block_on(client.get_quota_limit())
        .map_err(|e| e.to_string())?;

    // 记录快照
    let conn = db.conn.lock().unwrap();
    let now = Utc::now().to_rfc3339();
    let time_limit = quota.limits.iter().find(|l| l.limit_type == "TIME_LIMIT");
    let token_limit = quota.limits.iter().find(|l| l.limit_type == "TOKENS_LIMIT");

    conn.execute(
        "INSERT INTO usage_snapshots (account_id, timestamp, time_limit_pct, time_limit_reset, token_limit_pct, token_limit_reset)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            account_id,
            now,
            time_limit.map(|l| l.percentage as f64),
            time_limit.map(|l| l.next_reset_time),
            token_limit.map(|l| l.percentage as f64),
            token_limit.map(|l| l.next_reset_time),
        ],
    )
    .map_err(|e| e.to_string())?;

    // 更新账号等级
    conn.execute(
        "UPDATE accounts SET level = ?1 WHERE id = ?2",
        rusqlite::params![quota.level, account_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(quota)
}

fn get_decrypted_api_key(db: &Database, account_id: &str) -> Result<String, String> {
    let conn = db.conn.lock().unwrap();
    let encrypted: String = conn
        .query_row(
            "SELECT api_key FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    crypto::decrypt(&encrypted).map_err(|e| e.to_string())
}
