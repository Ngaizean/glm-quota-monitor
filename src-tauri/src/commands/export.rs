use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn export_usage_csv(
    db: State<'_, Database>,
    account_id: String,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT timestamp, time_limit_pct, time_limit_reset, \
                    token_limit_pct, token_limit_reset, \
                    mcp_limit_pct, mcp_limit_reset, \
                    total_tokens_24h, total_calls_24h \
             FROM usage_snapshots WHERE account_id = ?1 \
             ORDER BY timestamp ASC",
        )
        .map_err(|e| e.to_string())?;

    let mut csv = String::from("timestamp,time_limit_pct,time_limit_reset,token_limit_pct,token_limit_reset,mcp_limit_pct,mcp_limit_reset,total_tokens_24h,total_calls_24h\n");

    let rows = stmt
        .query_map(rusqlite::params![account_id], |row| {
            let ts: String = row.get(0)?;
            let t_pct: Option<f64> = row.get(1)?;
            let t_reset: Option<i64> = row.get(2)?;
            let k_pct: Option<f64> = row.get(3)?;
            let k_reset: Option<i64> = row.get(4)?;
            let m_pct: Option<f64> = row.get(5)?;
            let m_reset: Option<i64> = row.get(6)?;
            let tokens: Option<f64> = row.get(7)?;
            let calls: Option<i32> = row.get(8)?;
            Ok((ts, t_pct, t_reset, k_pct, k_reset, m_pct, m_reset, tokens, calls))
        })
        .map_err(|e| e.to_string())?;

    for row in rows.filter_map(|r| r.ok()) {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{}\n",
            row.0,
            row.1.map(|v| v.to_string()).unwrap_or_default(),
            row.2.map(|v| v.to_string()).unwrap_or_default(),
            row.3.map(|v| v.to_string()).unwrap_or_default(),
            row.4.map(|v| v.to_string()).unwrap_or_default(),
            row.5.map(|v| v.to_string()).unwrap_or_default(),
            row.6.map(|v| v.to_string()).unwrap_or_default(),
            row.7.map(|v| v.to_string()).unwrap_or_default(),
            row.8.map(|v| v.to_string()).unwrap_or_default(),
        ));
    }

    Ok(csv)
}

#[tauri::command]
pub fn export_usage_json(
    db: State<'_, Database>,
    account_id: String,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT timestamp, time_limit_pct, time_limit_reset, \
                    token_limit_pct, token_limit_reset, \
                    mcp_limit_pct, mcp_limit_reset, \
                    total_tokens_24h, total_calls_24h \
             FROM usage_snapshots WHERE account_id = ?1 \
             ORDER BY timestamp ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![account_id], |row| {
            let ts: String = row.get(0)?;
            let t_pct: Option<f64> = row.get(1)?;
            let t_reset: Option<i64> = row.get(2)?;
            let k_pct: Option<f64> = row.get(3)?;
            let k_reset: Option<i64> = row.get(4)?;
            let m_pct: Option<f64> = row.get(5)?;
            let m_reset: Option<i64> = row.get(6)?;
            let tokens: Option<f64> = row.get(7)?;
            let calls: Option<i32> = row.get(8)?;
            Ok(serde_json::json!({
                "timestamp": ts,
                "time_limit_pct": t_pct,
                "time_limit_reset": t_reset,
                "token_limit_pct": k_pct,
                "token_limit_reset": k_reset,
                "mcp_limit_pct": m_pct,
                "mcp_limit_reset": m_reset,
                "total_tokens_24h": tokens,
                "total_calls_24h": calls,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    serde_json::to_string_pretty(&rows).map_err(|e| format!("JSON 序列化失败: {}", e))
}
