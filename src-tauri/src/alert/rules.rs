use rusqlite::{params, Connection};

/// 默认提醒规则
pub const DEFAULT_RULES: &[(&str, f64)] = &[
    ("token_5h", 80.0),
    ("mcp_monthly", 90.0),
    ("reset_soon", 10.0),           // 分钟：额度重置前 10 分钟提醒
    ("idle_account", 120.0),        // 分钟
    ("deepseek_low_balance", 10.0), // 货币单位（CNY）：余额 ≤ 10 提醒
];

/// 初始化默认规则并处理迁移
pub fn init_default_rules(conn: &Connection) {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM alert_rules", [], |row| row.get(0))
        .unwrap_or(0);

    if count == 0 {
        for (rule_type, threshold) in DEFAULT_RULES {
            let _ = conn.execute(
                "INSERT INTO alert_rules (rule_type, threshold, enabled) VALUES (?1, ?2, 1)",
                params![rule_type, threshold],
            );
        }
        return;
    }

    // 迁移：移除废弃的 weekly 规则
    let _ = conn.execute("DELETE FROM alert_rules WHERE rule_type = 'weekly'", []);

    // 迁移：新增 idle_account 规则（如果不存在）
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM alert_rules WHERE rule_type = 'idle_account'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if exists == 0 {
        let _ = conn.execute(
            "INSERT INTO alert_rules (rule_type, threshold, enabled) VALUES ('idle_account', 120, 1)",
            [],
        );
    }

    // 迁移：新增 reset_soon 规则（额度重置前提醒）
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM alert_rules WHERE rule_type = 'reset_soon'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if exists == 0 {
        let _ = conn.execute(
            "INSERT INTO alert_rules (rule_type, threshold, enabled) VALUES ('reset_soon', 10, 1)",
            [],
        );
    }

    // 迁移：新增 deepseek_low_balance 规则（DeepSeek 余额本位，threshold=货币单位）
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM alert_rules WHERE rule_type = 'deepseek_low_balance'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if exists == 0 {
        let _ = conn.execute(
            "INSERT INTO alert_rules (rule_type, threshold, enabled) VALUES ('deepseek_low_balance', 10, 1)",
            [],
        );
    }
}

/// 检查某条规则在本周期内是否已触发过（去重）
/// window_mins: 去重窗口（分钟）
pub fn has_fired_this_period(
    conn: &Connection,
    account_id: &str,
    rule_type: &str,
    window_mins: i64,
) -> bool {
    let since = chrono::Utc::now() - chrono::Duration::minutes(window_mins.max(1));
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM alert_history WHERE account_id = ?1 AND rule_type = ?2 AND triggered_at > ?3",
            params![account_id, rule_type, since.to_rfc3339()],
            |row| row.get(0),
        )
        .unwrap_or(0);

    count > 0
}

/// 记录预警触发
pub fn record_alert(conn: &Connection, account_id: &str, rule_type: &str, value: f64) {
    let now = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "INSERT INTO alert_history (account_id, rule_type, value, triggered_at) VALUES (?1, ?2, ?3, ?4)",
        params![account_id, rule_type, value, now],
    );
}
