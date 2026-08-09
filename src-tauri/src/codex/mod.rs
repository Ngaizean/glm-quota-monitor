pub mod auth;
pub mod client;
pub mod crypto;
pub mod ssh;
pub mod sync;
pub mod types;

use crate::api::types::{QuotaData, QuotaLimit};
use types::{UsageResponse, Window};

/// 将 Codex 的 wham/usage 响应转换为统一的 QuotaData
///
/// primary_window / secondary_window 均按其 limit_window_seconds 真实时长分类：
///   ≤~7h（如 18000s）→ TOKENS_LIMIT + unit=3（前端归类为 5h 窗口）
///   更长（如 604800s/7d）→ TOKENS_LIMIT + unit=6（前端归类为周额度）
/// Codex 已取消 5h 额度，两窗口通常都是周额度；前端按 category 去重只显示一条。
pub fn usage_to_quota_data(usage: &UsageResponse) -> QuotaData {
    let mut quota = QuotaData {
        level: usage.plan_type.clone().unwrap_or_default(),
        ..Default::default()
    };

    if let Some(ref rate_limit) = usage.rate_limit {
        if let Some(ref window) = rate_limit.primary_window {
            quota.limits.push(window_to_quota_limit(
                window,
                "TOKENS_LIMIT",
                classify_window_unit(window),
            ));
        }
        if let Some(ref window) = rate_limit.secondary_window {
            quota.limits.push(window_to_quota_limit(
                window,
                "TOKENS_LIMIT",
                classify_window_unit(window),
            ));
        }
    }

    // 额外模型额度（如 GPT-5.3-Codex-Spark）
    // 用 SPARK_5H / SPARK_WEEKLY 作为 limit_type，前端据此单独分类展示
    for additional in &usage.additional_rate_limits {
        if let Some(ref rl) = additional.rate_limit.primary_window {
            quota
                .limits
                .push(window_to_quota_limit(rl, "SPARK_5H", None));
        }
        if let Some(ref rl) = additional.rate_limit.secondary_window {
            quota
                .limits
                .push(window_to_quota_limit(rl, "SPARK_WEEKLY", None));
        }
    }

    quota
}

/// 按窗口总时长推断前端分类用的 unit：
/// ≤~7h（如 18000s/5h）→ unit=3（hourly），更长（如 604800s/7d）→ unit=6（weekly）；
/// 未知时长 → None（前端按重置周期兜底）。
fn classify_window_unit(window: &Window) -> Option<f64> {
    match window.limit_window_seconds {
        Some(s) if s > 0.0 && s <= 25000.0 => Some(3.0),
        Some(s) if s > 25000.0 => Some(6.0),
        _ => None,
    }
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
