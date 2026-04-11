use crate::db::models::{PeriodSummary, UsageSummary};
use crate::db::Database;
use chrono::{Duration, Utc};
use tauri::State;

fn query_period(conn: &rusqlite::Connection, account_id: &str, since: &str, label: &str) -> PeriodSummary {
    let result: Result<(i32, Option<f64>, Option<f64>, Option<f64>, Option<f64>), _> = conn.query_row(
        "SELECT
            COUNT(*) as snapshot_count,
            AVG(token_limit_pct) as avg_token_pct,
            MAX(token_limit_pct) as peak_token_pct,
            AVG(time_limit_pct) as avg_time_pct,
            MAX(time_limit_pct) as peak_time_pct
         FROM usage_snapshots
         WHERE account_id = ?1 AND timestamp >= ?2",
        rusqlite::params![account_id, since],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    );

    match result {
        Ok((count, avg_token, peak_token, avg_time, peak_time)) => PeriodSummary {
            period_label: label.to_string(),
            snapshot_count: count,
            avg_token_limit_pct: avg_token,
            peak_token_limit_pct: peak_token,
            avg_time_limit_pct: avg_time,
            peak_time_limit_pct: peak_time,
        },
        Err(_) => PeriodSummary {
            period_label: label.to_string(),
            snapshot_count: 0,
            avg_token_limit_pct: None,
            peak_token_limit_pct: None,
            avg_time_limit_pct: None,
            peak_time_limit_pct: None,
        },
    }
}

#[tauri::command]
pub fn get_usage_summary(db: State<'_, Database>, account_id: String) -> Result<UsageSummary, String> {
    let conn = db.conn.lock().unwrap();

    let today_start = Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .to_rfc3339();
    let seven_days_ago = (Utc::now() - Duration::days(7)).to_rfc3339();
    let thirty_days_ago = (Utc::now() - Duration::days(30)).to_rfc3339();

    let today = query_period(&conn, &account_id, &today_start, "today");
    let last_7d = query_period(&conn, &account_id, &seven_days_ago, "7d");
    let last_30d = query_period(&conn, &account_id, &thirty_days_ago, "30d");

    Ok(UsageSummary { today, last_7d, last_30d })
}
