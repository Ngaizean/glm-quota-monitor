use crate::api::client::ZhipuClient;
use crate::api::types::QuotaData;
use crate::crypto;
use crate::db::Database;
use crate::pricing::{get_price, plan_price_for_level, DEFAULT_UNIT_PRICE};
use chrono::Timelike;
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
    /// 实际生效单价（元/百万 tokens）：有用量明细时按模型加权，否则用兜底单价
    pub unit_price: f64,
    /// true = 按模型加权计费（免费模型份额已归零）
    pub weighted: bool,
}

/// 从额度快照的按模型明细算加权单价（元/百万 tokens）。
/// 免费模型（PRICING 中 price=0）的份额贡献 0 到分子，自然归零。
/// 返回 None 表示无明细，调用方回落兜底单价。
/// 当 usage 比例 ≈ 各模型 token 占比时，加权单价 × 总 token 精确等价于按模型逐项计费。
fn weighted_price_from_quota(quota: &QuotaData) -> Option<f64> {
    let mut total_usage = 0.0_f64;
    let mut total_cost = 0.0_f64; // Σ(usage × price)
    for limit in &quota.limits {
        if let Some(details) = limit.usage_details.as_ref() {
            for d in details {
                if d.usage <= 0.0 {
                    continue;
                }
                total_usage += d.usage;
                total_cost += d.usage * get_price(&d.model_code);
            }
        }
    }
    if total_usage > 0.0 {
        Some(total_cost / total_usage)
    } else {
        None
    }
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
    db.conn
        .lock()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT COALESCE(level, '') FROM accounts WHERE id = ?1",
                rusqlite::params![account_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn get_cost_estimate(
    db: State<'_, Database>,
    account_id: String,
) -> Result<CostEstimate, String> {
    let level = get_account_level(&db, &account_id);
    let api_key =
        crypto::get_api_key(&account_id).map_err(|e| format!("API Key 读取失败: {}", e))?;

    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    let now = chrono::Local::now();
    let today_start = now
        .with_hour(0)
        .unwrap()
        .with_minute(0)
        .unwrap()
        .with_second(0)
        .unwrap();
    let seven_days_ago = now - chrono::Duration::days(7);
    let thirty_days_ago = now - chrono::Duration::days(30);

    let fmt = |dt: chrono::DateTime<chrono::Local>| dt.format("%Y-%m-%d %H:%M:%S").to_string();
    let now_str = fmt(now);
    let today_str = fmt(today_start);
    let seven_str = fmt(seven_days_ago);
    let thirty_str = fmt(thirty_days_ago);

    let (today_res, seven_res, thirty_res, quota_res) = tokio::join!(
        client.get_model_usage(&today_str, &now_str),
        client.get_model_usage(&seven_str, &now_str),
        client.get_model_usage(&thirty_str, &now_str),
        client.get_quota_limit(),
    );

    let today_tokens = today_res
        .map_err(|e| e.to_string())?
        .total_usage
        .total_tokens_usage;
    let tokens_7d = seven_res
        .map_err(|e| e.to_string())?
        .total_usage
        .total_tokens_usage;
    let tokens_30d = thirty_res
        .map_err(|e| e.to_string())?
        .total_usage
        .total_tokens_usage;

    let price_key = format!("unit_price_{}", account_id);
    let fallback_price = get_setting_f64(&db, &price_key).unwrap_or(DEFAULT_UNIT_PRICE);
    // 按模型加权计费：有用量明细时用加权单价（免费模型归零），否则回落用户配置的兜底单价
    let (unit_price, weighted) = quota_res
        .ok()
        .and_then(|q| weighted_price_from_quota(&q).map(|p| (p, true)))
        .unwrap_or((fallback_price, false));
    let today_cost = today_tokens / 1_000_000.0 * unit_price;
    let cost_7d = tokens_7d / 1_000_000.0 * unit_price;
    let cost_30d = tokens_30d / 1_000_000.0 * unit_price;

    let plan_key = format!("plan_price_{}", account_id);
    let plan_price =
        get_setting_f64(&db, &plan_key).unwrap_or_else(|| plan_price_for_level(&level));

    let daily_avg = if cost_30d > 0.0 { cost_30d / 30.0 } else { 0.0 };
    let ratio = if plan_price > 0.0 {
        cost_30d / plan_price
    } else {
        0.0
    };

    Ok(CostEstimate {
        today_cost,
        cost_7d,
        cost_30d,
        plan_price,
        daily_avg,
        ratio,
        unit_price,
        weighted,
    })
}

#[tauri::command]
pub fn set_plan_price(
    db: State<'_, Database>,
    account_id: String,
    price: f64,
) -> Result<(), String> {
    set_setting(
        &db,
        &format!("plan_price_{}", account_id),
        &price.to_string(),
    )
}

#[tauri::command]
pub fn get_plan_price(db: State<'_, Database>, account_id: String) -> f64 {
    let key = format!("plan_price_{}", account_id);
    get_setting_f64(&db, &key)
        .unwrap_or_else(|| plan_price_for_level(&get_account_level(&db, &account_id)))
}

#[tauri::command]
pub fn set_unit_price(
    db: State<'_, Database>,
    account_id: String,
    price: f64,
) -> Result<(), String> {
    set_setting(
        &db,
        &format!("unit_price_{}", account_id),
        &price.to_string(),
    )
}

#[tauri::command]
pub fn get_unit_price(db: State<'_, Database>, account_id: String) -> f64 {
    let key = format!("unit_price_{}", account_id);
    get_setting_f64(&db, &key).unwrap_or(DEFAULT_UNIT_PRICE)
}
