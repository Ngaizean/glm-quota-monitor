use objc::{class, msg_send, sel, sel_impl};
use objc::runtime::{Object, YES, NO};
use tauri::WebviewWindow;

pub fn apply_window_decoration(window: &WebviewWindow) {
    let ns_window: *mut Object = match window.ns_window() {
        Ok(handle) => handle as *mut Object,
        Err(_) => return,
    };
    unsafe {
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
    }
}

pub fn init_app(app: &mut tauri::App) {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

pub fn update_tray(tray: &tauri::tray::TrayIcon, percentage: i32) {
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
