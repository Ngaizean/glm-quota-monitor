use crate::api::types::QuotaData;
use crate::alert::rules::{has_fired_this_period, record_alert};
use crate::db::Database;

/// 检查额度数据是否触发预警，如果触发则发送系统通知
pub fn check_and_notify(
    db: &Database,
    account_id: &str,
    account_alias: &str,
    quota: &QuotaData,
    notify_fn: &dyn Fn(&str),
) {
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

    for (rule_type, threshold) in &rules {
        let pct = match rule_type.as_str() {
            "token_5h" => quota
                .limits
                .iter()
                .find(|l| l.limit_type == "TIME_LIMIT")
                .map(|l| l.percentage as f64)
                .unwrap_or(0.0),
            "weekly" => quota
                .limits
                .iter()
                .find(|l| l.limit_type == "TOKENS_LIMIT")
                .map(|l| l.percentage as f64)
                .unwrap_or(0.0),
            "mcp_monthly" => quota
                .limits
                .iter()
                .find(|l| l.limit_type == "MCP_MONTHLY")
                .map(|l| l.percentage as f64)
                .unwrap_or(0.0),
            _ => continue,
        };

        if pct >= *threshold {
            if has_fired_this_period(&conn, account_id, rule_type) {
                continue;
            }

            let msg = format!(
                "[{}] {} 使用率已达 {:.0}%（阈值 {:.0}%）",
                account_alias, rule_type, pct, threshold
            );
            notify_fn(&msg);

            record_alert(&conn, account_id, rule_type, pct);
        }
    }
}
