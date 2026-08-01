pub mod auth;
pub mod client;
pub mod types;

use crate::api::types::{QuotaData, QuotaLimit};
use types::{BalanceInfo, BalanceResponse};

/// DeepSeek 余额 limit_type 标识（自由字符串，共享 api::types 无需改动）。
pub const LIMIT_TYPE_BALANCE: &str = "DEEPSEEK_BALANCE";

/// 将 DeepSeek /user/balance 响应转换为统一 QuotaData。
///
/// DeepSeek 返回的是**绝对货币余额**，不是百分比。每个 balance_infos 条目产出
/// 一个 DEEPSEEK_BALANCE QuotaLimit：
///   - `current_value` / `remaining` = total_balance（当前剩余，最有用的单一数字）
///   - `number` = granted + topped_up（累计充值/赠送总额，仅作信息性「上限」类比）
///   - `usage`   = (granted + topped_up) - total（已消耗）
///   - `percentage` = 0.0（哨兵值「非百分比」，前端忽略，**不合成假百分比**）
///
/// 该 QuotaLimit 仅用于让现有 RefreshResult / 徽章 / 托盘 plumbing 承载 DeepSeek 数据；
/// popover 富展示走 `get_deepseek_balance` 返回的 [`DeepSeekBalanceView`]。
pub fn balance_to_quota_data(balance: &BalanceResponse) -> QuotaData {
    let mut quota = QuotaData::default();
    for info in &balance.balance_infos {
        if let Some(limit) = balance_info_to_limit(info) {
            quota.limits.push(limit);
        }
    }
    if !balance.is_available {
        quota.error = Some("DeepSeek 账户不可用（is_available=false）".to_string());
    }
    quota
}

/// 单条 BalanceInfo -> QuotaLimit。余额字段解析失败时返回 None（跳过该币种，勿整体失败）。
fn balance_info_to_limit(info: &BalanceInfo) -> Option<QuotaLimit> {
    let total = parse_money(&info.total_balance)?;
    let granted = parse_money(&info.granted_balance).unwrap_or(0.0);
    let topped_up = parse_money(&info.topped_up_balance).unwrap_or(0.0);
    let lifetime = granted + topped_up;
    Some(QuotaLimit {
        limit_type: LIMIT_TYPE_BALANCE.to_string(),
        percentage: 0.0,
        next_reset_time: 0,
        unit: None,
        number: Some(lifetime),
        usage: Some((lifetime - total).max(0.0)),
        current_value: Some(total),
        remaining: Some(total),
        usage_details: None,
    })
}

/// DeepSeek 余额以字符串返回（如 "10.50"），解析为 f64；空串/非法 -> None。
fn parse_money(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    s.parse::<f64>().ok()
}

// ========== 返回给前端的富视图（get_deepseek_balance / get_deepseek_balance_history）==========

/// 单个币种的余额视图（已解析为 f64）。
#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeepSeekBalanceEntry {
    pub currency: String,
    pub total: f64,
    pub granted: f64,
    pub topped_up: f64,
}

/// get_deepseek_balance 返回的富视图：余额 + 模型列表 + 状态，供 popover 专属组件渲染。
#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeepSeekBalanceView {
    pub is_available: bool,
    pub balances: Vec<DeepSeekBalanceEntry>,
    pub models: Vec<String>,
    /// DeepSeek 该 API 不暴露套餐层级，留空。
    pub level: Option<String>,
    pub last_active: Option<String>,
    pub error: Option<String>,
    pub is_offline: bool,
}

/// 余额历史点（get_deepseek_balance_history 返回，读 deepseek_snapshots 表）。
#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeepSeekBalancePoint {
    pub timestamp: String,
    pub currency: String,
    pub total_balance: f64,
    pub granted_balance: f64,
    pub topped_up_balance: f64,
}

/// 将原始 BalanceResponse 转为前端视图条目（解析字符串余额，跳过非法条目）。
pub fn balance_view_entries(balance: &BalanceResponse) -> Vec<DeepSeekBalanceEntry> {
    balance
        .balance_infos
        .iter()
        .filter_map(|i| {
            let total = parse_money(&i.total_balance)?;
            Some(DeepSeekBalanceEntry {
                currency: if i.currency.is_empty() {
                    "CNY".to_string()
                } else {
                    i.currency.clone()
                },
                total,
                granted: parse_money(&i.granted_balance).unwrap_or(0.0),
                topped_up: parse_money(&i.topped_up_balance).unwrap_or(0.0),
            })
        })
        .collect()
}
