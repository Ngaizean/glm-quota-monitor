pub mod auth;
pub mod client;
pub mod crypto;
pub mod sync;
pub mod types;

use crate::api::types::{QuotaData, QuotaLimit};
use types::{UsageResponse, Window};

/// 将 Codex 的 wham/usage 响应转换为统一的 QuotaData
///
/// 真实 API 结构：
///   rate_limit.primary_window   (5h 窗口)  → TIME_LIMIT  → 前端归类为 hourly
///   rate_limit.secondary_window (7d 周额度) → TOKENS_LIMIT → 前端归类为 weekly
pub fn usage_to_quota_data(usage: &UsageResponse) -> QuotaData {
    let mut quota = QuotaData::default();
    quota.level = usage.plan_type.clone().unwrap_or_default();

    if let Some(ref rate_limit) = usage.rate_limit {
        // primary_window → 5h 窗口（对应 GLM 的 TOKENS_LIMIT + unit=3 / hourly）
        if let Some(ref window) = rate_limit.primary_window {
            quota.limits.push(window_to_quota_limit(window, "TOKENS_LIMIT", Some(3.0)));
        }
        // secondary_window → 周额度（对应 GLM 的 TOKENS_LIMIT + unit=6 / weekly）
        if let Some(ref window) = rate_limit.secondary_window {
            quota.limits.push(window_to_quota_limit(window, "TOKENS_LIMIT", Some(6.0)));
        }
    }

    quota
}

/// 将单个窗口转换为统一 QuotaLimit
/// reset_at 是 Unix 秒时间戳，转换为毫秒（QuotaLimit.next_reset_time 用毫秒）
fn window_to_quota_limit(window: &Window, limit_type: &str, unit: Option<f64>) -> QuotaLimit {
    let pct = window.used_percent;
    // 优先用 reset_at（绝对时间戳），回退到 reset_after_seconds（相对秒数）
    let reset_ms = if let Some(reset_at) = window.reset_at {
        reset_at * 1000
    } else if let Some(secs) = window.reset_after_seconds {
        chrono::Local::now().timestamp_millis() + (secs * 1000.0) as i64
    } else {
        0
    };

    QuotaLimit {
        limit_type: limit_type.to_string(),
        percentage: pct,
        next_reset_time: reset_ms,
        unit,
        number: None,
        usage: None,
        current_value: None,
        remaining: None,
        usage_details: None,
    }
}
