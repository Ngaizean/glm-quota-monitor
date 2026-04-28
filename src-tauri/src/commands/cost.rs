use crate::api::client::ZhipuClient;
use crate::crypto;
use crate::db::Database;
use crate::pricing::{plan_price_for_level, DEFAULT_UNIT_PRICE};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct CostEstimate {
    pub today_cost: f64,
    pub cost_7d: f64,
    pub cost_30d: f64,
    pub plan_price: f64,
    pub daily_avg: f64,
    pub ratio: f64,
}

fn get_setting_f64(db: &Database, key: &str) -> Option<f64> {
    let conn = db.conn.lock().ok()?;
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.parse::<f64>().ok())
}

fn set_setting(db: &Database, key: &str, value: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_account_level(db: &Database, account_id: &str) -> String {
    db.conn.lock().ok()
        .and_then(|conn| conn.query_row(
            "SELECT COALESCE(level, '') FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| row.get::<_, String>(0),
        ).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_cost_estimate(db: State<'_, Database>, account_id: String) -> Result<CostEstimate, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let (db_key, level): (String, String) = conn
        .query_row(
            "SELECT api_key, COALESCE(level, '') FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("账号不存在: {}", e))?;
    drop(conn);

    let api_key = crypto::resolve_api_key(&account_id, &db_key, &|| {
        if let Ok(c) = db.conn.lock() {
            let _ = c.execute(
                "UPDATE accounts SET api_key = '' WHERE id = ?1",
                rusqlite::params![account_id],
            );
        }
    })
    .ok_or("API key not found".to_string())?;

    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    let now = chrono::Utc::now();
    let today_start = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
    let seven_days_ago = now - chrono::Duration::days(7);
    let thirty_days_ago = now - chrono::Duration::days(30);

    let fmt = |dt: chrono::DateTime<chrono::Utc>| dt.format("%Y-%m-%d %H:%M:%S").to_string();

    let fetch_tokens = |start: &str, end: &str| -> Result<f64, String> {
        let data = tauri::async_runtime::block_on(client.get_model_usage(start, end))
            .map_err(|e| e.to_string())?;
        Ok(data.total_usage.total_tokens_usage)
    };

    let today_tokens = fetch_tokens(&fmt(today_start), &fmt(now))?;
    let tokens_7d = fetch_tokens(&fmt(seven_days_ago), &fmt(now))?;
    let tokens_30d = fetch_tokens(&fmt(thirty_days_ago), &fmt(now))?;

    let price_key = format!("unit_price_{}", account_id);
    let unit_price = get_setting_f64(&db, &price_key).unwrap_or(DEFAULT_UNIT_PRICE);
    let today_cost = today_tokens / 1_000_000.0 * unit_price;
    let cost_7d = tokens_7d / 1_000_000.0 * unit_price;
    let cost_30d = tokens_30d / 1_000_000.0 * unit_price;

    let plan_key = format!("plan_price_{}", account_id);
    let plan_price = get_setting_f64(&db, &plan_key)
        .unwrap_or_else(|| plan_price_for_level(&level));

    let daily_avg = if cost_30d > 0.0 { cost_30d / 30.0 } else { 0.0 };
    let ratio = if plan_price > 0.0 { cost_30d / plan_price } else { 0.0 };

    Ok(CostEstimate {
        today_cost,
        cost_7d,
        cost_30d,
        plan_price,
        daily_avg,
        ratio,
    })
}

#[tauri::command]
pub fn set_plan_price(db: State<'_, Database>, account_id: String, price: f64) -> Result<(), String> {
    set_setting(&db, &format!("plan_price_{}", account_id), &price.to_string())
}

#[tauri::command]
pub fn get_plan_price(db: State<'_, Database>, account_id: String) -> f64 {
    let key = format!("plan_price_{}", account_id);
    get_setting_f64(&db, &key)
        .unwrap_or_else(|| plan_price_for_level(&get_account_level(&db, &account_id)))
}

#[tauri::command]
pub fn set_unit_price(db: State<'_, Database>, account_id: String, price: f64) -> Result<(), String> {
    set_setting(&db, &format!("unit_price_{}", account_id), &price.to_string())
}

#[tauri::command]
pub fn get_unit_price(db: State<'_, Database>, account_id: String) -> f64 {
    let key = format!("unit_price_{}", account_id);
    get_setting_f64(&db, &key).unwrap_or(DEFAULT_UNIT_PRICE)
}
