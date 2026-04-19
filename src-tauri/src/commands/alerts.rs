use crate::db::models::AlertRule;
use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn get_alert_rules(db: State<'_, Database>) -> Result<Vec<AlertRule>, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, rule_type, threshold, enabled, account_id FROM alert_rules")
        .map_err(|e| e.to_string())?;
    let rules = stmt
        .query_map([], |row| {
            Ok(AlertRule {
                id: row.get(0)?,
                rule_type: row.get(1)?,
                threshold: row.get(2)?,
                enabled: row.get::<_, i32>(3)? == 1,
                account_id: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rules)
}

#[tauri::command]
pub fn update_alert_rule(
    db: State<'_, Database>,
    rule_type: String,
    threshold: Option<f64>,
    enabled: Option<bool>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    if let Some(t) = threshold {
        conn.execute(
            "UPDATE alert_rules SET threshold = ?1 WHERE rule_type = ?2",
            rusqlite::params![t, rule_type],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(e) = enabled {
        let val = if e { 1 } else { 0 };
        conn.execute(
            "UPDATE alert_rules SET enabled = ?1 WHERE rule_type = ?2",
            rusqlite::params![val, rule_type],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
