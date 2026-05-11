use crate::api::client::ZhipuClient;
use crate::crypto;
use crate::db::Database;
use chrono::Timelike;
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
pub async fn get_usage_summary(db: State<'_, Database>, account_id: String) -> Result<TokenUsageSummary, String> {
    let db_key = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        conn.query_row(
            "SELECT api_key FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| row.get::<_, String>(0),
        ).map_err(|e| format!("账号不存在: {}", e))?
    };

    let api_key = crypto::resolve_api_key(&account_id, &db_key, &|| {
        if let Ok(c) = db.conn.lock() {
            let _ = c.execute("UPDATE accounts SET api_key = '' WHERE id = ?1", rusqlite::params![account_id]);
        }
    }).ok_or("API key not found".to_string())?;

    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);

    let now = chrono::Local::now();
    let today_start = now
        .with_hour(0).unwrap()
        .with_minute(0).unwrap()
        .with_second(0).unwrap();
    let seven_days_ago = now - chrono::Duration::days(7);
    let thirty_days_ago = now - chrono::Duration::days(30);

    let fmt = |dt: chrono::DateTime<chrono::Local>| dt.format("%Y-%m-%d %H:%M:%S").to_string();
    let now_str = fmt(now);
    let today_str = fmt(today_start);
    let seven_str = fmt(seven_days_ago);
    let thirty_str = fmt(thirty_days_ago);

    let (today_res, seven_res, thirty_res) = tokio::join!(
        client.get_model_usage(&today_str, &now_str),
        client.get_model_usage(&seven_str, &now_str),
        client.get_model_usage(&thirty_str, &now_str),
    );

    let today_data = today_res.map_err(|e| e.to_string())?;
    let seven_data = seven_res.map_err(|e| e.to_string())?;
    let thirty_data = thirty_res.map_err(|e| e.to_string())?;

    Ok(TokenUsageSummary {
        today: TokenUsagePeriod {
            label: "Today".to_string(),
            total_tokens: today_data.total_usage.total_tokens_usage,
            total_calls: today_data.total_usage.total_model_call_count,
        },
        last_7d: TokenUsagePeriod {
            label: "7 Days".to_string(),
            total_tokens: seven_data.total_usage.total_tokens_usage,
            total_calls: seven_data.total_usage.total_model_call_count,
        },
        last_30d: TokenUsagePeriod {
            label: "30 Days".to_string(),
            total_tokens: thirty_data.total_usage.total_tokens_usage,
            total_calls: thirty_data.total_usage.total_model_call_count,
        },
    })
}
