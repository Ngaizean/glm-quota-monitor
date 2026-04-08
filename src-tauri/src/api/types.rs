use serde::{Deserialize, Serialize};

/// API 通用响应包装
#[derive(Debug, Deserialize)]
pub struct ApiResponse<T> {
    pub code: i32,
    pub msg: Option<String>,
    pub data: Option<T>,
    pub success: bool,
}

// ========== 额度查询 ==========

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct QuotaData {
    pub limits: Vec<QuotaLimit>,
    pub level: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct QuotaLimit {
    #[serde(rename = "type")]
    pub limit_type: String,
    pub percentage: i32,
    #[serde(rename = "nextResetTime")]
    pub next_reset_time: i64,
    pub unit: Option<i32>,
    pub number: Option<i32>,
    pub usage: Option<i32>,
    #[serde(rename = "currentValue")]
    pub current_value: Option<i32>,
    pub remaining: Option<i32>,
    #[serde(rename = "usageDetails")]
    pub usage_details: Option<Vec<UsageDetail>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UsageDetail {
    #[serde(rename = "modelCode")]
    pub model_code: String,
    pub usage: i32,
}

// ========== 模型用量 ==========

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ModelUsageData {
    #[serde(rename = "x_time")]
    pub x_time: Vec<String>,
    #[serde(rename = "modelCallCount")]
    pub model_call_count: Vec<Option<i32>>,
    #[serde(rename = "tokensUsage")]
    pub tokens_usage: Vec<Option<i64>>,
    #[serde(rename = "totalUsage")]
    pub total_usage: TotalModelUsage,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TotalModelUsage {
    #[serde(rename = "totalModelCallCount")]
    pub total_model_call_count: i32,
    #[serde(rename = "totalTokensUsage")]
    pub total_tokens_usage: i64,
}

// ========== 工具用量 ==========

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ToolUsageData {
    #[serde(rename = "x_time")]
    pub x_time: Vec<String>,
    #[serde(rename = "networkSearchCount")]
    pub network_search_count: Vec<Option<i32>>,
    #[serde(rename = "webReadMcpCount")]
    pub web_read_mcp_count: Vec<Option<i32>>,
    #[serde(rename = "zreadMcpCount")]
    pub zread_mcp_count: Vec<Option<i32>>,
    #[serde(rename = "totalUsage")]
    pub total_usage: TotalToolUsage,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TotalToolUsage {
    #[serde(rename = "totalNetworkSearchCount")]
    pub total_network_search_count: i32,
    #[serde(rename = "totalWebReadMcpCount")]
    pub total_web_read_mcp_count: i32,
    #[serde(rename = "totalZreadMcpCount")]
    pub total_zread_mcp_count: i32,
    #[serde(rename = "totalSearchMcpCount")]
    pub total_search_mcp_count: i32,
    #[serde(rename = "toolDetails")]
    pub tool_details: Option<Vec<ToolDetail>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ToolDetail {
    #[serde(rename = "modelName")]
    pub model_name: String,
    #[serde(rename = "totalUsageCount")]
    pub total_usage_count: i32,
}
