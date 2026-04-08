use crate::db::models::UsageSnapshot;
use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn get_snapshots(
    db: State<'_, Database>,
    account_id: String,
    limit: Option<i32>,
) -> Result<Vec<UsageSnapshot>, String> {
    let conn = db.conn.lock().unwrap();
    let limit = limit.unwrap_or(100);
    let mut stmt = conn
        .prepare(
            "SELECT id, account_id, timestamp, time_limit_pct, time_limit_reset,
                    token_limit_pct, token_limit_reset, mcp_limit_pct, mcp_limit_reset,
                    total_tokens_24h, total_calls_24h
             FROM usage_snapshots
             WHERE account_id = ?1
             ORDER BY timestamp DESC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let snapshots = stmt
        .query_map(rusqlite::params![account_id, limit], |row| {
            Ok(UsageSnapshot {
                id: row.get(0)?,
                account_id: row.get(1)?,
                timestamp: row.get(2)?,
                time_limit_pct: row.get(3)?,
                time_limit_reset: row.get(4)?,
                token_limit_pct: row.get(5)?,
                token_limit_reset: row.get(6)?,
                mcp_limit_pct: row.get(7)?,
                mcp_limit_reset: row.get(8)?,
                total_tokens_24h: row.get(9)?,
                total_calls_24h: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|s| s.ok())
        .collect();

    Ok(snapshots)
}
