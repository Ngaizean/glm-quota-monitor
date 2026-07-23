use crate::db::models::AlertRule;
use crate::db::Database;
use tauri::State;

/// 获取告警规则：全局默认 + 指定账号的覆盖（account_id 为 None 时仅返回全局默认）
#[tauri::command]
pub fn get_alert_rules(
    db: State<'_, Database>,
    account_id: Option<String>,
) -> Result<Vec<AlertRule>, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, rule_type, threshold, enabled, account_id, COALESCE(dedupe_window_mins, 60) \
             FROM alert_rules WHERE account_id IS NULL OR account_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rules = stmt
        .query_map(rusqlite::params![account_id], |row| {
            Ok(AlertRule {
                id: row.get(0)?,
                rule_type: row.get(1)?,
                threshold: row.get(2)?,
                enabled: row.get::<_, i32>(3)? == 1,
                account_id: row.get(4)?,
                dedupe_window_mins: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rules)
}

/// 更新告警规则。
/// account_id = None 时更新全局默认；非 None 时 upsert 账号级覆盖（新建时从全局继承未提供字段）。
#[tauri::command]
pub fn update_alert_rule(
    db: State<'_, Database>,
    rule_type: String,
    threshold: Option<f64>,
    enabled: Option<bool>,
    account_id: Option<String>,
    dedupe_window_mins: Option<i32>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    match &account_id {
        Some(aid) => {
            let exists = conn
                .query_row(
                    "SELECT 1 FROM alert_rules WHERE rule_type = ?1 AND account_id = ?2",
                    rusqlite::params![rule_type, aid],
                    |_| Ok(()),
                )
                .is_ok();

            if exists {
                if let Some(t) = threshold {
                    conn.execute(
                        "UPDATE alert_rules SET threshold = ?1 WHERE rule_type = ?2 AND account_id = ?3",
                        rusqlite::params![t, rule_type, aid],
                    )
                    .map_err(|e| e.to_string())?;
                }
                if let Some(e) = enabled {
                    conn.execute(
                        "UPDATE alert_rules SET enabled = ?1 WHERE rule_type = ?2 AND account_id = ?3",
                        rusqlite::params![if e { 1 } else { 0 }, rule_type, aid],
                    )
                    .map_err(|e| e.to_string())?;
                }
                if let Some(d) = dedupe_window_mins {
                    conn.execute(
                        "UPDATE alert_rules SET dedupe_window_mins = ?1 WHERE rule_type = ?2 AND account_id = ?3",
                        rusqlite::params![d, rule_type, aid],
                    )
                    .map_err(|e| e.to_string())?;
                }
            } else {
                // 新建覆盖行：从全局默认继承未提供字段
                let base_th: f64 = conn
                    .query_row(
                        "SELECT threshold FROM alert_rules WHERE rule_type = ?1 AND account_id IS NULL",
                        rusqlite::params![rule_type],
                        |row| row.get(0),
                    )
                    .unwrap_or(0.0);
                let base_dedupe: i64 = conn
                    .query_row(
                        "SELECT COALESCE(dedupe_window_mins, 60) FROM alert_rules WHERE rule_type = ?1 AND account_id IS NULL",
                        rusqlite::params![rule_type],
                        |row| row.get(0),
                    )
                    .unwrap_or(60);
                let th = threshold.unwrap_or(base_th);
                let en_val = if enabled.unwrap_or(true) { 1 } else { 0 };
                let dw = dedupe_window_mins.map(|d| d as i64).unwrap_or(base_dedupe);
                conn.execute(
                    "INSERT INTO alert_rules (rule_type, threshold, enabled, account_id, dedupe_window_mins) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![rule_type, th, en_val, aid, dw],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        None => {
            if let Some(t) = threshold {
                conn.execute(
                    "UPDATE alert_rules SET threshold = ?1 WHERE rule_type = ?2 AND account_id IS NULL",
                    rusqlite::params![t, rule_type],
                )
                .map_err(|e| e.to_string())?;
            }
            if let Some(e) = enabled {
                let val = if e { 1 } else { 0 };
                conn.execute(
                    "UPDATE alert_rules SET enabled = ?1 WHERE rule_type = ?2 AND account_id IS NULL",
                    rusqlite::params![val, rule_type],
                )
                .map_err(|e| e.to_string())?;
            }
            if let Some(d) = dedupe_window_mins {
                conn.execute(
                    "UPDATE alert_rules SET dedupe_window_mins = ?1 WHERE rule_type = ?2 AND account_id IS NULL",
                    rusqlite::params![d, rule_type],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// 清除某账号的所有覆盖规则，回落到全局默认
#[tauri::command]
pub fn reset_account_overrides(db: State<'_, Database>, account_id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "DELETE FROM alert_rules WHERE account_id = ?1",
        rusqlite::params![account_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 设置全局静音（静音期跳过系统通知与 webhook）
#[tauri::command]
pub fn set_alert_muted(db: State<'_, Database>, muted: bool) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('alert_muted', ?1)",
        rusqlite::params![if muted { "1" } else { "0" }],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_alert_muted(db: State<'_, Database>) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let muted = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'alert_muted'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    Ok(muted)
}

#[tauri::command]
pub fn set_webhook_url(db: State<'_, Database>, url: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('webhook_url', ?1)",
        rusqlite::params![url],
    )
    .map_err(|e| format!("保存 Webhook URL 失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_webhook_url(db: State<'_, Database>) -> Result<Option<String>, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let url = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'webhook_url'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(url)
}
