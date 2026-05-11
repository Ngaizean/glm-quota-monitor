use crate::db::Database;
use tauri::State;

/// 转义 CSV 字段：含逗号/引号/换行时用双引号包裹，内部引号双写
fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn fmt_opt<T: std::fmt::Display>(v: Option<T>) -> String {
    v.map(|v| v.to_string()).unwrap_or_default()
}

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
            let calls: Option<f64> = row.get(8)?;
            Ok((ts, t_pct, t_reset, k_pct, k_reset, m_pct, m_reset, tokens, calls))
        })
        .map_err(|e| e.to_string())?;

    for row in rows.filter_map(|r| r.ok()) {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{}\n",
            csv_escape(&row.0),
            fmt_opt(row.1),
            fmt_opt(row.2),
            fmt_opt(row.3),
            fmt_opt(row.4),
            fmt_opt(row.5),
            fmt_opt(row.6),
            fmt_opt(row.7),
            fmt_opt(row.8),
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
            let calls: Option<f64> = row.get(8)?;
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
