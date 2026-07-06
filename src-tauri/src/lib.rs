mod alert;
mod api;
mod codex;
mod commands;
mod crypto;
mod db;
mod platform;
mod pricing;

use api::client::ZhipuClient;
use api::types::QuotaData;
use chrono::Timelike;
use db::Database;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{LazyLock, OnceLock};
use std::time::Duration;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder},
    webview::WebviewWindowBuilder,
    Manager,
};

const POPOVER_LABEL: &str = "popover";
const DEFAULT_REFRESH_INTERVAL_SECS: u64 = 300;

static MAX_PERCENTAGE: AtomicI32 = AtomicI32::new(-1);
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// Codex/Gist 专用代理 client（chatgpt.com / github.com 等境外端点）
/// 智谱 API 继续用 HTTP_CLIENT 直连（国内）
static PROXY_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// 常见本地 HTTP 代理端口，按优先级探测：
///   - 7890  Clash 经典 HTTP 混合端口 / Clash for Windows
///   - 7897  Clash Verge / Mihomo 默认混合端口
///   - 10809 v2rayN 默认 HTTP 端口
const PROXY_PROBE_PORTS: &[u16] = &[7890, 7897, 10809];

/// 探测本机哪个代理端口在监听（TCP 连通即视为代理）。
/// 返回第一个可达端口；都不通返回 None（调用方据此直连）。
/// 回环端口未监听会立即 ECONNREFUSED，实测几十毫秒内完成。
fn probe_local_proxy_port() -> Option<u16> {
    use std::net::TcpStream;
    use std::time::Duration;
    for &port in PROXY_PROBE_PORTS {
        let addr: std::net::SocketAddr = ([127, 0, 0, 1], port).into();
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Some(port);
        }
    }
    None
}

/// 构造代理 client。
/// - proxy_url 非空：用用户指定地址
/// - proxy_url 为空：自动探测本机常见代理端口（7890/7897/10809），探测不到则直连
///
/// 固定使用 rustls-tls：避免 Windows native-tls(schannel) 的证书吊销检查
/// (CRYPT_E_REVOCATION_OFFLINE) 导致 gist.githubusercontent.com 等域名 TLS 握手失败。
fn build_proxy_client(proxy_url: &str) -> reqwest::Client {
    let builder = reqwest::Client::builder().use_rustls_tls();
    let url = if !proxy_url.trim().is_empty() {
        Some(proxy_url.trim().to_string())
    } else {
        probe_local_proxy_port().map(|p| format!("http://127.0.0.1:{}", p))
    };
    match url.as_deref() {
        Some(url) => match reqwest::Proxy::all(url) {
            Ok(proxy) => builder.proxy(proxy).build(),
            Err(_) => builder.build(),
        },
        None => builder.build(),
    }
    .unwrap_or_else(|_| reqwest::Client::new())
}

/// 在 setup 里调用：依据数据库 codex_proxy 配置初始化代理 client。
/// 后续修改代理地址需重启 app 才生效（OnceLock 限制）。
pub fn init_proxy_client(proxy_url: &str) {
    let _ = PROXY_CLIENT.set(build_proxy_client(proxy_url));
}

/// 取代理 client。setup 已初始化则复用；否则懒构造（自动探测本机代理端口）。
pub fn proxy_http_client() -> &'static reqwest::Client {
    PROXY_CLIENT.get_or_init(|| build_proxy_client(""))
}

#[derive(serde::Serialize)]
struct RefreshResult {
    max_pct: i32,
    quotas: HashMap<String, QuotaData>,
    /// 所有标记为 primary（收藏）的账号，含平台和百分比
    primary_items: Vec<PrimaryDisplay>,
}

/// 状态栏显示项：平台 + 百分比
#[derive(serde::Serialize, Clone)]
struct PrimaryDisplay {
    platform: String,
    pct: i32,
}

fn get_db_path(app: &tauri::App) -> PathBuf {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to resolve app data dir");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("glm_quota_monitor.db")
}

// ========== 窗口管理 ==========

fn position_popover(window: &tauri::WebviewWindow, app: &tauri::AppHandle) {
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(Some(rect)) = tray.rect() {
            if let (tauri::Position::Physical(pos), tauri::Size::Physical(size)) =
                (rect.position, rect.size)
            {
                let scale = window.scale_factor().unwrap_or(1.0);
                let window_w = (platform::POPOVER_WIDTH_LOGICAL * scale) as u32;
                let window_h = window.inner_size().unwrap_or(tauri::PhysicalSize::new(window_w, 600)).height;
                let (x, y) = platform::popover_position(pos.x, pos.y, size.width, size.height, window_w, window_h);
                let _ = window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x, y),
                ));
            }
        }
    }
}

fn toggle_popover(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(POPOVER_LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            position_popover(&window, app);
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn create_popover_window(app: &tauri::AppHandle) {
    if app.get_webview_window(POPOVER_LABEL).is_some() {
        toggle_popover(app);
        return;
    }

    let window =
        WebviewWindowBuilder::new(app, POPOVER_LABEL, tauri::WebviewUrl::App("index.html".into()))
            .title("GLM Quota Monitor")
            .inner_size(360.0, 600.0)
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible(false)
            .build()
            .expect("Failed to create popover window");

    platform::apply_window_decoration(&window);
    position_popover(&window, app);
    let _ = window.show();
    let _ = window.set_focus();
}

// ========== 后台刷新 ==========

fn get_refresh_interval(db: &Database) -> u64 {
    let conn = match db.conn.lock() {
        Ok(c) => c,
        Err(_) => return DEFAULT_REFRESH_INTERVAL_SECS,
    };
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = 'refresh_interval'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.parse::<u64>().ok())
    .map(|mins| mins * 60)
    .unwrap_or(DEFAULT_REFRESH_INTERVAL_SECS)
}

fn resolve_api_key_for_refresh(db: &Database, account_id: &str, db_key: &str) -> Option<String> {
    crypto::resolve_api_key(account_id, db_key, &|| {
        if let Ok(conn) = db.conn.lock() {
            let _ = conn.execute(
                "UPDATE accounts SET api_key = '' WHERE id = ?1",
                rusqlite::params![account_id],
            );
        }
    })
}

/// 获取单个账号的配额数据 + 今日 token 用量
fn fetch_account_quota(
    db: &Database,
    account_id: &str,
    api_key: &str,
) -> Result<(QuotaData, i32, f64), String> {
    // 按 platform 分流
    let platform: String = db
        .conn
        .lock()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT platform FROM accounts WHERE id = ?1",
                rusqlite::params![account_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
        })
        .unwrap_or_else(|| "zhipu".to_string());

    if platform == "codex" {
        return fetch_codex_account_quota(db, account_id);
    }

    // GLM 默认路径
    fetch_zhipu_account_quota(account_id, api_key)
}

/// GLM 账号额度查询（原有逻辑）
fn fetch_zhipu_account_quota(
    _account_id: &str,
    api_key: &str,
) -> Result<(QuotaData, i32, f64), String> {
    let client = ZhipuClient::with_client(&HTTP_CLIENT, api_key);
    let quota =
        tauri::async_runtime::block_on(client.get_quota_limit()).map_err(|e| e.to_string())?;
    let pct = quota
        .limits
        .iter()
        .find(|l| l.limit_type == "TOKENS_LIMIT")
        .map(|l| l.percentage as i32)
        .unwrap_or(0);

    let today_tokens = fetch_today_tokens(&client);

    Ok((quota, pct, today_tokens))
}

/// Codex 账号额度查询
/// 优先使用本机 auth.json；必要时刷新 token 并同步到 Keychain。
fn fetch_codex_account_quota(
    db: &Database,
    account_id: &str,
) -> Result<(QuotaData, i32, f64), String> {
    // 第一步：尝试本机 auth.json（Codex CLI 维护的，总是最新源）
    let local_auth = codex::auth::read_local_auth_json()
        .or_else(|_| codex::auth::read_auth_from_keychain(account_id))?;

    if local_auth.tokens.access_token.is_empty() {
        return Err("无 access_token".to_string());
    }

    // 检查 token 是否快过期（<2天），如果是则自动刷新
    let auth = if is_token_expiring_soon(&local_auth.tokens.access_token, 2) {
        eprintln!("Codex token 即将过期，尝试自动刷新...");
        match codex::auth::refresh_and_sync(proxy_http_client(), &local_auth, account_id) {
            Ok(new_auth) => {
                eprintln!("Codex token 自动刷新成功");
                new_auth
            }
            Err(e) => {
                eprintln!("Codex token 自动刷新失败: {}，继续用旧 token 尝试", e);
                local_auth
            }
        }
    } else {
        // 同步到 Keychain（确保 Keychain 也有最新版本）
        let _ = codex::auth::store_auth_to_keychain(account_id, &local_auth);
        local_auth
    };

    let usage_result = tauri::async_runtime::block_on(codex::client::CodexClient::get_usage(
        proxy_http_client(),
        &auth.tokens.access_token,
    ));

    let usage = match usage_result {
        Ok(usage) => usage,
        Err(codex::client::CodexApiError::Http(reqwest::StatusCode::UNAUTHORIZED)) => {
            eprintln!("Codex token 返回 401，尝试刷新后重试...");
            let refreshed = codex::auth::refresh_and_sync(proxy_http_client(), &auth, account_id)
                .map_err(|e| format!("wham/usage 调用失败，且刷新 token 失败: {}", e))?;
            tauri::async_runtime::block_on(codex::client::CodexClient::get_usage(
                proxy_http_client(),
                &refreshed.tokens.access_token,
            ))
            .map_err(|e| format!("wham/usage 重试失败: {}", e))?
        }
        Err(e) => return Err(format!("wham/usage 调用失败: {}", e)),
    };

    Ok(finalize_codex_quota(db, account_id, &usage))
}

/// 检查 JWT access_token 是否在 N 天内过期
fn is_token_expiring_soon(access_token: &str, days: i64) -> bool {
    use base64::Engine;
    let parts: Vec<&str> = access_token.split('.').collect();
    if parts.len() < 2 {
        return true; // 解析失败视为快过期（保守）
    }
    let payload = match base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(parts[1]) {
        Ok(p) => p,
        Err(_) => return true,
    };
    let v: serde_json::Value = match serde_json::from_slice(&payload) {
        Ok(v) => v,
        Err(_) => return true,
    };
    let exp = match v.get("exp").and_then(|e| e.as_i64()) {
        Some(e) => e,
        None => return true,
    };
    let now = chrono::Utc::now().timestamp();
    let remaining_days = (exp - now) / 86400;
    remaining_days < days
}

/// 统一处理 Codex quota 转换 + 快照记录 + 活跃检测
fn finalize_codex_quota(
    db: &Database,
    account_id: &str,
    usage: &codex::types::UsageResponse,
) -> (QuotaData, i32, f64) {
    let quota = codex::usage_to_quota_data(usage);
    let pct = quota
        .limits
        .iter()
        .find(|l| l.unit == Some(3.0))
        .map(|l| l.percentage as i32)
        .unwrap_or(0);

    if let Ok(conn) = db.conn.lock() {
        let _ = db::record_quota_snapshot(&conn, account_id, &quota, 0.0);
        detect_codex_activity(&conn, account_id, &quota);
    }

    (quota, pct, 0.0)
}

/// Codex 活跃检测：对比 5h 窗口百分比变化。
fn detect_codex_activity(conn: &rusqlite::Connection, account_id: &str, quota: &QuotaData) {
    let prev_pct = conn
        .query_row(
            "SELECT token_limit_pct FROM usage_snapshots \
             WHERE account_id = ?1 AND token_limit_pct IS NOT NULL \
             ORDER BY timestamp DESC LIMIT 1 OFFSET 1",
            rusqlite::params![account_id],
            |row| row.get::<_, Option<f64>>(0),
        )
        .ok()
        .flatten();

    let current_5h = quota
        .limits
        .iter()
        .find(|l| l.limit_type == "TOKENS_LIMIT" && l.unit == Some(3.0))
        .map(|l| l.percentage)
        .unwrap_or(0.0);

    if let Some(prev) = prev_pct {
        if current_5h > prev {
            let now_str = chrono::Local::now().to_rfc3339();
            let key = format!("last_active_{}", account_id);
            let _ = conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
                rusqlite::params![key, now_str],
            );
        }
    }
}

/// 获取今日（本地 00:00 至现在）的 token 总用量。
/// API 失败时返回 0.0 而非报错，避免阻塞快照写入。
/// 提取为 pub 以便 quota.rs 的手动刷新路径复用，修复趋势图清零 bug。
pub fn fetch_today_tokens(client: &ZhipuClient) -> f64 {
    let now = chrono::Local::now();
    // with_hour(0) 在夏令时前跳的 00:00 极少数情况返回 None，安全回退到 now
    let today_start = now
        .with_hour(0)
        .and_then(|dt| dt.with_minute(0))
        .and_then(|dt| dt.with_second(0))
        .unwrap_or(now);
    let fmt = |dt: chrono::DateTime<chrono::Local>| dt.format("%Y-%m-%d %H:%M:%S").to_string();
    match tauri::async_runtime::block_on(client.get_model_usage(&fmt(today_start), &fmt(now))) {
        Ok(data) => data.total_usage.total_tokens_usage,
        Err(_) => 0.0,
    }
}

/// 网络异常时从本地缓存构造离线 QuotaData
fn build_offline_quota(
    db: &Database,
    account_id: &str,
    error: &crate::api::client::ApiError,
) -> Option<QuotaData> {
    let mut offline_quota = QuotaData::default();
    offline_quota.is_offline = true;

    if let Ok(conn2) = db.conn.lock() {
        // 读取最近快照
        let snap_limits: Option<(Option<f64>, Option<i64>, Option<f64>, Option<i64>)> = conn2
            .query_row(
                "SELECT time_limit_pct, time_limit_reset, token_limit_pct, token_limit_reset \
                 FROM usage_snapshots WHERE account_id = ?1 ORDER BY timestamp DESC LIMIT 1",
                rusqlite::params![account_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .ok();

        if let Some((time_pct, time_reset, token_pct, token_reset)) = snap_limits {
            if let (Some(pct), Some(reset)) = (time_pct, time_reset) {
                offline_quota.limits.push(crate::api::types::QuotaLimit {
                    limit_type: "TIME_LIMIT".into(),
                    percentage: pct,
                    next_reset_time: reset,
                    unit: None,
                    number: None,
                    usage: None,
                    current_value: None,
                    remaining: None,
                    usage_details: None,
                });
            }
            if let (Some(pct), Some(reset)) = (token_pct, token_reset) {
                offline_quota.limits.push(crate::api::types::QuotaLimit {
                    limit_type: "TOKENS_LIMIT".into(),
                    percentage: pct,
                    next_reset_time: reset,
                    unit: None,
                    number: None,
                    usage: None,
                    current_value: None,
                    remaining: None,
                    usage_details: None,
                });
            }
        }

        // 读取 level
        offline_quota.level = conn2
            .query_row(
                "SELECT COALESCE(level, '') FROM accounts WHERE id = ?1",
                rusqlite::params![account_id],
                |row| row.get(0),
            )
            .unwrap_or_default();

        // 读取 last_active
        let key = format!("last_active_{}", account_id);
        offline_quota.last_active = conn2
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                rusqlite::params![key],
                |row| row.get::<_, String>(0),
            )
            .ok();
    }

    // 401 特殊标记
    if matches!(error, crate::api::client::ApiError::Unauthorized) {
        offline_quota.error = Some("API Key 无效或已过期".into());
    } else if error.to_string().contains("吊销") || error.to_string().contains("TokenInvalidated") {
        // Codex token 被吊销（不是过期），特殊提示
        offline_quota.error = Some("Token 已被吊销，请重新登录 Codex".into());
    } else if offline_quota.limits.is_empty() {
        // 完全无缓存时不展示
        return None;
    } else {
        // 有缓存但本次失败，附带错误信息
        offline_quota.error = Some(format!("{}", error));
    }

    Some(offline_quota)
}

/// 检测账号活跃度：对比快照中 token 百分比变化
fn detect_account_activity(conn: &rusqlite::Connection, account_id: &str, quota: &QuotaData) {
    let current_pct = quota
        .limits
        .iter()
        .find(|l| l.limit_type == "TOKENS_LIMIT")
        .map(|l| l.percentage)
        .unwrap_or(0.0);
    let prev_pct = conn
        .query_row(
            "SELECT token_limit_pct FROM usage_snapshots \
             WHERE account_id = ?1 AND token_limit_pct IS NOT NULL \
             ORDER BY timestamp DESC LIMIT 1 OFFSET 1",
            rusqlite::params![account_id],
            |row| row.get::<_, Option<f64>>(0),
        )
        .ok()
        .flatten();

    if let Some(prev) = prev_pct {
        if current_pct > prev {
            let now_str = chrono::Local::now().to_rfc3339();
            let key = format!("last_active_{}", account_id);
            let _ = conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
                rusqlite::params![key, now_str],
            );
        }
    }
}

fn refresh_all_accounts(app: &tauri::AppHandle) -> RefreshResult {
    let db = match app.try_state::<Database>() {
        Some(db) => db,
        None => return RefreshResult { max_pct: 0, quotas: HashMap::new(), primary_items: Vec::new() },
    };

    // (id, alias, api_key, platform, is_primary)
    let accounts: Vec<(String, String, String, String, bool)> = {
        let Ok(guard) = db.conn.lock() else {
            return RefreshResult { max_pct: 0, quotas: HashMap::new(), primary_items: Vec::new() };
        };
        let result = guard.prepare(
            "SELECT id, alias, api_key, platform, COALESCE(is_primary, 0) FROM accounts WHERE is_active = 1"
        );
        let Ok(mut stmt) = result else {
            return RefreshResult { max_pct: 0, quotas: HashMap::new(), primary_items: Vec::new() };
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i32>(4)? == 1,
            ))
        });
        match rows {
            Ok(r) => r.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        }
    };

    // 读取 webhook URL
    let webhook_url: Option<String> = db
        .conn
        .lock()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT value FROM app_settings WHERE key = 'webhook_url'",
                [],
                |row| row.get::<_, String>(0),
            )
            .ok()
        });

    let mut max_pct = 0i32;
    let mut primary_items: Vec<PrimaryDisplay> = Vec::new();
    let mut quotas = HashMap::new();

    for (account_id, account_alias, db_key, platform, is_primary) in &accounts {
        // Codex 账号凭证从 Keychain 读取（不走 GLM 的 api_key 解析）
        if platform == "codex" {
            match fetch_codex_account_quota(&db, account_id) {
                Ok((mut quota, pct, _)) => {
                    if pct > max_pct {
                        max_pct = pct;
                    }
                    if *is_primary {
                        primary_items.push(PrimaryDisplay { platform: "codex".to_string(), pct });
                    }

                    // 读取持久化的 last_active（和 GLM 一致）
                    if let Ok(conn2) = db.conn.lock() {
                        let key = format!("last_active_{}", account_id);
                        quota.last_active = conn2.query_row(
                            "SELECT value FROM app_settings WHERE key = ?1",
                            rusqlite::params![key],
                            |row| row.get::<_, String>(0),
                        ).ok();
                    }

                    quotas.insert(account_id.clone(), quota.clone());
                    let quota_clone = quota.clone();
                    let app_clone = app.clone();
                    let aid = account_id.clone();
                    let alias = account_alias.clone();
                    let wh = webhook_url.clone();
                    alert::check_and_notify_with_webhook(
                        &db,
                        &aid,
                        &alias,
                        &quota_clone,
                        |msg: &str| {
                            use tauri_plugin_notification::NotificationExt;
                            let _ = app_clone
                                .notification()
                                .builder()
                                .title("GLM Quota Monitor")
                                .body(msg.to_string())
                                .show();
                        },
                        wh.as_deref(),
                    );
                }
                Err(e) => {
                    eprintln!("Failed to refresh codex account {}: {}", account_id, e);
                    if let Some(offline_quota) = build_offline_quota(&db, account_id, &crate::api::client::ApiError::Api { code: -1, msg: e }) {
                        quotas.insert(account_id.clone(), offline_quota);
                    }
                }
            }
            continue;
        }

        // GLM 账号：从 Keychain 解析 API Key
        let api_key = match resolve_api_key_for_refresh(&db, account_id, db_key) {
            Some(k) => k,
            None => continue,
        };

        match fetch_zhipu_account_quota(account_id, &api_key) {
            Ok((mut quota, pct, today_tokens)) => {
                if pct > max_pct {
                    max_pct = pct;
                }
                if *is_primary {
                    primary_items.push(PrimaryDisplay { platform: "zhipu".to_string(), pct });
                }

                if let Ok(conn2) = db.conn.lock() {
                    let _ = db::record_quota_snapshot(&conn2, account_id, &quota, today_tokens);
                    detect_account_activity(&conn2, account_id, &quota);

                    // 读取持久化的 last_active
                    let key = format!("last_active_{}", account_id);
                    quota.last_active = conn2.query_row(
                        "SELECT value FROM app_settings WHERE key = ?1",
                        rusqlite::params![key],
                        |row| row.get::<_, String>(0),
                    ).ok();
                }

                quotas.insert(account_id.clone(), quota.clone());
                let quota_clone = quota.clone();

                let app_clone = app.clone();
                let aid = account_id.clone();
                let alias = account_alias.clone();
                let wh = webhook_url.clone();
                alert::check_and_notify_with_webhook(
                    &db,
                    &aid,
                    &alias,
                    &quota_clone,
                    |msg: &str| {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = app_clone
                            .notification()
                            .builder()
                            .title("GLM Quota Monitor")
                            .body(msg.to_string())
                            .show();
                    },
                    wh.as_deref(),
                );
            }
            Err(e) => {
                eprintln!("Failed to refresh account {}: {}", account_id, e);

                let api_err = crate::api::client::ApiError::Api { code: -1, msg: e.clone() };
                if let Some(offline_quota) = build_offline_quota(&db, account_id, &api_err) {
                    quotas.insert(account_id.clone(), offline_quota);
                }
            }
        }
    }

    let display_pct = if primary_items.is_empty() { max_pct } else { primary_items.iter().map(|i| i.pct).max().unwrap_or(0) };
    RefreshResult { max_pct: display_pct, quotas, primary_items }
}

fn update_tray_display(app: &tauri::AppHandle, primary_items: &[PrimaryDisplay]) {
    platform::update_tray(app, primary_items);
}

fn do_refresh(app: &tauri::AppHandle) {
    let result = refresh_all_accounts(app);
    MAX_PERCENTAGE.store(result.max_pct, Ordering::SeqCst);
    update_tray_display(app, &result.primary_items);
}

/// Codex 鉴权自动上传调度
/// 每 5 分钟检测一次本机 auth.json 是否变化（通过 last_refresh 字段或文件 mtime）
/// 仅当角色为 owner 且配置了 Gist URL + Token 时才上传
fn run_codex_auto_upload(app: &tauri::AppHandle) {
    std::thread::sleep(Duration::from_secs(60));
    let mut last_signature: Option<String> = None;

    loop {
        if let Some(db) = app.try_state::<Database>() {
            let role = db
                .conn
                .lock()
                .ok()
                .and_then(|conn| {
                    conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'codex_role'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                })
                .unwrap_or_else(|| "owner".to_string());

            if role != "owner" {
                std::thread::sleep(Duration::from_secs(300));
                continue;
            }

            // 检查自动上传开关
            let auto_upload = db
                .conn
                .lock()
                .ok()
                .and_then(|conn| {
                    conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'codex_auto_upload'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                })
                .map(|v| v == "true")
                .unwrap_or(false);

            if !auto_upload {
                std::thread::sleep(Duration::from_secs(300));
                continue;
            }

            // 检测本机 auth.json 变化
            let current_signature = match codex::auth::read_local_auth_json() {
                Ok(auth) => {
                    // 用 last_refresh + access_token 前 16 字符作为变化指纹
                    let token_fingerprint = if auth.tokens.access_token.len() >= 16 {
                        &auth.tokens.access_token[..16]
                    } else {
                        &auth.tokens.access_token
                    };
                    Some(format!(
                        "{}|{}",
                        auth.last_refresh.clone().unwrap_or_default(),
                        token_fingerprint
                    ))
                }
                Err(_) => None,
            };

            let changed = current_signature.as_deref() != last_signature.as_deref();

            if changed && current_signature.is_some() {
                // 有变化，触发上传
                if let Err(e) = try_codex_auto_upload(&db) {
                    eprintln!("Codex auto-upload failed: {}", e);
                } else {
                    eprintln!("Codex auto-upload: auth.json changed, uploaded successfully");
                    last_signature = current_signature.clone();
                }
            } else if last_signature.is_none() && current_signature.is_some() {
                // 首次检测，记录但不立即上传（等下次变化或手动上传）
                last_signature = current_signature;
            }
        }

        std::thread::sleep(Duration::from_secs(300)); // 5 分钟检测一次
    }
}

/// 执行一次 Codex 鉴权上传（owner 自动触发）
fn try_codex_auto_upload(db: &Database) -> Result<(), String> {
    let gist_url = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        conn.query_row(
            "SELECT value FROM app_settings WHERE key = 'codex_gist_url'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "未配置 Gist URL".to_string())?
    };
    let github_token = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        conn.query_row(
            "SELECT value FROM app_settings WHERE key = 'codex_github_token'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "未配置 GitHub Token".to_string())?
    };

    let auth = codex::auth::read_local_auth_json()?;
    let json = serde_json::to_string(&auth).map_err(|e| format!("序列化失败: {}", e))?;
    let encrypted = codex::crypto::encrypt(&json)?;

    tauri::async_runtime::block_on(codex::sync::push_to_gist(
        proxy_http_client(),
        &gist_url,
        &github_token,
        &encrypted,
    ))?;

    // 记录上传时间
    if let Ok(conn) = db.conn.lock() {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('codex_last_upload', ?1)",
            rusqlite::params![now],
        );
    }

    Ok(())
}

/// Codex 鉴权自动同步调度（consumer 角色）
/// 每 5 分钟从 Gist 拉取加密内容，与上次指纹对比，有变化（或首次）才解密应用。
/// 避免无谓地反复写本机 auth.json / Keychain。
fn run_codex_auto_sync(app: &tauri::AppHandle) {
    std::thread::sleep(Duration::from_secs(60));
    let mut last_signature: Option<String> = None;

    loop {
        if let Some(db) = app.try_state::<Database>() {
            let role = db
                .conn
                .lock()
                .ok()
                .and_then(|conn| {
                    conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'codex_role'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                })
                .unwrap_or_else(|| "owner".to_string());

            if role != "consumer" {
                std::thread::sleep(Duration::from_secs(300));
                continue;
            }

            // 自动同步开关（consumer 未设置时默认开启）
            let auto_sync = db
                .conn
                .lock()
                .ok()
                .and_then(|conn| {
                    conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'codex_auto_sync'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                })
                .map(|v| v == "true")
                .unwrap_or(true);

            if !auto_sync {
                std::thread::sleep(Duration::from_secs(300));
                continue;
            }

            // 拉取 Gist 加密内容并算指纹（前 32 字符足够区分变化）
            let encrypted =
                tauri::async_runtime::block_on(commands::codex::fetch_codex_gist_encrypted(&db));
            match encrypted {
                Ok(enc) => {
                    let fingerprint = if enc.len() >= 32 {
                        enc[..32].to_string()
                    } else {
                        enc.clone()
                    };
                    if last_signature.as_deref() != Some(fingerprint.as_str()) {
                        // 内容变化（或首次）→ 解密应用
                        match tauri::async_runtime::block_on(
                            commands::codex::apply_codex_auth(&enc, &db),
                        ) {
                            Ok(()) => {
                                eprintln!("Codex auto-sync: gist changed, applied successfully");
                                last_signature = Some(fingerprint);
                            }
                            Err(e) => eprintln!("Codex auto-sync apply failed: {}", e),
                        }
                    }
                }
                Err(e) => eprintln!("Codex auto-sync fetch failed: {}", e),
            }
        }

        std::thread::sleep(Duration::from_secs(300)); // 5 分钟检测一次
    }
}

fn run_spin_scheduler(app: &tauri::AppHandle) {
    if let Some(db) = app.try_state::<Database>() {
        if let Ok(conn) = db.conn.lock() {
            let config = commands::spin::read_config(&conn);
            let history = commands::spin::read_history(&conn);
            if let Some(history_key) = commands::spin::should_spin(&config, &history, &conn) {
                let model = commands::spin::read_spin_model(&conn);
                let account_id = config.account_id.clone();
                drop(conn);
                if let Some(account_id) = account_id {
                    if let Err(err) = commands::spin::send_spin_request(&account_id, &model) {
                        eprintln!("Auto spin failed: {}", err);
                    } else if let Some(db2) = app.try_state::<Database>() {
                        if let Ok(conn2) = db2.conn.lock() {
                            let _ = commands::spin::record_spin_history(&conn2, &history_key);
                        }
                    }
                }
            }
        }
    }
}

// ========== IPC 命令 ==========

#[tauri::command]
fn close_popover(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(POPOVER_LABEL) {
        let _ = window.hide();
    }
}

#[tauri::command]
fn start_window_drag(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window(POPOVER_LABEL) {
        platform::windows::start_drag(&window);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

#[tauri::command]
fn fit_window_size(app: tauri::AppHandle, height: f64) {
    if let Some(window) = app.get_webview_window(POPOVER_LABEL) {
        let pos = match window.outer_position() {
            Ok(p) => p,
            Err(_) => return,
        };
        let scale = window.scale_factor().unwrap_or(1.0);
        let new_w = (360.0 * scale as f64) as u32;
        let new_h = (height * scale as f64) as u32;
        let _ = window.set_size(tauri::PhysicalSize::new(new_w, new_h));
        let _ = window.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
    }
}

#[tauri::command]
fn refresh_all(app: tauri::AppHandle) -> Result<RefreshResult, String> {
    let result = refresh_all_accounts(&app);
    MAX_PERCENTAGE.store(result.max_pct, Ordering::SeqCst);
    update_tray_display(&app, &result.primary_items);
    Ok(result)
}

// ========== 入口 ==========

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            platform::init_app(app);

            let db = Database::new(&get_db_path(app))
                .expect("Failed to initialize database");
            db.init_tables().expect("Failed to create tables");

            {
                if let Ok(conn) = db.conn.lock() {
                    alert::rules::init_default_rules(&conn);
                }
            }

            // 在 manage 前读取代理配置（app.manage 会 move db）
            let proxy_url = db
                .conn
                .lock()
                .ok()
                .and_then(|conn| {
                    conn.query_row(
                        "SELECT value FROM app_settings WHERE key = 'codex_proxy'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                })
                .unwrap_or_default();

            app.manage(db);

            // 初始化 Codex/Gist 代理 client（境外端点走代理，智谱走直连）
            init_proxy_client(&proxy_url);

            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let refresh_item = MenuItemBuilder::with_id("refresh", "立即刷新").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&refresh_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("GLM Quota Monitor")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "refresh" => {
                        do_refresh(app);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        create_popover_window(app);
                    }
                })
                .build(app)?;

            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(5));
                do_refresh(&app_handle);

                loop {
                    let interval = if let Some(db) = app_handle.try_state::<Database>() {
                        get_refresh_interval(&db)
                    } else {
                        DEFAULT_REFRESH_INTERVAL_SECS
                    };
                    std::thread::sleep(Duration::from_secs(interval));
                    do_refresh(&app_handle);
                }
            });

            let automation_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(30));
                loop {
                    run_spin_scheduler(&automation_handle);
                    std::thread::sleep(Duration::from_secs(60));
                }
            });

            // Codex 鉴权自动上传线程（仅 owner 角色）
            // 定时检测本机 auth.json 变化，自动加密上传到 Gist
            let codex_handle = app.handle().clone();
            std::thread::spawn(move || {
                run_codex_auto_upload(&codex_handle);
            });

            // Codex 鉴权自动同步线程（仅 consumer 角色）
            // 定时从 Gist 拉取，有变化才解密应用到本机
            let codex_sync_handle = app.handle().clone();
            std::thread::spawn(move || {
                run_codex_auto_sync(&codex_sync_handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::account::add_account,
            commands::account::list_accounts,
            commands::account::delete_account,
            commands::account::update_account_alias,
            commands::account::set_primary_account,
            commands::account::validate_api_key,
            commands::account::mask_api_key,
            commands::account::get_api_key_raw,
            commands::account::update_api_key,
            commands::agent::bind_agent,
            commands::agent::get_agent_bindings,
            commands::agent::unbind_agent,
            commands::agent::fetch_models,
            commands::agent::get_default_model,
            commands::agent::set_default_model,
            commands::spin::spin_now,
            commands::spin::set_spin_config,
            commands::spin::get_spin_status,
            commands::spin::spin_status_detail,
            commands::spin::get_spin_history,
            commands::alerts::get_alert_rules,
            commands::alerts::update_alert_rule,
            commands::alerts::set_webhook_url,
            commands::alerts::get_webhook_url,
            commands::cost::get_cost_estimate,
            commands::cost::set_plan_price,
            commands::cost::get_plan_price,
            commands::cost::set_unit_price,
            commands::cost::get_unit_price,
            commands::quota::get_quota,
            commands::history::get_snapshots,
            commands::history::get_token_history,
            commands::summary::get_usage_summary,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::tool_usage::get_tool_usage,
            commands::export::export_usage_csv,
            commands::export::export_usage_json,
            commands::codex::get_codex_quota,
            commands::codex::read_local_codex_auth,
            commands::codex::add_codex_account,
            commands::codex::upload_codex_auth,
            commands::codex::sync_codex_auth,
            commands::codex::test_codex_connection,
            commands::codex::set_codex_gist_url,
            commands::codex::get_codex_gist_url,
            commands::codex::set_codex_github_token,
            commands::codex::get_codex_github_token,
            commands::codex::set_codex_role,
            commands::codex::get_codex_role,
            commands::codex::get_codex_sync_info,
            commands::codex::set_codex_auto_upload,
            commands::codex::get_codex_auto_upload,
            commands::codex::set_codex_auto_sync,
            commands::codex::get_codex_auto_sync,
            commands::codex::set_codex_proxy,
            commands::codex::get_codex_proxy,
            close_popover,
            start_window_drag,
            fit_window_size,
            refresh_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
