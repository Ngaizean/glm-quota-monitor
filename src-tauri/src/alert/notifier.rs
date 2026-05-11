use crate::api::types::QuotaData;
use crate::alert::rules::{has_fired_this_period, record_alert};
use crate::db::Database;
use serde_json::json;

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

/// 检查额度数据是否触发提醒，支持可选 webhook 回调
pub fn check_and_notify_with_webhook(
    db: &Database,
    account_id: &str,
    account_alias: &str,
    quota: &QuotaData,
    notify_fn: impl Fn(&str),
    webhook_url: Option<&str>,
) {
    let pending: Vec<String> = {
        let conn = match db.conn.lock() {
            Ok(c) => c,
            Err(_) => return,
        };

        let rules: Vec<(String, f64)> = match conn.prepare("SELECT rule_type, threshold FROM alert_rules WHERE enabled = 1") {
            Ok(mut stmt) => stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .ok()
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default(),
            Err(_) => return,
        };

        let mut pending = Vec::new();

        for (rule_type, threshold) in &rules {
            match rule_type.as_str() {
                "token_5h" => {
                    let pct = quota
                        .limits
                        .iter()
                        .find(|l| l.limit_type == "TOKENS_LIMIT")
                        .map(|l| l.percentage)
                        .unwrap_or(0.0);

                    if pct >= *threshold {
                        if has_fired_this_period(&conn, account_id, rule_type) {
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
                        if has_fired_this_period(&conn, account_id, rule_type) {
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
                            let idle_mins =
                                (chrono::Utc::now() - dt.with_timezone(&chrono::Utc)).num_minutes() as f64;
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

                                if has_fired_this_period(&conn, account_id, rule_type) {
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

        pending
    }; // Lock released here

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
