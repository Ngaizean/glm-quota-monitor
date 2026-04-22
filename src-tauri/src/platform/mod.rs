#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

use tauri::WebviewWindow;

#[cfg(target_os = "windows")]
const POPOVER_HEIGHT: i32 = 480;

pub const POPOVER_WIDTH_LOGICAL: f64 = 360.0;

/// 应用平台特定的窗口装饰（圆角、透明等）
pub fn apply_window_decoration(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::apply_window_decoration(window);
    #[cfg(target_os = "windows")]
    windows::apply_window_decoration(window);
}

/// 根据托盘位置计算弹出窗口坐标 (x, y)
pub fn popover_position(
    tray_x: i32,
    tray_y: i32,
    tray_w: u32,
    tray_h: u32,
    window_w: u32,
) -> (i32, i32) {
    let x = tray_x + (tray_w as i32 - window_w as i32) / 2;
    #[cfg(target_os = "macos")]
    {
        (x, tray_y + tray_h as i32 + 4)
    }
    #[cfg(target_os = "windows")]
    {
        (x, tray_y - POPOVER_HEIGHT - 4)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        (x, tray_y + tray_h as i32 + 4)
    }
}

/// 初始化平台特定的应用行为
pub fn init_app(app: &mut tauri::App) {
    #[cfg(target_os = "macos")]
    macos::init_app(app);
}

/// 更新托盘显示（macOS 用文字，Windows 用图标）
pub fn update_tray(app: &tauri::AppHandle, percentage: i32) {
    if let Some(tray) = app.tray_by_id("main") {
        #[cfg(target_os = "macos")]
        macos::update_tray(&tray, percentage);
        #[cfg(target_os = "windows")]
        windows::update_tray(&tray, percentage);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = tray.set_tooltip(Some(&format!("GLM Quota Monitor — {}%", percentage)));
        }
    }
}
