use serde::{Deserialize, Serialize};

/// GET https://api.deepseek.com/user/balance 的响应
///
/// 实际结构（已验证）：
/// {
///   "is_available": true,
///   "balance_infos": [
///     { "currency": "CNY", "total_balance": "10.50",
///       "granted_balance": "5.00", "topped_up_balance": "5.50" }
///   ]
/// }
///
/// 余额字段一律以字符串返回，在转换器处 parse::<f64>()，避免 DTO 层浮点误差。
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct BalanceResponse {
    #[serde(default)]
    pub is_available: bool,
    #[serde(default, rename = "balance_infos")]
    pub balance_infos: Vec<BalanceInfo>,
}

/// 单个币种的余额条目。DeepSeek 可能返回 CNY、USD，或两者皆有（双币种账号）。
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct BalanceInfo {
    #[serde(default)]
    pub currency: String,
    #[serde(default, rename = "total_balance")]
    pub total_balance: String,
    /// 赠送余额（优先被消耗；API 不暴露过期时间）
    #[serde(default, rename = "granted_balance")]
    pub granted_balance: String,
    /// 充值余额
    #[serde(default, rename = "topped_up_balance")]
    pub topped_up_balance: String,
}

/// GET https://api.deepseek.com/models 的响应（OpenAI 兼容形状）
/// { "object": "list", "data": [{ "id": "deepseek-v4-flash", "object": "model", "owned_by": "deepseek" }] }
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct ModelsResponse {
    #[serde(default)]
    pub object: String,
    #[serde(default)]
    pub data: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct ModelEntry {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub object: String,
    #[serde(default, rename = "owned_by")]
    pub owned_by: String,
}
