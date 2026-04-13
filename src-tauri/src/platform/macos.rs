use objc::{class, msg_send, sel, sel_impl};
use objc::runtime::{Object, YES, NO};

pub fn apply_rounded_corners(window: &tauri::WebviewWindow, radius: f64) {
    let ns_window: *mut Object = match window.ns_window() {
        Ok(handle) => handle as *mut Object,
        Err(_) => return,
    };
    unsafe {
        // 窗口透明，避免方角背景露出
        let _: () = msg_send![ns_window, setOpaque: NO];
        let bg_color: *mut Object = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: bg_color];

        // content view 圆角裁剪
        let content_view: *mut Object = msg_send![ns_window, contentView];
        let _: () = msg_send![content_view, setWantsLayer: YES];
        let layer: *mut Object = msg_send![content_view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: radius];
            let _: () = msg_send![layer, setMasksToBounds: YES];
        }
        let _: () = msg_send![ns_window, setHasShadow: YES];
    }
}
