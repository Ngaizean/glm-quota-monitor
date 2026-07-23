use crate::api::client::ZhipuClient;
use crate::crypto;
use chrono::Timelike;
use serde::{Deserialize, Serialize};

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
pub async fn get_usage_summary(account_id: String) -> Result<TokenUsageSummary, String> {
    let api_key = crypto::get_api_key(&account_id)
        .map_err(|e| format!("API Key 读取失败: {}", e))?;

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
