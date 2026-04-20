use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Account {
    pub id: String,
    pub alias: String,
    pub purpose: String,
    pub platform: String,
    pub level: Option<String>,
    pub is_active: bool,
    pub is_primary: bool,
    pub created_at: String,
    pub updated_at: String,
    // api_key 不序列化到前端，仅在内部使用
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UsageSnapshot {
    pub id: i64,
    pub account_id: String,
    pub timestamp: String,
    pub time_limit_pct: Option<f64>,
    pub time_limit_reset: Option<i64>,
    pub token_limit_pct: Option<f64>,
    pub token_limit_reset: Option<i64>,
    pub mcp_limit_pct: Option<f64>,
    pub mcp_limit_reset: Option<i64>,
    pub total_tokens_24h: Option<i64>,
    pub total_calls_24h: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AlertRule {
    pub id: i64,
    pub rule_type: String,
    pub threshold: f64,
    pub enabled: bool,
    pub account_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AlertRecord {
    pub id: i64,
    pub account_id: String,
    pub rule_type: String,
    pub value: Option<f64>,
    pub triggered_at: String,
    pub dismissed: bool,
}
