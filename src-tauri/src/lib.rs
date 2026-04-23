mod alert;
mod api;
mod commands;
mod crypto;
mod db;
mod platform;

use api::client::ZhipuClient;
use api::types::QuotaData;
use db::Database;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::LazyLock;
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

#[derive(serde::Serialize)]
struct RefreshResult {
    max_pct: i32,
    quotas: HashMap<String, QuotaData>,
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
                let scale = window.scale_factor().unwrap_or(2.0);
                let window_w = (platform::POPOVER_WIDTH_LOGICAL * scale) as u32;
                let (x, y) = platform::popover_position(pos.x, pos.y, size.width, size.height, window_w);
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

fn refresh_all_accounts(app: &tauri::AppHandle) -> RefreshResult {
    let db = match app.try_state::<Database>() {
        Some(db) => db,
        None => return RefreshResult { max_pct: 0, quotas: HashMap::new() },
    };

    // (id, alias, api_key, is_primary)
    let accounts: Vec<(String, String, String, bool)> = {
        let Ok(guard) = db.conn.lock() else {
            return RefreshResult { max_pct: 0, quotas: HashMap::new() };
        };
        let result = guard.prepare(
            "SELECT id, alias, api_key, COALESCE(is_primary, 0) FROM accounts WHERE is_active = 1"
        );
        let Ok(mut stmt) = result else {
            return RefreshResult { max_pct: 0, quotas: HashMap::new() };
        };
        let rows = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get::<_, i32>(3)? == 1))
        });
        match rows {
            Ok(r) => r.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        }
    };

    let mut max_pct = 0i32;
    let mut primary_pct: Option<i32> = None;
    let mut quotas = HashMap::new();

    for (account_id, account_alias, db_key, is_primary) in &accounts {
        let api_key = match resolve_api_key_for_refresh(&db, account_id, db_key) {
            Some(k) => k,
            None => continue,
        };

        let client = ZhipuClient::with_client(&HTTP_CLIENT, &api_key);
        let result = tauri::async_runtime::block_on(client.get_quota_limit());

        match result {
            Ok(mut quota) => {
                let pct = quota.limits.iter()
                    .find(|l| l.limit_type == "TOKENS_LIMIT")
                    .map(|l| l.percentage as i32)
                    .unwrap_or(0);
                if pct > max_pct {
                    max_pct = pct;
                }
                if *is_primary {
                    primary_pct = Some(pct);
                }

                if let Ok(conn2) = db.conn.lock() {
                    let _ = db::record_quota_snapshot(&conn2, account_id, &quota);

                    // 快照对比检测活跃：当前 token_pct > 上一次 → 有使用
                    let current_pct = quota.limits.iter()
                        .find(|l| l.limit_type == "TOKENS_LIMIT")
                        .map(|l| l.percentage)
                        .unwrap_or(0.0);
                    let prev_pct: f64 = conn2.query_row(
                        "SELECT token_limit_pct FROM usage_snapshots \
                         WHERE account_id = ?1 AND token_limit_pct IS NOT NULL \
                         ORDER BY timestamp DESC LIMIT 1 OFFSET 1",
                        rusqlite::params![account_id],
                        |row| row.get::<_, Option<f64>>(0),
                    ).ok().flatten().unwrap_or(-1.0);

                    if current_pct > prev_pct {
                        let now_str = chrono::Utc::now().to_rfc3339();
                        let key = format!("last_active_{}", account_id);
                        let _ = conn2.execute(
                            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
                            rusqlite::params![key, now_str],
                        );
                    }

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
                alert::check_and_notify(
                    &db,
                    &aid,
                    &alias,
                    &quota_clone,
                    &|msg: &str| {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = app_clone
                            .notification()
                            .builder()
                            .title("GLM Quota Monitor")
                            .body(msg.to_string())
                            .show();
                    },
                );
            }
            Err(e) => {
                eprintln!("Failed to refresh account {}: {}", account_id, e);
            }
        }
    }

    let display_pct = primary_pct.unwrap_or(max_pct);
    RefreshResult { max_pct: display_pct, quotas }
}

fn update_tray_display(app: &tauri::AppHandle, percentage: i32) {
    platform::update_tray(app, percentage);
}

fn do_refresh(app: &tauri::AppHandle) {
    let result = refresh_all_accounts(app);
    MAX_PERCENTAGE.store(result.max_pct, Ordering::SeqCst);
    update_tray_display(app, result.max_pct);
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
        let scale = window.scale_factor().unwrap_or(2.0);
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
    update_tray_display(&app, result.max_pct);
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

            app.manage(db);

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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::account::add_account,
            commands::account::list_accounts,
            commands::account::delete_account,
            commands::account::update_account_alias,
            commands::account::set_primary_account,
            commands::agent::bind_agent,
            commands::agent::get_agent_bindings,
            commands::agent::unbind_agent,
            commands::agent::fetch_models,
            commands::agent::get_default_model,
            commands::agent::set_default_model,
            commands::spin::spin_now,
            commands::spin::set_spin_config,
            commands::spin::get_spin_status,
            commands::alerts::get_alert_rules,
            commands::alerts::update_alert_rule,
            commands::quota::get_quota,
            commands::history::get_snapshots,
            commands::summary::get_usage_summary,
            commands::settings::get_setting,
            commands::settings::set_setting,
            close_popover,
            start_window_drag,
            fit_window_size,
            refresh_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
