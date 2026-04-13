use crate::api::client::ZhipuClient;
use crate::crypto;
use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenUsagePeriod {
    pub label: String,
    /// Token 总用量（原始值，单位取决于 API 返回）
    pub total_tokens: f64,
    /// 模型调用次数
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
    let api_key = match crypto::get_api_key(&account_id) {
        Ok(key) => key,
        Err(_) => {
            let conn = db.conn.lock().unwrap();
            let db_key: String = conn
                .query_row(
                    "SELECT api_key FROM accounts WHERE id = ?1",
                    rusqlite::params![account_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("账号不存在: {}", e))?;
            if db_key.is_empty() {
                return Err("API key not found".to_string());
            }
            let _ = crypto::store_api_key(&account_id, &db_key);
            let _ = conn.execute("UPDATE accounts SET api_key = '' WHERE id = ?1", rusqlite::params![account_id]);
            db_key
        }
    };

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
