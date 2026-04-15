mod alert;
mod api;
mod commands;
mod crypto;
mod db;
mod platform;

use api::client::ZhipuClient;
use db::Database;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Duration;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder},
    webview::WebviewWindowBuilder,
    Manager,
};

const POPOVER_LABEL: &str = "popover";
const DEFAULT_REFRESH_INTERVAL_SECS: u64 = 300;

/// 全局最高额度百分比，用于图标显示
static MAX_PERCENTAGE: AtomicI32 = AtomicI32::new(-1);

fn get_db_path(app: &tauri::App) -> PathBuf {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to resolve app data dir");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("glm_quota_monitor.db")
}

// ========== 窗口管理 ==========

fn toggle_popover(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(POPOVER_LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            // 每次显示前重新定位，跟随托盘图标当前位置
            if let Some(tray) = app.tray_by_id("main") {
                if let Ok(Some(rect)) = tray.rect() {
                    if let (tauri::Position::Physical(pos), tauri::Size::Physical(size)) =
                        (rect.position, rect.size)
                    {
                        let x = pos.x + (size.width as i32 - 360) / 2;
                        let y = pos.y + size.height as i32 + 4;
                        let _ = window.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition::new(x, y),
                        ));
                    }
                }
            }
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
            .inner_size(360.0, 480.0)
            .decorations(false)
            .transparent(true)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .build()
            .expect("Failed to create popover window");

    #[cfg(target_os = "macos")]
    platform::macos::apply_rounded_corners(&window, 12.0);
    #[cfg(target_os = "windows")]
    platform::windows::apply_rounded_corners(&window, 12.0);

    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(Some(rect)) = tray.rect() {
            if let (tauri::Position::Physical(pos), tauri::Size::Physical(size)) =
                (rect.position, rect.size)
            {
                let x = pos.x + (size.width as i32 - 360) / 2;
                let y = pos.y + size.height as i32 + 4;
                let _ = window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x, y),
                ));
            }
        }
    }
}

// ========== 后台刷新 ==========

/// 从数据库读取刷新间隔设置（分钟 → 秒）
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

/// 从 Keychain 或数据库获取 API Key（兼容旧数据迁移）
fn resolve_api_key(account_id: &str, db_key: &str) -> Option<String> {
    // 优先从 Keychain 读取
    if let Ok(key) = crypto::get_api_key(account_id) {
        return Some(key);
    }
    // 降级：数据库明文（旧数据）
    if !db_key.is_empty() {
        // 迁移到 Keychain
        let _ = crypto::store_api_key(account_id, db_key);
        return Some(db_key.to_string());
    }
    None
}

/// 刷新所有账号额度，返回最高百分比
fn refresh_all_accounts(app: &tauri::AppHandle) -> i32 {
    let db = match app.try_state::<Database>() {
        Some(db) => db,
        None => return 0,
    };

    let accounts: Vec<(String, String, String)> = {
        let Ok(guard) = db.conn.lock() else { return 0 };
        let result = guard.prepare("SELECT id, alias, api_key FROM accounts WHERE is_active = 1");
        let Ok(mut stmt) = result else { return 0 };
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)));
        match rows {
            Ok(r) => r.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        }
    };

    let mut max_pct = 0i32;
    let http_client = reqwest::Client::new();

    for (account_id, account_alias, db_key) in &accounts {
        let api_key = match resolve_api_key(account_id, db_key) {
            Some(k) => k,
            None => continue,
        };

        let client = ZhipuClient::with_client(&http_client, &api_key);
        let result = tauri::async_runtime::block_on(client.get_quota_limit());

        match result {
            Ok(quota) => {
                let pct = quota.limits.iter()
                    .find(|l| l.limit_type == "TOKENS_LIMIT")
                    .map(|l| l.percentage as i32)
                    .unwrap_or(0);
                if pct > max_pct {
                    max_pct = pct;
                }

                if let Ok(conn2) = db.conn.lock() {
                    let _ = db::record_quota_snapshot(&conn2, account_id, &quota);
                }

                // 预警检查
                let app_clone = app.clone();
                let aid = account_id.clone();
                let alias = account_alias.clone();
                let quota_clone = quota.clone();
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

    max_pct
}

fn update_tray_display(app: &tauri::AppHandle, percentage: i32) {
    if let Some(tray) = app.tray_by_id("main") {
        if percentage >= 0 {
            let tooltip = format!("GLM Quota Monitor — {}%", percentage);
            let _ = tray.set_tooltip(Some(tooltip.as_str()));
            #[cfg(target_os = "macos")]
            {
                let title = format!("{}%", percentage);
                let _ = tray.set_title(Some(title.as_str()));
            }
            #[cfg(target_os = "windows")]
            {
                if let Some(icon) = platform::windows::generate_tray_icon(percentage) {
                    let _ = tray.set_icon(Some(icon));
                }
            }
        } else {
            let _ = tray.set_tooltip(Some("GLM Quota Monitor"));
            #[cfg(target_os = "macos")]
            {
                let _ = tray.set_title(Some(""));
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
fn refresh_all(app: tauri::AppHandle) -> Result<i32, String> {
    let max_pct = refresh_all_accounts(&app);
    MAX_PERCENTAGE.store(max_pct, Ordering::SeqCst);
    update_tray_display(&app, max_pct);
    Ok(max_pct)
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
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let db = Database::new(&get_db_path(app))
                .expect("Failed to initialize database");
            db.init_tables().expect("Failed to create tables");

            {
                let conn = db.conn.lock().unwrap();
                alert::rules::init_default_rules(&conn);
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
                        let max_pct = refresh_all_accounts(app);
                        MAX_PERCENTAGE.store(max_pct, Ordering::SeqCst);
                        update_tray_display(app, max_pct);
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

            // 后台定时刷新
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                // 首次延迟 5 秒
                std::thread::sleep(Duration::from_secs(5));
                let max_pct = refresh_all_accounts(&app_handle);
                MAX_PERCENTAGE.store(max_pct, Ordering::SeqCst);
                update_tray_display(&app_handle, max_pct);

                loop {
                    // 每次循环读取最新的刷新间隔设置
                    let interval = if let Some(db) = app_handle.try_state::<Database>() {
                        get_refresh_interval(&db)
                    } else {
                        DEFAULT_REFRESH_INTERVAL_SECS
                    };
                    std::thread::sleep(Duration::from_secs(interval));

                    let max_pct = refresh_all_accounts(&app_handle);
                    MAX_PERCENTAGE.store(max_pct, Ordering::SeqCst);
                    update_tray_display(&app_handle, max_pct);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::account::add_account,
            commands::account::list_accounts,
            commands::account::delete_account,
            commands::account::update_account_alias,
            commands::quota::get_quota,
            commands::history::get_snapshots,
            commands::summary::get_usage_summary,
            commands::settings::get_setting,
            commands::settings::set_setting,
            close_popover,
            refresh_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
