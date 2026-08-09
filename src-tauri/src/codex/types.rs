use serde::{Deserialize, Serialize};

/// GET /backend-api/wham/usage 的响应
/// 实际结构（已验证）：
/// {
///   "plan_type": "prolite",
///   "rate_limit": {
///     "primary_window": { used_percent, limit_window_seconds, reset_after_seconds, reset_at },
///     "secondary_window": { ... }
///   }
/// }
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct UsageResponse {
    #[serde(default)]
    pub plan_type: Option<String>,
    #[serde(default)]
    pub rate_limit: Option<RateLimitRoot>,
    /// 额外模型额度（如 GPT-5.3-Codex-Spark），每个含独立的 primary/secondary 窗口
    #[serde(default, rename = "additional_rate_limits")]
    pub additional_rate_limits: Vec<AdditionalRateLimit>,
}

/// 额外模型的额度限制（如 Spark）
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AdditionalRateLimit {
    /// 模型名称，如 "GPT-5.3-Codex-Spark"
    #[serde(default, rename = "limit_name")]
    pub limit_name: String,
    #[serde(default, rename = "metered_feature")]
    pub metered_feature: Option<String>,
    #[serde(default)]
    pub rate_limit: RateLimitRoot,
}

/// rate_limit 根对象
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct RateLimitRoot {
    #[serde(default)]
    pub allowed: Option<bool>,
    #[serde(default, rename = "limit_reached")]
    pub limit_reached: Option<bool>,
    #[serde(default)]
    pub primary_window: Option<Window>,
    #[serde(default)]
    pub secondary_window: Option<Window>,
}

/// 单个窗口（5h 或 weekly）
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Window {
    /// 使用百分比（0-100）
    #[serde(default)]
    pub used_percent: f64,
    /// 窗口总时长（秒），primary=18000(5h)，secondary=604800(7d)
    #[serde(default, rename = "limit_window_seconds")]
    pub limit_window_seconds: Option<f64>,
    /// 距离重置的秒数
    #[serde(default, rename = "reset_after_seconds")]
    pub reset_after_seconds: Option<f64>,
    /// 重置时间戳（Unix 秒）
    #[serde(default)]
    pub reset_at: Option<i64>,
}

/// ~/.codex/auth.json 的结构
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct AuthJson {
    #[serde(default, rename = "OPENAI_API_KEY")]
    pub openai_api_key: Option<serde_json::Value>,
    #[serde(default, rename = "last_refresh")]
    pub last_refresh: Option<String>,
    #[serde(default)]
    pub tokens: Tokens,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct Tokens {
    #[serde(default)]
    pub access_token: String,
    #[serde(default, rename = "id_token")]
    pub id_token: String,
    #[serde(default, rename = "refresh_token")]
    pub refresh_token: String,
    #[serde(default, rename = "account_id")]
    pub account_id: String,
}

/// 返回给前端的脱敏摘要（不含任何 token 明文）
#[derive(Debug, Serialize, Clone)]
pub struct AuthSummary {
    pub exists: bool,
    pub account_id: String,
    pub last_refresh: Option<String>,
    /// access_token 过期时间（ISO 8601），从 JWT exp 解码
    pub access_token_exp: Option<String>,
    pub plan_type: Option<String>,
}

impl AuthJson {
    /// 从 access_token JWT 解码 exp（过期时间）
    /// JWT 结构：header.payload.signature，payload 是 base64url 编码的 JSON
    pub fn access_token_exp_iso(&self) -> Option<String> {
        let parts: Vec<&str> = self.tokens.access_token.split('.').collect();
        if parts.len() < 2 {
            return None;
        }
        use base64::Engine;
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[1])
            .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(parts[1]))
            .ok()?;
        let v: serde_json::Value = serde_json::from_slice(&payload).ok()?;
        let exp = v.get("exp")?.as_i64()?;
        chrono::DateTime::from_timestamp(exp, 0).map(|dt| dt.to_rfc3339())
    }
}
