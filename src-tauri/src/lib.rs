mod alert;
mod api;
mod codex;
mod commands;
mod crypto;
mod db;
mod deepseek;
mod platform;
mod pricing;
mod sub2api;

use api::client::ZhipuClient;
use api::types::QuotaData;
use chrono::Timelike;
use db::Database;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{LazyLock, RwLock};
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
/// Codex/Gist 专用代理 client（chatgpt.com / github.com 等境外端点）
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    // 绕过 macOS 系统代理（HTTP/HTTPS/SOCKS=127.0.0.1:50470）：GLM/DeepSeek 均为
    // 国内直连服务，reqwest 默认读系统代理会导致 DeepSeek 请求被代理劫持而超时
    //（表现为"额度总离线"）。Codex/Gist 境外端点仍走 PROXY_CLIENT。
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});
/// 智谱 API 继续用 HTTP_CLIENT 直连（国内）
static PROXY_CLIENT: LazyLock<RwLock<reqwest::Client>> =
    LazyLock::new(|| RwLock::new(build_proxy_client("")));

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

/// 更新 Codex/Gist 代理 client。保存设置后立即生效。
pub fn set_proxy_client(proxy_url: &str) -> Result<(), String> {
    let client = build_proxy_client(proxy_url);
    let mut guard = PROXY_CLIENT
        .write()
        .map_err(|e| format!("代理配置锁定失败: {}", e))?;
    *guard = client;
    Ok(())
}

/// 取代理 client。reqwest::Client clone 只复制句柄，开销很低。
/// 返回 owned Client 便于调用方按需取引用（与 fallback 双 client 逻辑配合）。
pub fn proxy_http_client() -> reqwest::Client {
    PROXY_CLIENT
        .read()
        .map(|client| client.clone())
        .unwrap_or_else(|_| reqwest::Client::new())
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
    /// DeepSeek 余额（绝对货币）；GLM/Codex 为 None（它们走 pct）。
    /// 托盘 deepseek 分支显 `D{balance}`（无 %），其余仍 `{prefix}{pct}%`。
    balance: Option<f64>,
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

fn position_popover_with_size(
    window: &tauri::WebviewWindow,
    app: &tauri::AppHandle,
    requested_size: Option<tauri::PhysicalSize<u32>>,
) {
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(Some(rect)) = tray.rect() {
            if let (tauri::Position::Physical(pos), tauri::Size::Physical(size)) =
                (rect.position, rect.size)
            {
                let scale = window.scale_factor().unwrap_or(1.0);
                let window_size = requested_size.unwrap_or_else(|| {
                    window.inner_size().unwrap_or(tauri::PhysicalSize::new(
                        (platform::POPOVER_WIDTH_LOGICAL * scale) as u32,
                        (600.0 * scale) as u32,
                    ))
                });
                let window_w = window_size.width;
                let window_h = window_size.height;
                let tray_center_x = f64::from(pos.x) + f64::from(size.width) / 2.0;
                let tray_center_y = f64::from(pos.y) + f64::from(size.height) / 2.0;
                let work_area = window
                    .monitor_from_point(tray_center_x, tray_center_y)
                    .ok()
                    .flatten()
                    .or_else(|| window.current_monitor().ok().flatten())
                    .map(|monitor| {
                        let area = monitor.work_area();
                        platform::WorkArea::new(
                            area.position.x,
                            area.position.y,
                            area.size.width,
                            area.size.height,
                        )
                    });
                let (x, y) = platform::popover_position(
                    pos.x,
                    pos.y,
                    size.width,
                    size.height,
                    window_w,
                    window_h,
                    work_area,
                );
                let _ = window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x, y),
                ));
            }
        }
    }
}

fn position_popover(window: &tauri::WebviewWindow, app: &tauri::AppHandle) {
    position_popover_with_size(window, app, None);
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

    let window = WebviewWindowBuilder::new(
        app,
        POPOVER_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("GLM Quota Monitor")
    .inner_size(platform::POPOVER_WIDTH_LOGICAL, 600.0)
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

fn parse_refresh_interval_secs(value: Option<&str>) -> u64 {
    value
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|minutes| (1..=30).contains(minutes))
        .map(|minutes| minutes * 60)
        .unwrap_or(DEFAULT_REFRESH_INTERVAL_SECS)
}

fn get_refresh_interval(db: &Database) -> u64 {
    let conn = match db.conn.lock() {
        Ok(c) => c,
        Err(_) => return DEFAULT_REFRESH_INTERVAL_SECS,
    };
    let value = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'refresh_interval'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    parse_refresh_interval_secs(value.as_deref())
}

fn resolve_api_key_for_refresh(account_id: &str) -> Option<String> {
    crypto::get_api_key(account_id).ok()
}

/// GLM 账号额度查询（原有逻辑）
fn fetch_zhipu_account_quota(
    _account_id: &str,
    api_key: &str,
) -> Result<(QuotaData, i32, f64, f64), String> {
    let client = ZhipuClient::with_client(&HTTP_CLIENT, api_key);
    let quota =
        tauri::async_runtime::block_on(client.get_quota_limit()).map_err(|e| e.to_string())?;
    let pct = quota
        .preferred_token_limit()
        .map(|l| l.percentage as i32)
        .unwrap_or(0);

    let (today_tokens, today_calls) = fetch_today_tokens(&client);

    Ok((quota, pct, today_tokens, today_calls))
}

/// Codex 账号额度查询
/// 优先使用本机 auth.json；必要时刷新 token 并同步到 Keychain。
fn fetch_codex_account_quota(
    db: &Database,
    account_id: &str,
) -> Result<(QuotaData, i32, f64, f64), String> {
    // 第一步：尝试本机 auth.json（Codex CLI 维护的，总是最新源）
    let local_auth = codex::auth::read_local_auth_json()
        .or_else(|_| codex::auth::read_auth_from_keychain(account_id))?;

    if local_auth.tokens.access_token.is_empty() {
        return Err("无 access_token".to_string());
    }

    // 检查 token 是否快过期（<2天），如果是则自动刷新
    let auth = if is_token_expiring_soon(&local_auth.tokens.access_token, 2) {
        eprintln!("Codex token 即将过期，尝试自动刷新...");
        let proxy = proxy_http_client();
        match codex::auth::refresh_and_sync_with_fallback(
            &proxy,
            &HTTP_CLIENT,
            &local_auth,
            account_id,
        ) {
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

    let proxy = proxy_http_client();
    let usage_result =
        tauri::async_runtime::block_on(codex::client::CodexClient::get_usage_with_fallback(
            &proxy,
            &HTTP_CLIENT,
            &auth.tokens.access_token,
        ));

    let usage = match usage_result {
        Ok(usage) => usage,
        Err(codex::client::CodexApiError::Http(reqwest::StatusCode::UNAUTHORIZED)) => {
            eprintln!("Codex token 返回 401，尝试刷新后重试...");
            let proxy = proxy_http_client();
            let refreshed = codex::auth::refresh_and_sync_with_fallback(
                &proxy,
                &HTTP_CLIENT,
                &auth,
                account_id,
            )
            .map_err(|e| format!("wham/usage 调用失败，且刷新 token 失败: {}", e))?;
            let proxy = proxy_http_client();
            tauri::async_runtime::block_on(codex::client::CodexClient::get_usage_with_fallback(
                &proxy,
                &HTTP_CLIENT,
                &refreshed.tokens.access_token,
            ))
            .map_err(|e| format!("wham/usage 重试失败: {}", e))?
        }
        Err(e) => return Err(format!("wham/usage 调用失败: {}", e)),
    };

    Ok(finalize_codex_quota(db, account_id, &usage))
}

/// DeepSeek 账号额度查询：拉 /user/balance → 转 minimal QuotaData（DEEPSEEK_BALANCE）→ 写快照。
///
/// 返回 `(quota, 0, 0.0, 0.0)` —— DeepSeek 是绝对货币余额，无百分比/今日 token 概念，
/// 与 Codex 同传 0（见 finalize_codex_quota）。富展示数据走 `commands::deepseek::get_deepseek_balance`。
/// **绝不调用 `record_quota_snapshot`**（只认 TIME/TOKENS/MCP，会丢 DEEPSEEK_BALANCE 并污染 GLM 表）。
fn fetch_deepseek_account_quota(
    db: &Database,
    account_id: &str,
) -> Result<(QuotaData, i32, f64, f64), String> {
    let api_key = match deepseek::auth::get_api_key(account_id) {
        Ok(k) => k,
        Err(e) => {
            log_deepseek(&format!(
                "fetch get_api_key FAILED account={account_id} err={e}"
            ));
            return Err(format!("读取 DeepSeek API Key 失败: {e}"));
        }
    };
    let started = std::time::Instant::now();
    let fallback = proxy_http_client();
    let balance = tauri::async_runtime::block_on(
        deepseek::client::DeepSeekClient::get_balance_with_fallback(
            &HTTP_CLIENT,
            &fallback,
            &api_key,
        ),
    )
    .map_err(|e| {
        let msg = commands::deepseek::deepseek_error_msg(&e);
        log_deepseek(&format!(
            "fetch FAILED account={account_id} {:?} err={msg}",
            started.elapsed()
        ));
        msg
    })?;
    log_deepseek(&format!(
        "fetch OK account={account_id} {:?} total={:?}",
        started.elapsed(),
        balance.balance_infos.first().map(|i| &i.total_balance)
    ));

    let quota = deepseek::balance_to_quota_data(&balance);

    if let Ok(conn) = db.conn.lock() {
        let _ = db::record_deepseek_snapshot(&conn, account_id, &balance);
    }

    Ok((quota, 0, 0.0, 0.0))
}

/// 把 DeepSeek 拉取诊断追加到 app_data_dir/deepseek.log（release 无 stderr，便于定位"总离线"）
fn log_deepseek(msg: &str) {
    use std::io::Write;
    let Some(base) = dirs::data_dir().map(|d| d.join("com.ngaizean.glm-quota-monitor")) else {
        return;
    };
    let path = base.join("deepseek.log");
    let _ = std::fs::create_dir_all(&base);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(
            f,
            "[{}] {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            msg
        );
    }
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
) -> (QuotaData, i32, f64, f64) {
    let quota = codex::usage_to_quota_data(usage);
    // Codex 仅有周额度（TOKENS_LIMIT + unit=6），取其百分比作为卡片徽标
    let pct = quota
        .limits
        .iter()
        .find(|l| l.limit_type == "TOKENS_LIMIT" && l.unit == Some(6.0))
        .map(|l| l.percentage as i32)
        .unwrap_or(0);

    if let Ok(conn) = db.conn.lock() {
        // Codex 无"今日 token/调用数"概念，均传 0.0
        let _ = db::record_quota_snapshot(&conn, account_id, &quota, 0.0, 0.0);
        detect_codex_activity(&conn, account_id, &quota);
    }

    (quota, pct, 0.0, 0.0)
}

/// Codex 活跃检测：对比周额度百分比变化（Codex 仅有周额度，5h 窗口已废弃）。
fn detect_codex_activity(conn: &rusqlite::Connection, account_id: &str, quota: &QuotaData) {
    let prev_pct = conn
        .query_row(
            "SELECT weekly_limit_pct FROM usage_snapshots \
             WHERE account_id = ?1 AND weekly_limit_pct IS NOT NULL \
             ORDER BY timestamp DESC LIMIT 1 OFFSET 1",
            rusqlite::params![account_id],
            |row| row.get::<_, Option<f64>>(0),
        )
        .ok()
        .flatten();

    let current_weekly = quota
        .limits
        .iter()
        .find(|l| l.limit_type == "TOKENS_LIMIT" && l.unit == Some(6.0))
        .map(|l| l.percentage)
        .unwrap_or(0.0);

    if let Some(prev) = prev_pct {
        if current_weekly > prev {
            let now_str = chrono::Local::now().to_rfc3339();
            let key = format!("last_active_{}", account_id);
            let _ = conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
                rusqlite::params![key, now_str],
            );
        }
    }
}

/// 获取今日（本地 00:00 至现在）的 token 用量与调用次数，返回 (tokens, calls)。
/// API 失败时返回 (0.0, 0.0) 而非报错，避免阻塞快照写入。
/// 提取为 pub 以便 quota.rs 的手动刷新路径复用，修复趋势图清零 bug。
pub fn fetch_today_tokens(client: &ZhipuClient) -> (f64, f64) {
    let now = chrono::Local::now();
    // with_hour(0) 在夏令时前跳的 00:00 极少数情况返回 None，安全回退到 now
    let today_start = now
        .with_hour(0)
        .and_then(|dt| dt.with_minute(0))
        .and_then(|dt| dt.with_second(0))
        .unwrap_or(now);
    let fmt = |dt: chrono::DateTime<chrono::Local>| dt.format("%Y-%m-%d %H:%M:%S").to_string();
    match tauri::async_runtime::block_on(client.get_model_usage(&fmt(today_start), &fmt(now))) {
        Ok(data) => (
            data.total_usage.total_tokens_usage,
            data.total_usage.total_model_call_count,
        ),
        Err(_) => (0.0, 0.0),
    }
}

struct CachedQuotaLimits {
    time_pct: Option<f64>,
    time_reset: Option<i64>,
    token_pct: Option<f64>,
    token_reset: Option<i64>,
    weekly_pct: Option<f64>,
    weekly_reset: Option<i64>,
    mcp_pct: Option<f64>,
    mcp_reset: Option<i64>,
}

/// 网络异常时从本地缓存构造离线 QuotaData
fn build_offline_quota(
    db: &Database,
    account_id: &str,
    error: &crate::api::client::ApiError,
) -> Option<QuotaData> {
    let mut offline_quota = QuotaData {
        is_offline: true,
        ..Default::default()
    };

    if let Ok(conn2) = db.conn.lock() {
        // 读取最近快照
        let platform = conn2
            .query_row(
                "SELECT platform FROM accounts WHERE id = ?1",
                rusqlite::params![account_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "zhipu".to_string());
        let snap_limits: Option<CachedQuotaLimits> = conn2
            .query_row(
                "SELECT time_limit_pct, time_limit_reset, token_limit_pct, token_limit_reset, \
                        weekly_limit_pct, weekly_limit_reset, mcp_limit_pct, mcp_limit_reset \
                 FROM usage_snapshots WHERE account_id = ?1 ORDER BY timestamp DESC LIMIT 1",
                rusqlite::params![account_id],
                |row| {
                    Ok(CachedQuotaLimits {
                        time_pct: row.get(0)?,
                        time_reset: row.get(1)?,
                        token_pct: row.get(2)?,
                        token_reset: row.get(3)?,
                        weekly_pct: row.get(4)?,
                        weekly_reset: row.get(5)?,
                        mcp_pct: row.get(6)?,
                        mcp_reset: row.get(7)?,
                    })
                },
            )
            .ok();

        if let Some(snapshot) = snap_limits {
            if let (Some(pct), Some(reset)) = (snapshot.time_pct, snapshot.time_reset) {
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
            // 迁移后的旧 Codex 快照会同时保留 token/weekly；只回显周额度，避免重复。
            if platform != "codex" {
                if let (Some(pct), Some(reset)) = (snapshot.token_pct, snapshot.token_reset) {
                    offline_quota.limits.push(crate::api::types::QuotaLimit {
                        limit_type: "TOKENS_LIMIT".into(),
                        percentage: pct,
                        next_reset_time: reset,
                        unit: Some(3.0),
                        number: None,
                        usage: None,
                        current_value: None,
                        remaining: None,
                        usage_details: None,
                    });
                }
            }
            if let (Some(pct), Some(reset)) = (snapshot.weekly_pct, snapshot.weekly_reset) {
                offline_quota.limits.push(crate::api::types::QuotaLimit {
                    limit_type: "TOKENS_LIMIT".into(),
                    percentage: pct,
                    next_reset_time: reset,
                    unit: Some(6.0),
                    number: None,
                    usage: None,
                    current_value: None,
                    remaining: None,
                    usage_details: None,
                });
            } else if platform == "codex" {
                // 极旧数据库尚未完成周额度回填时的兼容兜底。
                if let (Some(pct), Some(reset)) = (snapshot.token_pct, snapshot.token_reset) {
                    offline_quota.limits.push(crate::api::types::QuotaLimit {
                        limit_type: "TOKENS_LIMIT".into(),
                        percentage: pct,
                        next_reset_time: reset,
                        unit: Some(6.0),
                        number: None,
                        usage: None,
                        current_value: None,
                        remaining: None,
                        usage_details: None,
                    });
                }
            }
            if let (Some(pct), Some(reset)) = (snapshot.mcp_pct, snapshot.mcp_reset) {
                offline_quota.limits.push(crate::api::types::QuotaLimit {
                    limit_type: "MCP_MONTHLY".into(),
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
    } else if error.to_string().contains("吊销") || error.to_string().contains("TokenInvalidated")
    {
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

/// DeepSeek 网络异常时的离线重建：从 `deepseek_snapshots` 最近一次快照构造 DEEPSEEK_BALANCE QuotaLimit。
///
/// 与 [`build_offline_quota`]（GLM/Codex，读 usage_snapshots）并行；按平台分流，互不污染。
/// `err_msg` 已是经 `deepseek_error_msg` 转过的友好文案（fetch 端 stringify）。
/// 始终返回 Some（即便无快照也保留 error，让 popover 离线卡显错误串）；currency 信息无法塞进 QuotaLimit，丢弃。
fn build_deepseek_offline_quota(
    db: &Database,
    account_id: &str,
    err_msg: &str,
) -> Option<QuotaData> {
    let mut quota = QuotaData {
        is_offline: true,
        error: Some(err_msg.to_string()),
        ..Default::default()
    };

    if let Ok(conn) = db.conn.lock() {
        // 取最近一次快照的全部币种行（一次拉取的多币种共享同一 timestamp）
        let latest_ts: Option<String> = conn
            .query_row(
                "SELECT MAX(timestamp) FROM deepseek_snapshots WHERE account_id = ?1",
                rusqlite::params![account_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();
        if let Some(ts) = latest_ts {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT total_balance, granted_balance, topped_up_balance \
                 FROM deepseek_snapshots WHERE account_id = ?1 AND timestamp = ?2",
            ) {
                let rows = stmt.query_map(rusqlite::params![account_id, ts], |row| {
                    Ok((
                        row.get::<_, f64>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, f64>(2)?,
                    ))
                });
                if let Ok(rows) = rows {
                    for r in rows.flatten() {
                        let (total, granted, topped) = r;
                        let lifetime = granted + topped;
                        quota.limits.push(crate::api::types::QuotaLimit {
                            limit_type: deepseek::LIMIT_TYPE_BALANCE.to_string(),
                            percentage: 0.0,
                            next_reset_time: 0,
                            unit: None,
                            number: Some(lifetime),
                            usage: Some((lifetime - total).max(0.0)),
                            current_value: Some(total),
                            remaining: Some(total),
                            usage_details: None,
                        });
                    }
                }
            }
        }

        // 读取持久化的 last_active（DeepSeek 当前不写入，恒为 None；保留以备 Phase 2）
        let key = format!("last_active_{}", account_id);
        quota.last_active = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                rusqlite::params![key],
                |row| row.get::<_, String>(0),
            )
            .ok();
    }

    Some(quota)
}

/// 检测账号活跃度：对比快照中 token 百分比变化
fn detect_account_activity(conn: &rusqlite::Connection, account_id: &str, quota: &QuotaData) {
    let current_pct = quota
        .preferred_token_limit()
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
        None => {
            return RefreshResult {
                max_pct: 0,
                quotas: HashMap::new(),
                primary_items: Vec::new(),
            }
        }
    };

    // (id, alias, platform, is_primary)
    let accounts: Vec<(String, String, String, bool)> = {
        let Ok(guard) = db.conn.lock() else {
            return RefreshResult {
                max_pct: 0,
                quotas: HashMap::new(),
                primary_items: Vec::new(),
            };
        };
        let result = guard.prepare(
            "SELECT id, alias, platform, COALESCE(is_primary, 0) FROM accounts WHERE is_active = 1",
        );
        let Ok(mut stmt) = result else {
            return RefreshResult {
                max_pct: 0,
                quotas: HashMap::new(),
                primary_items: Vec::new(),
            };
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)? == 1,
            ))
        });
        match rows {
            Ok(r) => r.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        }
    };

    // 读取 webhook URL
    let webhook_url: Option<String> = db.conn.lock().ok().and_then(|conn| {
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

    for (account_id, account_alias, platform, is_primary) in &accounts {
        // Codex 账号凭证从 Keychain 读取（不走 GLM 的 api_key 解析）
        if platform == "codex" {
            match fetch_codex_account_quota(&db, account_id) {
                Ok((mut quota, pct, _, _)) => {
                    if pct > max_pct {
                        max_pct = pct;
                    }
                    if *is_primary {
                        primary_items.push(PrimaryDisplay {
                            platform: "codex".to_string(),
                            pct,
                            balance: None,
                        });
                    }

                    // 读取持久化的 last_active（和 GLM 一致）
                    if let Ok(conn2) = db.conn.lock() {
                        let key = format!("last_active_{}", account_id);
                        quota.last_active = conn2
                            .query_row(
                                "SELECT value FROM app_settings WHERE key = ?1",
                                rusqlite::params![key],
                                |row| row.get::<_, String>(0),
                            )
                            .ok();
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
                    if let Some(offline_quota) = build_offline_quota(
                        &db,
                        account_id,
                        &crate::api::client::ApiError::Api { code: -1, msg: e },
                    ) {
                        quotas.insert(account_id.clone(), offline_quota);
                    }
                }
            }
            continue;
        }

        // DeepSeek 账号：余额本位（绝对货币），无百分比/今日 token 概念
        if platform == "deepseek" {
            match fetch_deepseek_account_quota(&db, account_id) {
                Ok((mut quota, _pct, _, _)) => {
                    // 首条 DEEPSEEK_BALANCE 的 total 即托盘徽章余额
                    let total = quota
                        .limits
                        .iter()
                        .find(|l| l.limit_type == deepseek::LIMIT_TYPE_BALANCE)
                        .and_then(|l| l.current_value);

                    if *is_primary {
                        if let Some(bal) = total {
                            primary_items.push(PrimaryDisplay {
                                platform: "deepseek".to_string(),
                                pct: 0,
                                balance: Some(bal),
                            });
                        }
                        // total=None（如 is_available=false 且无解析条目）时不推徽章，
                        // 避免显示误导性的 D0；其余平台的 max_pct 仍生效。
                    }

                    if let Ok(conn2) = db.conn.lock() {
                        let key = format!("last_active_{}", account_id);
                        quota.last_active = conn2
                            .query_row(
                                "SELECT value FROM app_settings WHERE key = ?1",
                                rusqlite::params![key],
                                |row| row.get::<_, String>(0),
                            )
                            .ok();
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
                    eprintln!("Failed to refresh deepseek account {}: {}", account_id, e);
                    // DeepSeek 错误无法装进 ApiError；e 已是 deepseek_error_msg 转过的友好串
                    if let Some(offline) = build_deepseek_offline_quota(&db, account_id, &e) {
                        quotas.insert(account_id.clone(), offline);
                    }
                }
            }
            continue;
        }

        // GLM 账号：从 Keychain 读取 API Key
        let api_key = match resolve_api_key_for_refresh(account_id) {
            Some(k) => k,
            None => continue,
        };

        match fetch_zhipu_account_quota(account_id, &api_key) {
            Ok((mut quota, pct, today_tokens, today_calls)) => {
                if pct > max_pct {
                    max_pct = pct;
                }
                if *is_primary {
                    primary_items.push(PrimaryDisplay {
                        platform: "zhipu".to_string(),
                        pct,
                        balance: None,
                    });
                }

                if let Ok(conn2) = db.conn.lock() {
                    let _ = db::record_quota_snapshot(
                        &conn2,
                        account_id,
                        &quota,
                        today_tokens,
                        today_calls,
                    );
                    detect_account_activity(&conn2, account_id, &quota);

                    // 读取持久化的 last_active
                    let key = format!("last_active_{}", account_id);
                    quota.last_active = conn2
                        .query_row(
                            "SELECT value FROM app_settings WHERE key = ?1",
                            rusqlite::params![key],
                            |row| row.get::<_, String>(0),
                        )
                        .ok();
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

                let api_err = crate::api::client::ApiError::Api {
                    code: -1,
                    msg: e.clone(),
                };
                if let Some(offline_quota) = build_offline_quota(&db, account_id, &api_err) {
                    quotas.insert(account_id.clone(), offline_quota);
                }
            }
        }
    }

    let display_pct = if primary_items.is_empty() {
        max_pct
    } else {
        primary_items.iter().map(|i| i.pct).max().unwrap_or(0)
    };
    RefreshResult {
        max_pct: display_pct,
        quotas,
        primary_items,
    }
}

/// 读取雷达最佳模型 + 24h 重置概率（None=未就绪/拉取失败），并刷新托盘显示
pub(crate) fn update_tray_display(app: &tauri::AppHandle, primary_items: &[PrimaryDisplay]) {
    let radar = app
        .try_state::<commands::codex_radar::CodexRadarState>()
        .and_then(|s| {
            let g = s.0.lock().ok()?;
            g.as_ref()
                .map(|d| (d.best_model.clone(), d.probability_24h))
        });
    let (radar_model, radar_prob) = match radar {
        Some((m, p)) if !m.is_empty() && m != "?" => (Some(m), Some(p)),
        _ => (None, None),
    };
    platform::update_tray(app, primary_items, radar_model.as_deref(), radar_prob);
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
    let github_token =
        commands::codex::read_github_token(db).ok_or_else(|| "未配置 GitHub Token".to_string())?;

    let auth = codex::auth::read_local_auth_json()?;
    let json = serde_json::to_string(&auth).map_err(|e| format!("序列化失败: {}", e))?;
    let encrypted = codex::crypto::encrypt(&json)?;

    let proxy = proxy_http_client();
    tauri::async_runtime::block_on(codex::sync::push_to_gist(
        &proxy,
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

/// SSH 自动覆盖调度
/// 每 5 分钟检测一次：对开启自动覆盖的主机，若本机 auth.json 有变化（指纹），
/// 且该主机「免密」或「已存储密码」才执行推送；非免密且无密码的主机跳过
/// （由用户手动弹框输入密码后开启）。
fn run_ssh_auto_override(app: &tauri::AppHandle) {
    std::thread::sleep(Duration::from_secs(60));
    let mut last_signatures: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    loop {
        if let Some(db) = app.try_state::<Database>() {
            // 本机 auth.json 变化指纹（与 run_codex_auto_upload 一致）
            let current_sig = codex::auth::read_local_auth_json().ok().map(|auth| {
                let token_fingerprint = if auth.tokens.access_token.len() >= 16 {
                    &auth.tokens.access_token[..16]
                } else {
                    &auth.tokens.access_token
                };
                format!(
                    "{}|{}",
                    auth.last_refresh.clone().unwrap_or_default(),
                    token_fingerprint
                )
            });

            if let Some(sig) = current_sig {
                // 开启自动覆盖的主机
                let enabled_hosts: Vec<String> = db
                    .conn
                    .lock()
                    .ok()
                    .and_then(|conn| {
                        let mut stmt = conn
                            .prepare(
                                "SELECT key FROM app_settings \
                                 WHERE key LIKE 'ssh_auto_override_%' AND value = 'true'",
                            )
                            .ok()?;
                        let rows = stmt.query_map([], |row| row.get::<_, String>(0)).ok()?;
                        Some(
                            rows.filter_map(|r| r.ok())
                                .filter_map(|k| {
                                    k.strip_prefix("ssh_auto_override_").map(|s| s.to_string())
                                })
                                .collect(),
                        )
                    })
                    .unwrap_or_default();

                for host in &enabled_hosts {
                    if last_signatures.get(host) == Some(&sig) {
                        continue;
                    }
                    // 认证方式：免密优先，其次已存密码，否则跳过。
                    // 跳过时不记录指纹，这样用户补存密码后下一轮（5 分钟内）自动生效。
                    let result = if codex::ssh::is_passwordless(host) {
                        codex::ssh::push_auth_json(host, None)
                    } else if let Some(pw) = codex::ssh::read_ssh_password(host) {
                        codex::ssh::push_auth_json(host, Some(&pw))
                    } else {
                        eprintln!(
                            "SSH auto-override skip {host}: 非免密且未存储密码，不做自动覆盖"
                        );
                        continue;
                    };
                    match result {
                        Ok(()) => {
                            eprintln!("SSH auto-override ok: {host} 已覆盖 auth.json");
                            last_signatures.insert(host.clone(), sig.clone());
                        }
                        Err(e) => {
                            eprintln!("SSH auto-override failed for {host}: {e}");
                        }
                    }
                }
            }
        }

        std::thread::sleep(Duration::from_secs(300)); // 5 分钟检测一次
    }
}

/// 把 auto-sync 日志追加到 app_data_dir/codex_auto_sync.log
/// （GUI release build 无 stderr console，后台线程日志只能落文件）
fn log_auto_sync(msg: &str) {
    use std::io::Write;
    let Some(base) = dirs::data_dir() else { return };
    let dir = base.join("com.ngaizean.glm-quota-monitor");
    let path = dir.join("codex_auto_sync.log");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(
            f,
            "[{}] {}",
            chrono::Utc::now().format("%Y-%m-%d %H:%M:%S"),
            msg
        );
    }
}

/// Codex 鉴权自动同步调度（consumer 角色）
/// 每 5 分钟从 Gist 拉取加密内容，与上次指纹对比，有变化（或首次）才解密应用。
/// 避免无谓地反复写本机 auth.json / Keychain。
fn run_codex_auto_sync(app: &tauri::AppHandle) {
    log_auto_sync("thread started, sleep 60s before first run");
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
                log_auto_sync(&format!(
                    "skip: role={role} (auto-sync only runs for consumer)"
                ));
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
                log_auto_sync("skip: auto_sync disabled");
                std::thread::sleep(Duration::from_secs(300));
                continue;
            }

            // 拉取 Gist 加密内容并算指纹（前 32 字符足够区分变化）
            log_auto_sync("fetching gist...");
            let encrypted =
                tauri::async_runtime::block_on(commands::codex::fetch_codex_gist_encrypted(&db));
            match encrypted {
                Ok(enc) => {
                    let fingerprint = if enc.len() >= 32 {
                        enc[..32].to_string()
                    } else {
                        enc.clone()
                    };
                    log_auto_sync(&format!(
                        "fetch ok, {} bytes, fp prefix={}",
                        enc.len(),
                        &fingerprint[..8.min(fingerprint.len())]
                    ));
                    if last_signature.as_deref() != Some(fingerprint.as_str()) {
                        // 内容变化（或首次）→ 解密应用
                        log_auto_sync("content changed (or first run), applying...");
                        match tauri::async_runtime::block_on(commands::codex::apply_codex_auth(
                            &enc, &db,
                        )) {
                            Ok(()) => {
                                log_auto_sync("applied successfully");
                                last_signature = Some(fingerprint);
                            }
                            Err(e) => log_auto_sync(&format!("apply FAILED: {e}")),
                        }
                    } else {
                        log_auto_sync("no change since last run, skip apply");
                    }
                }
                Err(e) => log_auto_sync(&format!("fetch FAILED: {e}")),
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
fn fit_window_size(app: tauri::AppHandle, height: f64, width: Option<f64>) {
    if let Some(window) = app.get_webview_window(POPOVER_LABEL) {
        let scale = window.scale_factor().unwrap_or(1.0);
        let current_width = window
            .inner_size()
            .map(|size| size.width as f64 / scale)
            .unwrap_or(platform::POPOVER_WIDTH_LOGICAL);
        let logical_width = width.unwrap_or(current_width).clamp(360.0, 960.0);
        let logical_height = height.clamp(160.0, 1200.0);
        let new_w = (logical_width * scale) as u32;
        let new_h = (logical_height * scale) as u32;
        let requested_size = tauri::PhysicalSize::new(new_w, new_h);
        let _ = window.set_size(requested_size);
        // set_size 的系统事件可能延迟，立即重定位时直接使用本次请求尺寸。
        position_popover_with_size(&window, &app, Some(requested_size));
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

            let db = Database::new(&get_db_path(app)).expect("Failed to initialize database");
            db.init_tables().expect("Failed to create tables");
            // 把老版本残留的明文 api_key 批量迁移到 Keychain 并清空
            let _ = db.migrate_legacy_api_keys();

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
            if let Err(e) = set_proxy_client(&proxy_url) {
                eprintln!("初始化 Codex 代理失败: {}", e);
            }

            // Codex 雷达缓存 state（后台线程写，popover 读）
            app.manage(commands::codex_radar::CodexRadarState(
                std::sync::Mutex::new(None),
            ));

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

            // SSH 远程自动覆盖线程：对开启自动覆盖的主机定时推送 auth.json
            let ssh_handle = app.handle().clone();
            std::thread::spawn(move || {
                run_ssh_auto_override(&ssh_handle);
            });

            // Codex 雷达刷新线程：定时拉取 codexradar.com 公开摘要缓存到 state。
            // 数据源响应慢(~10s)，故 8s 后首次拉、之后每 5 分钟一次。
            let radar_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(8));
                commands::codex_radar::refresh_once(&radar_handle);
                loop {
                    std::thread::sleep(Duration::from_secs(300));
                    commands::codex_radar::refresh_once(&radar_handle);
                }
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
            commands::agent::get_custom_models,
            commands::agent::add_custom_model,
            commands::agent::remove_custom_model,
            commands::spin::spin_now,
            commands::spin::set_spin_config,
            commands::spin::get_spin_status,
            commands::spin::spin_status_detail,
            commands::spin::get_spin_history,
            commands::alerts::get_alert_rules,
            commands::alerts::update_alert_rule,
            commands::alerts::reset_account_overrides,
            commands::alerts::set_alert_muted,
            commands::alerts::get_alert_muted,
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
            commands::codex::parse_codex_accounts_json_preview,
            commands::codex::add_codex_accounts_from_json,
            commands::sub2api::get_sub2api_config,
            commands::sub2api::set_sub2api_config,
            commands::sub2api::sub2api_test_connection,
            commands::sub2api::sub2api_deploy,
            commands::sub2api::sub2api_apply_local,
            commands::sub2api::sub2api_apply_remote,
            commands::sub2api::sub2api_status,
            commands::sub2api::sub2api_topup,
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
            commands::codex::scan_ssh_hosts,
            commands::codex::check_ssh_passwordless,
            commands::codex::ssh_push_auth,
            commands::codex::get_ssh_override_state,
            commands::codex::set_ssh_auto_override,
            commands::codex::get_ssh_auto_override,
            commands::codex::set_ssh_password,
            commands::codex::has_ssh_password,
            commands::codex::delete_ssh_password,
            commands::codex::ssh_check_claude_code,
            commands::codex::ssh_bind_claude_code,
            commands::codex::ssh_unbind_claude_code,
            commands::deepseek::add_deepseek_account,
            commands::deepseek::get_deepseek_balance,
            commands::deepseek::get_deepseek_models,
            commands::deepseek::get_deepseek_balance_history,
            commands::deepseek::validate_deepseek_api_key,
            commands::deepseek::mask_deepseek_api_key,
            commands::deepseek::get_deepseek_api_key_raw,
            commands::deepseek::update_deepseek_api_key,
            commands::codex_radar::get_codex_radar,
            commands::codex_radar::refresh_codex_radar,
            close_popover,
            start_window_drag,
            fit_window_size,
            refresh_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{parse_refresh_interval_secs, DEFAULT_REFRESH_INTERVAL_SECS};

    #[test]
    fn refresh_interval_accepts_only_one_to_thirty_minutes() {
        assert_eq!(parse_refresh_interval_secs(Some("1")), 60);
        assert_eq!(parse_refresh_interval_secs(Some("30")), 1_800);
        assert_eq!(
            parse_refresh_interval_secs(Some("0")),
            DEFAULT_REFRESH_INTERVAL_SECS
        );
        assert_eq!(
            parse_refresh_interval_secs(Some("31")),
            DEFAULT_REFRESH_INTERVAL_SECS
        );
        assert_eq!(
            parse_refresh_interval_secs(Some("invalid")),
            DEFAULT_REFRESH_INTERVAL_SECS
        );
        assert_eq!(
            parse_refresh_interval_secs(None),
            DEFAULT_REFRESH_INTERVAL_SECS
        );
    }
}
