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

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct QuotaData {
    #[serde(default)]
    pub limits: Vec<QuotaLimit>,
    /// level 可能为 null（无用量/未激活时）
    #[serde(default, deserialize_with = "deserialize_string_or_null")]
    pub level: String,
    #[serde(default)]
    pub last_active: Option<String>,
    /// API 调用失败时的错误信息（如 401 Key 无效）
    #[serde(default, skip_deserializing)]
    pub error: Option<String>,
    /// 是否为离线降级数据（来自本地缓存）
    #[serde(default, skip_deserializing)]
    pub is_offline: bool,
}

/// 兼容 API 返回 null / 缺失字段时默认为空字符串
fn deserialize_string_or_null<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(|v| v.unwrap_or_default())
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct QuotaLimit {
    #[serde(rename = "type")]
    pub limit_type: String,
    /// percentage 可能返回整数或浮点数（如 0.0），用 f64 兼容
    #[serde(deserialize_with = "deserialize_as_f64")]
    pub percentage: f64,
    #[serde(rename = "nextResetTime", default)]
    pub next_reset_time: i64,
    #[serde(default)]
    pub unit: Option<f64>,
    #[serde(default)]
    pub number: Option<f64>,
    #[serde(default)]
    pub usage: Option<f64>,
    #[serde(rename = "currentValue", default)]
    pub current_value: Option<f64>,
    #[serde(default)]
    pub remaining: Option<f64>,
    #[serde(rename = "usageDetails", default)]
    pub usage_details: Option<Vec<UsageDetail>>,
}

/// 兼容 JSON 中整数和浮点数两种格式
fn deserialize_as_f64<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};
    struct F64Visitor;
    impl<'de> Visitor<'de> for F64Visitor {
        type Value = f64;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a number")
        }
        fn visit_f64<E: de::Error>(self, v: f64) -> Result<f64, E> {
            Ok(v)
        }
        fn visit_i64<E: de::Error>(self, v: i64) -> Result<f64, E> {
            Ok(v as f64)
        }
        fn visit_u64<E: de::Error>(self, v: u64) -> Result<f64, E> {
            Ok(v as f64)
        }
        fn visit_none<E: de::Error>(self) -> Result<f64, E> {
            Ok(0.0)
        }
    }
    deserializer.deserialize_any(F64Visitor)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UsageDetail {
    #[serde(rename = "modelCode")]
    pub model_code: String,
    pub usage: f64,
}

// ========== 模型用量 ==========

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ModelUsageData {
    #[serde(rename = "x_time", default)]
    pub x_time: Vec<String>,
    #[serde(rename = "modelCallCount", default)]
    pub model_call_count: Vec<Option<f64>>,
    #[serde(rename = "tokensUsage", default)]
    pub tokens_usage: Vec<Option<f64>>,
    #[serde(rename = "totalUsage", default)]
    pub total_usage: TotalModelUsage,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct TotalModelUsage {
    #[serde(rename = "totalModelCallCount", default)]
    pub total_model_call_count: f64,
    #[serde(rename = "totalTokensUsage", default)]
    pub total_tokens_usage: f64,
}

// ========== 模型列表 ==========

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ModelListResponse {
    pub data: Vec<ModelInfo>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ModelInfo {
    pub id: String,
}

