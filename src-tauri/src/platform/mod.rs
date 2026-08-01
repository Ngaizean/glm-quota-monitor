#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

use tauri::WebviewWindow;

pub const POPOVER_WIDTH_LOGICAL: f64 = 360.0;

/// 应用平台特定的窗口装饰（圆角、透明等）
pub fn apply_window_decoration(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::apply_window_decoration(window);
    #[cfg(target_os = "windows")]
    windows::apply_window_decoration(window);
}

/// 根据托盘位置计算弹出窗口坐标 (x, y)
/// window_h: 当前 Popover 实际高度（像素）
pub fn popover_position(
    tray_x: i32,
    tray_y: i32,
    tray_w: u32,
    tray_h: u32,
    window_w: u32,
    window_h: u32,
) -> (i32, i32) {
    let x = tray_x + (tray_w as i32 - window_w as i32) / 2;
    #[cfg(target_os = "macos")]
    {
        let _ = window_h;
        (x, tray_y + tray_h as i32 + 4)
    }
    #[cfg(target_os = "windows")]
    {
        let _ = tray_h;
        (x, tray_y - window_h as i32 - 4)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window_h;
        (x, tray_y + tray_h as i32 + 4)
    }
}

/// 初始化平台特定的应用行为
pub fn init_app(app: &mut tauri::App) {
    #[cfg(target_os = "macos")]
    macos::init_app(app);
    #[cfg(target_os = "windows")]
    windows::init_app(app);
}

/// 更新托盘显示（macOS 用文字，Windows 用图标）
/// primary_items: 所有收藏账号的平台+百分比；为空则只显示图标
/// radar_model: 雷达最佳模型名（None=未就绪/拉取失败）；macOS 追加到 title 前部，tooltip 拼接
pub fn update_tray(
    app: &tauri::AppHandle,
    primary_items: &[crate::PrimaryDisplay],
    radar_model: Option<&str>,
    radar_prob: Option<f64>,
) {
    if let Some(tray) = app.tray_by_id("main") {
        #[cfg(target_os = "macos")]
        macos::update_tray(&tray, primary_items, radar_model, radar_prob);
        #[cfg(target_os = "windows")]
        windows::update_tray(&tray, primary_items, radar_model, radar_prob);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let pct = if primary_items.is_empty() {
                String::new()
            } else {
                format_tray_items(primary_items)
            };
            let s = match radar_model.filter(|m| !m.is_empty() && *m != "?") {
                Some(m) if !pct.is_empty() => format!("GLM Quota Monitor — {} | {}", pct, m),
                Some(m) => format!("GLM Quota Monitor — {}", m),
                None if !pct.is_empty() => format!("GLM Quota Monitor — {}", pct),
                None => "GLM Quota Monitor".to_string(),
            };
            let _ = tray.set_tooltip(Some(&s));
        }
    }
}

/// 格式化状态栏文本：G42% C0% D10（G=GLM，C=Codex，D=DeepSeek）
///
/// DeepSeek 是绝对货币余额，显 `D{balance}`（无 %，四舍五入到整数）；
/// GLM/Codex 仍 `{prefix}{pct}%`。currency 不进托盘（空间有限），仅显数值。
pub fn format_tray_items(items: &[crate::PrimaryDisplay]) -> String {
    items
        .iter()
        .map(|i| match i.platform.as_str() {
            "codex" => format!("C{}%", i.pct),
            "deepseek" => format!("D{:.0}", i.balance.unwrap_or(0.0)),
            _ => format!("G{}%", i.pct),
        })
        .collect::<Vec<_>>()
        .join(" ")
}
