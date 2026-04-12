use objc::{msg_send, sel, sel_impl};
use objc::runtime::{BOOL, Object, YES, NO};

pub fn apply_rounded_corners(window: &tauri::WebviewWindow, radius: f64) {
    let ns_window: *mut Object = match window.ns_window() {
        Ok(handle) => handle as *mut Object,
        Err(_) => return,
    };
    unsafe {
        let _: () = msg_send![ns_window, setOpaque: NO];
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
