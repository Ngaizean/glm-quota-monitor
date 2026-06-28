use objc::{class, msg_send, sel, sel_impl};
use objc::runtime::{Object, YES, NO};
use tauri::WebviewWindow;

/// NSStatusWindowLevel = 25，浮在 Spotlight 和其他 floating 窗口之上
const NS_STATUS_WINDOW_LEVEL: i64 = 25;

pub fn apply_window_decoration(window: &WebviewWindow) {
    let ns_window: *mut Object = match window.ns_window() {
        Ok(handle) => handle as *mut Object,
        Err(_) => return,
    };
    unsafe {
        // 透明背景 + 圆角
        let _: () = msg_send![ns_window, setOpaque: NO];
        let bg_color: *mut Object = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: bg_color];

        let content_view: *mut Object = msg_send![ns_window, contentView];
        let _: () = msg_send![content_view, setWantsLayer: YES];
        let layer: *mut Object = msg_send![content_view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: 12.0];
            let _: () = msg_send![layer, setMasksToBounds: YES];
        }
        let _: () = msg_send![ns_window, setHasShadow: YES];

        // 提升窗口层级到 NSStatusWindowLevel，确保 popover 浮在 Spotlight 等之上
        let _: () = msg_send![ns_window, setLevel: NS_STATUS_WINDOW_LEVEL];
    }
}

pub fn init_app(app: &mut tauri::App) {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// 更新托盘显示
/// primary_items: 所有收藏账号的平台+百分比；为空则只显示图标（无文字）
pub fn update_tray(tray: &tauri::tray::TrayIcon, primary_items: &[crate::PrimaryDisplay]) {
    if primary_items.is_empty() {
        let _ = tray.set_title(Some(""));
        let _ = tray.set_tooltip(Some("GLM Quota Monitor"));
    } else {
        let title = super::format_tray_items(primary_items);
        let _ = tray.set_title(Some(title.as_str()));
        let _ = tray.set_tooltip(Some(title.as_str()));
    }
}
