mod alert;
mod api;
mod commands;
mod db;
mod platform;

use api::client::ZhipuClient;
use db::Database;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Duration;
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder},
    webview::WebviewWindowBuilder,
    Manager,
};

const POPOVER_LABEL: &str = "popover";
const REFRESH_INTERVAL_SECS: u64 = 300; // 5 分钟

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
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .build()
            .expect("Failed to create popover window");

    // macOS 圆角窗口（通过 CALayer 实现）
    #[cfg(target_os = "macos")]
    platform::macos::apply_rounded_corners(&window, 14.0);

    // 定位到托盘图标正下方
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(Some(rect)) = tray.rect() {
            if let (tauri::Position::Physical(pos), tauri::Size::Physical(size)) =
                (rect.position, rect.size)
            {
                let x = pos.x + size.width as i32 - 360;
                let y = pos.y + size.height as i32 + 4;
                let _ = window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x, y),
                ));
            }
        }
    }
}

// ========== 后台刷新 ==========

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

    for (account_id, account_alias, api_key) in &accounts {
        if api_key.is_empty() {
            continue;
        }

        let client = ZhipuClient::new(&api_key);
        let Ok(rt) = tokio::runtime::Runtime::new() else { continue };
        let result = rt.block_on(async { client.get_quota_limit().await });

        match result {
            Ok(quota) => {
                let pct = quota.limits.iter().map(|l| l.percentage).max().unwrap_or(0);
                if pct > max_pct {
                    max_pct = pct;
                }

                if let Ok(conn2) = db.conn.lock() {
                    let now = chrono::Utc::now().to_rfc3339();
                    let time_limit = quota.limits.iter().find(|l| l.limit_type == "TIME_LIMIT");
                    let token_limit = quota.limits.iter().find(|l| l.limit_type == "TOKENS_LIMIT");

                    let _ = conn2.execute(
                        "INSERT INTO usage_snapshots (account_id, timestamp, time_limit_pct, time_limit_reset, token_limit_pct, token_limit_reset)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![
                            account_id,
                            now,
                            time_limit.map(|l| l.percentage as f64),
                            time_limit.map(|l| l.next_reset_time),
                            token_limit.map(|l| l.percentage as f64),
                            token_limit.map(|l| l.next_reset_time),
                        ],
                    );

                    let _ = conn2.execute(
                        "UPDATE accounts SET level = ?1 WHERE id = ?2",
                        rusqlite::params![quota.level, account_id],
                    );
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

/// 更新托盘：tooltip + 标题显示百分比
fn update_tray_display(app: &tauri::AppHandle, percentage: i32) {
    if let Some(tray) = app.tray_by_id("main") {
        if percentage >= 0 {
            let title = format!("{}%", percentage);
            let tooltip = format!("GLM Quota Monitor — {}%", percentage);
            let _ = tray.set_title(Some(title.as_str()));
            let _ = tray.set_tooltip(Some(tooltip.as_str()));
        } else {
            let _ = tray.set_title(Some(""));
            let _ = tray.set_tooltip(Some("GLM Quota Monitor"));
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
            // macOS: 隐藏 Dock 图标和菜单栏标签
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // 初始化数据库
            let db = Database::new(&get_db_path(app))
                .expect("Failed to initialize database");
            db.init_tables().expect("Failed to create tables");

            // 初始化默认预警规则
            {
                let conn = db.conn.lock().unwrap();
                alert::rules::init_default_rules(&conn);
            }

            app.manage(db);

            // 系统托盘 — 只响应左键点击
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("GLM Quota Monitor")
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

            // 启动后台定时刷新
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(5));
                let max_pct = refresh_all_accounts(&app_handle);
                MAX_PERCENTAGE.store(max_pct, Ordering::SeqCst);
                update_tray_display(&app_handle, max_pct);

                loop {
                    std::thread::sleep(Duration::from_secs(REFRESH_INTERVAL_SECS));
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
