use crate::api::client::ZhipuClient;
use crate::crypto;
use crate::db::Database;
use chrono::Timelike;
use serde::{Deserialize, Serialize};
use tauri::State;

const SPIN_CONFIG_KEY: &str = "spin_config";
const SPIN_HISTORY_KEY: &str = "spin_history";
const DEFAULT_LEAD_HOURS: u32 = 3;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PeakPeriod {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpinConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub peak_periods: Vec<PeakPeriod>,
    #[serde(default = "default_lead_hours")]
    pub lead_hours: u32,
    #[serde(default = "default_fixed_time")]
    pub fixed_time: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub peak_start: Option<String>,
    #[serde(default)]
    pub peak_end: Option<String>,
}

impl Default for SpinConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: default_mode(),
            peak_periods: default_peak_periods(),
            lead_hours: default_lead_hours(),
            fixed_time: default_fixed_time(),
            account_id: None,
            peak_start: None,
            peak_end: None,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SpinStatus {
    pub config: SpinConfig,
    pub last_spin: Option<String>,
    pub next_spin: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SpinNowResult {
    pub executed: bool,
    pub message: String,
}

fn default_mode() -> String {
    "peak".to_string()
}

fn normalize_mode(mode: &str) -> String {
    match mode {
        "fixed" => "fixed".to_string(),
        _ => "peak".to_string(),
    }
}

fn default_lead_hours() -> u32 {
    DEFAULT_LEAD_HOURS
}

fn default_fixed_time() -> String {
    "07:00".to_string()
}

fn default_peak_periods() -> Vec<PeakPeriod> {
    vec![PeakPeriod {
        start: "09:00".to_string(),
        end: "14:00".to_string(),
    }]
}

impl SpinConfig {
    fn normalized(mut self) -> Self {
        self.mode = normalize_mode(&self.mode);
        self.lead_hours = self.lead_hours.clamp(1, 5);

        if self.peak_periods.is_empty() {
            if let (Some(start), Some(end)) = (self.peak_start.clone(), self.peak_end.clone()) {
                self.peak_periods.push(PeakPeriod { start, end });
            }
        }

        if self.peak_periods.is_empty() {
            self.peak_periods = default_peak_periods();
        }

        self.peak_periods.retain(|p| parse_time(&p.start).is_some() && parse_time(&p.end).is_some());
        self.peak_periods.sort_by_key(|p| time_to_minutes(&p.start).unwrap_or(u32::MAX));

        if self.peak_periods.is_empty() {
            self.peak_periods = default_peak_periods();
        }

        self.peak_start = None;
        self.peak_end = None;
        self
    }
}

pub fn read_config(conn: &rusqlite::Connection) -> SpinConfig {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![SPIN_CONFIG_KEY],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| serde_json::from_str::<SpinConfig>(&v).ok())
    .unwrap_or_default()
    .normalized()
}

pub fn read_history(conn: &rusqlite::Connection) -> Vec<String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![SPIN_HISTORY_KEY],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
    .unwrap_or_default()
}

fn write_history(conn: &rusqlite::Connection, history: &[String]) -> Result<(), String> {
    let trimmed: Vec<String> = history.iter().rev().take(30).cloned().collect::<Vec<_>>().into_iter().rev().collect();
    let json = serde_json::to_string(&trimmed).map_err(|e| format!("历史序列化失败: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![SPIN_HISTORY_KEY, json],
    )
    .map_err(|e| format!("保存空转历史失败: {}", e))?;
    Ok(())
}

fn record_history(conn: &rusqlite::Connection, history_key: String) -> Result<(), String> {
    let mut history = read_history(conn);
    if !history.iter().any(|h| h == &history_key) {
        history.push(history_key);
    }
    write_history(conn, &history)
}

fn parse_time(s: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() == 2 {
        let h: u32 = parts[0].parse().ok()?;
        let m: u32 = parts[1].parse().ok()?;
        if h < 24 && m < 60 {
            return Some((h, m));
        }
    }
    None
}

fn time_to_minutes(s: &str) -> Option<u32> {
    let (h, m) = parse_time(s)?;
    Some(h * 60 + m)
}

fn history_key_for_period(date: &str, period: &PeakPeriod) -> String {
    format!("{}#{}", date, period.start)
}

fn history_key_for_fixed(date: &str, fixed_time: &str) -> String {
    format!("{}#fixed-{}", date, fixed_time)
}

fn format_history_entry(entry: &str) -> String {
    entry.replace('#', " ")
}

/// 从 DB 读取最新快照中该账号的 TOKENS_LIMIT 状态
fn get_token_limit_state(conn: &rusqlite::Connection, account_id: &str) -> (f64, i64) {
    conn.query_row(
        "SELECT token_limit_pct, token_limit_reset FROM usage_snapshots \
         WHERE account_id = ?1 ORDER BY timestamp DESC LIMIT 1",
        rusqlite::params![account_id],
        |row| {
            Ok((
                row.get::<_, Option<f64>>(0).unwrap_or(None).unwrap_or(0.0),
                row.get::<_, Option<i64>>(1).unwrap_or(None).unwrap_or(0),
            ))
        },
    )
    .unwrap_or((0.0, 0))
}

fn token_window_idle(conn: &rusqlite::Connection, account_id: &str) -> bool {
    let (token_pct, token_reset) = get_token_limit_state(conn, account_id);
    token_reset == 0 && token_pct < 5.0
}

fn token_window_active(conn: &rusqlite::Connection, account_id: &str) -> bool {
    let (token_pct, token_reset) = get_token_limit_state(conn, account_id);
    token_reset > 0 || token_pct >= 5.0
}

pub fn read_spin_model(conn: &rusqlite::Connection) -> String {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = 'default_model'",
        [],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| "glm-5.1".to_string())
}

pub fn send_spin_request(account_id: &str, model: &str) -> Result<(), String> {
    let api_key = crypto::get_api_key(account_id).map_err(|e| format!("获取 API Key 失败: {}", e))?;
    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    tauri::async_runtime::block_on(client.spin_with_model(model))
        .map_err(|e| format!("空转请求失败: {}", e))
}

fn current_peak_slot(config: &SpinConfig, history: &[String], now_mins: u32, today: &str) -> Option<String> {
    for period in &config.peak_periods {
        let Some(start_mins) = time_to_minutes(&period.start) else {
            continue;
        };
        let slot_key = history_key_for_period(today, period);
        if history.iter().any(|h| h == &slot_key) {
            continue;
        }
        let window_start = start_mins.saturating_sub(config.lead_hours * 60);
        if now_mins >= window_start && now_mins < start_mins {
            return Some(slot_key);
        }
    }
    None
}

fn next_peak_slot(config: &SpinConfig, history: &[String], now_mins: u32, today: &str) -> Option<String> {
    for period in &config.peak_periods {
        let Some(start_mins) = time_to_minutes(&period.start) else {
            continue;
        };
        let slot_key = history_key_for_period(today, period);
        if history.iter().any(|h| h == &slot_key) {
            continue;
        }
        let window_start = start_mins.saturating_sub(config.lead_hours * 60);
        if now_mins < start_mins {
            return Some(format!("{:02}:{:02}", window_start / 60, window_start % 60));
        }
    }
    None
}

/// 计算下次空转时间（返回 HH:MM 字符串）
pub fn calc_next_spin(
    config: &SpinConfig,
    history: &[String],
    conn: &rusqlite::Connection,
    now: chrono::DateTime<chrono::Local>,
) -> Option<String> {
    if !config.enabled {
        return None;
    }
    let Some(ref account_id) = config.account_id else {
        return None;
    };
    if !token_window_idle(conn, account_id) {
        return None;
    }

    let today = now.format("%Y-%m-%d").to_string();
    let now_mins = now.hour() * 60 + now.minute();

    match config.mode.as_str() {
        "peak" => next_peak_slot(config, history, now_mins, &today),
        "fixed" => {
            let fixed_mins = time_to_minutes(&config.fixed_time)?;
            let key = history_key_for_fixed(&today, &config.fixed_time);
            if history.iter().any(|h| h == &key) {
                return None;
            }
            if now_mins <= fixed_mins + 10 {
                Some(config.fixed_time.clone())
            } else {
                None
            }
        }
        _ => None,
    }
}

/// 返回当前应触发的空转历史 key；None 表示不应空转
pub fn should_spin(
    config: &SpinConfig,
    history: &[String],
    conn: &rusqlite::Connection,
) -> Option<String> {
    if !config.enabled {
        return None;
    }
    let Some(ref account_id) = config.account_id else {
        return None;
    };
    if !token_window_idle(conn, account_id) {
        return None;
    }

    let now = chrono::Local::now();
    let today = now.format("%Y-%m-%d").to_string();
    let now_mins = now.hour() * 60 + now.minute();

    match config.mode.as_str() {
        "peak" => current_peak_slot(config, history, now_mins, &today),
        "fixed" => {
            let fixed_mins = time_to_minutes(&config.fixed_time)?;
            let key = history_key_for_fixed(&today, &config.fixed_time);
            if history.iter().any(|h| h == &key) {
                return None;
            }
            if now_mins >= fixed_mins && now_mins < fixed_mins + 10 {
                Some(key)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn record_spin_history(conn: &rusqlite::Connection, history_key: &str) -> Result<(), String> {
    record_history(conn, history_key.to_string())
}

#[tauri::command]
pub fn spin_now(db: State<'_, Database>, account_id: String) -> Result<SpinNowResult, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;

    if token_window_active(&conn, &account_id) {
        return Ok(SpinNowResult {
            executed: false,
            message: "TOKENS_LIMIT 计时器已经在运行，无需空转。".to_string(),
        });
    }

    let config = read_config(&conn);
    let history = read_history(&conn);
    let matched_key = if config.account_id.as_deref() == Some(account_id.as_str()) {
        should_spin(&config, &history, &conn)
    } else {
        None
    };
    let model = read_spin_model(&conn);
    drop(conn);

    send_spin_request(&account_id, &model)?;

    let conn2 = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let history_key = matched_key.unwrap_or_else(|| {
        format!("{}#manual", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"))
    });
    record_spin_history(&conn2, &history_key)?;

    Ok(SpinNowResult {
        executed: true,
        message: "空转请求已发送，请等待下次刷新确认计时器状态。".to_string(),
    })
}

#[tauri::command]
pub fn set_spin_config(db: State<'_, Database>, config: SpinConfig) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let normalized = config.normalized();
    let json = serde_json::to_string(&normalized).map_err(|e| format!("序列化失败: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![SPIN_CONFIG_KEY, json],
    )
    .map_err(|e| format!("保存失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_spin_status(db: State<'_, Database>) -> Result<SpinStatus, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let config = read_config(&conn);
    let history = read_history(&conn);
    let last_spin = history.last().map(|s| format_history_entry(s));
    let next_spin = calc_next_spin(&config, &history, &conn, chrono::Local::now());
    Ok(SpinStatus {
        config,
        last_spin,
        next_spin,
    })
}
