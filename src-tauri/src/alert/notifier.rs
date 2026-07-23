use crate::api::types::QuotaData;
use crate::alert::rules::{has_fired_this_period, record_alert};
use crate::db::Database;
use serde_json::json;
use std::collections::HashMap;

/// 检查额度数据是否触发提醒，如果触发则发送系统通知
pub fn check_and_notify(
    db: &Database,
    account_id: &str,
    account_alias: &str,
    quota: &QuotaData,
    notify_fn: impl Fn(&str),
) {
    check_and_notify_with_webhook(db, account_id, account_alias, quota, notify_fn, None)
}

/// 读取全局静音开关
fn is_muted(conn: &rusqlite::Connection) -> bool {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = 'alert_muted'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
    .unwrap_or(false)
}

/// 检查额度数据是否触发提醒，支持可选 webhook 回调。
/// 规则合并：账号级覆盖优先于全局默认（account_id IS NULL）。
pub fn check_and_notify_with_webhook(
    db: &Database,
    account_id: &str,
    account_alias: &str,
    quota: &QuotaData,
    notify_fn: impl Fn(&str),
    webhook_url: Option<&str>,
) {
    let (muted, pending): (bool, Vec<String>) = {
        let conn = match db.conn.lock() {
            Ok(c) => c,
            Err(_) => return,
        };

        let muted = is_muted(&conn);

        // 取全局默认 + 账号级覆盖：rule_type, threshold, dedupe_window_mins, 是否账号级
        let raw_rules: Vec<(String, f64, i64, bool)> = match conn.prepare(
            "SELECT rule_type, threshold, COALESCE(dedupe_window_mins, 60), account_id \
             FROM alert_rules WHERE enabled = 1 AND (account_id IS NULL OR account_id = ?1)",
        ) {
            Ok(mut stmt) => stmt
                .query_map(rusqlite::params![account_id], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get::<_, Option<String>>(3)?.is_some(),
                    ))
                })
                .ok()
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default(),
            Err(_) => return,
        };

        // 合并：账号级 insert 覆盖，全局 entry.or_insert
        let mut rules: HashMap<String, (f64, i64)> = HashMap::new();
        for (rt, th, dw, is_override) in raw_rules {
            if is_override {
                rules.insert(rt, (th, dw));
            } else {
                rules.entry(rt).or_insert((th, dw));
            }
        }

        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut pending = Vec::new();

        for (rule_type, (threshold, dedupe)) in &rules {
            match rule_type.as_str() {
                "token_5h" => {
                    let pct = quota
                        .limits
                        .iter()
                        .find(|l| l.limit_type == "TOKENS_LIMIT")
                        .map(|l| l.percentage)
                        .unwrap_or(0.0);

                    if pct >= *threshold {
                        if has_fired_this_period(&conn, account_id, rule_type, *dedupe) {
                            continue;
                        }
                        let msg = format!(
                            "[{}] Token 额度已达 {:.0}%（阈值 {:.0}%）",
                            account_alias, pct, threshold
                        );
                        record_alert(&conn, account_id, rule_type, pct);
                        pending.push(msg);
                    }
                }
                "mcp_monthly" => {
                    let pct = quota
                        .limits
                        .iter()
                        .find(|l| l.limit_type == "MCP_MONTHLY")
                        .map(|l| l.percentage)
                        .unwrap_or(0.0);

                    if pct >= *threshold {
                        if has_fired_this_period(&conn, account_id, rule_type, *dedupe) {
                            continue;
                        }
                        let msg = format!(
                            "[{}] MCP 月度额度已达 {:.0}%（阈值 {:.0}%）",
                            account_alias, pct, threshold
                        );
                        record_alert(&conn, account_id, rule_type, pct);
                        pending.push(msg);
                    }
                }
                "reset_soon" => {
                    // threshold 单位=分钟：额度重置前 N 分钟提醒
                    let next_reset = quota
                        .limits
                        .iter()
                        .find(|l| l.limit_type == "TOKENS_LIMIT")
                        .filter(|l| l.next_reset_time > 0)
                        .map(|l| l.next_reset_time);

                    if let Some(reset_ms) = next_reset {
                        let remaining_mins = (reset_ms - now_ms) as f64 / 60_000.0;
                        if remaining_mins > 0.0 && remaining_mins <= *threshold {
                            if has_fired_this_period(&conn, account_id, rule_type, *dedupe) {
                                continue;
                            }
                            let msg = format!(
                                "[{}] Token 额度将在约 {:.0} 分钟后重置",
                                account_alias,
                                remaining_mins.ceil()
                            );
                            record_alert(&conn, account_id, rule_type, remaining_mins);
                            pending.push(msg);
                        }
                    }
                }
                "idle_account" => {
                    if quota.is_offline {
                        continue;
                    }

                    let key = format!("last_active_{}", account_id);
                    let last_active_str: Option<String> = conn
                        .query_row(
                            "SELECT value FROM app_settings WHERE key = ?1",
                            rusqlite::params![key],
                            |row| row.get::<_, String>(0),
                        )
                        .ok();

                    if let Some(ts) = last_active_str {
                        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&ts) {
                            let idle_mins = (chrono::Utc::now()
                                - dt.with_timezone(&chrono::Utc))
                                .num_minutes() as f64;
                            if idle_mins >= *threshold {
                                let token_pct = quota
                                    .limits
                                    .iter()
                                    .find(|l| l.limit_type == "TOKENS_LIMIT")
                                    .map(|l| l.percentage)
                                    .unwrap_or(100.0);
                                if token_pct >= 95.0 {
                                    continue;
                                }

                                if has_fired_this_period(&conn, account_id, rule_type, *dedupe) {
                                    continue;
                                }
                                let hours = idle_mins / 60.0;
                                let msg = format!(
                                    "[{}] 已空闲 {:.1} 小时，Token 额度剩余 {:.0}% 可使用",
                                    account_alias,
                                    hours,
                                    100.0 - token_pct
                                );
                                record_alert(&conn, account_id, rule_type, idle_mins);
                                pending.push(msg);
                            }
                        }
                    }
                }
                _ => continue,
            }
        }

        (muted, pending)
    }; // Lock released here

    // 全局静音：跳过系统通知与 webhook（触发记录仍保留，避免静音期内反复触发）
    if muted {
        return;
    }

    for msg in &pending {
        notify_fn(msg);
    }

    // Webhook 回调
    if let Some(url) = webhook_url {
        if !pending.is_empty() {
            let payload = json!({
                "account_id": account_id,
                "account_alias": account_alias,
                "alerts": pending,
            });
            let client = crate::HTTP_CLIENT.clone();
            let url = url.to_string();
            std::thread::spawn(move || {
                let _ = tauri::async_runtime::block_on(async {
                    client.post(&url).json(&payload).send().await
                });
            });
        }
    }
}
