use crate::api::client::ZhipuClient;
use crate::crypto;
use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenUsagePeriod {
    pub label: String,
    pub total_tokens: f64,
    pub total_calls: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenUsageSummary {
    pub today: TokenUsagePeriod,
    pub last_7d: TokenUsagePeriod,
    pub last_30d: TokenUsagePeriod,
}

#[tauri::command]
pub fn get_usage_summary(db: State<'_, Database>, account_id: String) -> Result<TokenUsageSummary, String> {
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

    let now = chrono::Utc::now();
    let today_start = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
    let seven_days_ago = now - chrono::Duration::days(7);
    let thirty_days_ago = now - chrono::Duration::days(30);

    let fmt = |dt: chrono::DateTime<chrono::Utc>| dt.format("%Y-%m-%d %H:%M:%S").to_string();
    let now_str = fmt(now);
    let today_str = fmt(today_start);
    let seven_str = fmt(seven_days_ago);
    let thirty_str = fmt(thirty_days_ago);

    let fetch = |start: &str, end: &str, label: &str| -> Result<TokenUsagePeriod, String> {
        let data = tauri::async_runtime::block_on(client.get_model_usage(start, end))
            .map_err(|e| e.to_string())?;
        Ok(TokenUsagePeriod {
            label: label.to_string(),
            total_tokens: data.total_usage.total_tokens_usage,
            total_calls: data.total_usage.total_model_call_count,
        })
    };

    let today = fetch(&today_str, &now_str, "Today")?;
    let last_7d = fetch(&seven_str, &now_str, "7 Days")?;
    let last_30d = fetch(&thirty_str, &now_str, "30 Days")?;

    Ok(TokenUsageSummary { today, last_7d, last_30d })
}
