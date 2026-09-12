use serde::{Deserialize, Serialize};

/// V2 套餐（token 制）主额度类型
pub const LIMIT_TYPE_TOKENS: &str = "TOKENS_LIMIT";
/// V3 套餐（2026-07-30 起积分制）主额度类型。
/// 响应结构与 TOKENS_LIMIT 同构（unit=3 → 5 小时窗，unit=6 → 周窗），
/// 积分绝对值放在 usage（总量）/ currentValue（已用）/ remaining。
pub const LIMIT_TYPE_CREDIT: &str = "CREDIT_LIMIT";

/// 主额度类型（5 小时/周窗口）：V2 token 制或 V3 积分制
fn is_primary_limit_type(limit_type: &str) -> bool {
    limit_type == LIMIT_TYPE_TOKENS || limit_type == LIMIT_TYPE_CREDIT
}

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

impl QuotaData {
    pub fn token_limit_with_unit(&self, unit: f64) -> Option<&QuotaLimit> {
        self.limits
            .iter()
            .find(|limit| is_primary_limit_type(&limit.limit_type) && limit.unit == Some(unit))
    }

    pub fn five_hour_token_limit(&self) -> Option<&QuotaLimit> {
        self.token_limit_with_unit(3.0)
    }

    pub fn weekly_token_limit(&self) -> Option<&QuotaLimit> {
        self.token_limit_with_unit(6.0)
    }

    pub fn legacy_token_limit(&self) -> Option<&QuotaLimit> {
        self.limits
            .iter()
            .find(|limit| is_primary_limit_type(&limit.limit_type) && limit.unit.is_none())
    }

    /// 是否为 V3 积分制套餐（存在 CREDIT_LIMIT 主额度）
    pub fn is_credit_based(&self) -> bool {
        self.limits
            .iter()
            .any(|limit| limit.limit_type == LIMIT_TYPE_CREDIT)
    }

    /// 优先返回 5 小时窗口（unit=3，V3 积分或 V2 token）；旧数据或仅有周窗口时
    /// 回退到首个主额度，兼容缺少 unit 的历史快照和 Codex 周额度。
    pub fn preferred_token_limit(&self) -> Option<&QuotaLimit> {
        self.five_hour_token_limit()
            .or_else(|| self.legacy_token_limit())
            .or_else(|| {
                self.limits
                    .iter()
                    .find(|limit| is_primary_limit_type(&limit.limit_type))
            })
    }
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

// ========== 工具用量 ==========

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ToolUsageData {
    #[serde(rename = "toolUsage", default)]
    pub tool_usage: Vec<ToolUsageItem>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ToolUsageItem {
    pub tool: String,
    pub count: f64,
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

#[cfg(test)]
mod tests {
    use super::{QuotaData, QuotaLimit};

    fn token_limit(percentage: f64, unit: Option<f64>) -> QuotaLimit {
        QuotaLimit {
            limit_type: "TOKENS_LIMIT".to_string(),
            percentage,
            next_reset_time: 0,
            unit,
            number: None,
            usage: None,
            current_value: None,
            remaining: None,
            usage_details: None,
        }
    }

    /// V3 积分套餐 quota/limit 实测响应（2026-09-11，level=pro）：
    /// type 由 TOKENS_LIMIT 变为 CREDIT_LIMIT，unit 语义不变（3=5h，6=周）。
    #[test]
    fn deserialize_v3_credit_limit_response() {
        let json = r#"{
            "code": 200,
            "msg": "操作成功",
            "data": {
                "limits": [
                    {"type": "CREDIT_LIMIT", "unit": 3, "number": 5, "usage": 12000,
                     "currentValue": 931, "remaining": 11068, "percentage": 7,
                     "nextResetTime": 1789103420293},
                    {"type": "CREDIT_LIMIT", "unit": 6, "number": 1, "usage": 60000,
                     "currentValue": 12210, "remaining": 47789, "percentage": 20,
                     "nextResetTime": 1789628844984}
                ],
                "level": "pro"
            },
            "success": true
        }"#;
        #[derive(serde::Deserialize)]
        struct Wrapper {
            data: QuotaData,
        }
        let wrapper: Wrapper = serde_json::from_str(json).expect("V3 响应应能解析");
        let quota = wrapper.data;

        assert!(quota.is_credit_based());
        assert_eq!(quota.preferred_token_limit().unwrap().percentage, 7.0);
        assert_eq!(quota.five_hour_token_limit().unwrap().current_value, Some(931.0));
        assert_eq!(quota.five_hour_token_limit().unwrap().usage, Some(12000.0));
        assert_eq!(quota.weekly_token_limit().unwrap().percentage, 20.0);
        assert_eq!(quota.weekly_token_limit().unwrap().remaining, Some(47789.0));
    }

    #[test]
    fn v2_tokens_response_still_recognized() {
        let quota = QuotaData {
            limits: vec![token_limit(30.0, Some(3.0)), token_limit(50.0, Some(6.0))],
            level: "pro".to_string(),
            ..Default::default()
        };

        assert!(!quota.is_credit_based());
        assert_eq!(quota.preferred_token_limit().unwrap().percentage, 30.0);
        assert_eq!(quota.weekly_token_limit().unwrap().percentage, 50.0);
    }

    #[test]
    fn preferred_token_limit_uses_five_hour_window_regardless_of_order() {
        let quota = QuotaData {
            limits: vec![token_limit(70.0, Some(6.0)), token_limit(20.0, Some(3.0))],
            ..Default::default()
        };

        assert_eq!(quota.preferred_token_limit().unwrap().percentage, 20.0);
    }

    #[test]
    fn preferred_token_limit_falls_back_for_legacy_or_weekly_only_data() {
        let quota = QuotaData {
            limits: vec![token_limit(45.0, Some(6.0))],
            ..Default::default()
        };

        assert_eq!(quota.preferred_token_limit().unwrap().percentage, 45.0);
    }

    #[test]
    fn preferred_token_limit_uses_legacy_window_before_weekly_window() {
        let quota = QuotaData {
            limits: vec![token_limit(80.0, Some(6.0)), token_limit(25.0, None)],
            ..Default::default()
        };

        assert_eq!(quota.preferred_token_limit().unwrap().percentage, 25.0);
    }
}
