use objc::runtime::{Object, NO, YES};
use objc::{class, msg_send, sel, sel_impl};
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
/// primary_items: 所有收藏账号的平台+百分比；为空则只显示模型类型
/// radar_model: 雷达完整模型名（None=未就绪），title 仅取「类型」部分（codename+effort）
/// radar_prob: 24h 重置概率，决定彩色圆点 icon 的颜色
pub fn update_tray(
    tray: &tauri::tray::TrayIcon,
    primary_items: &[crate::PrimaryDisplay],
    radar_model: Option<&str>,
    radar_prob: Option<f64>,
) {
    let pct = if primary_items.is_empty() {
        String::new()
    } else {
        super::format_tray_items(primary_items)
    };

    // 有效雷达模型（非空非「?」）-> 类型（如 "Sol max"，去掉版本前缀 GPT-5.6）
    let radar_ok = radar_model
        .map(|m| !m.is_empty() && m != "?")
        .unwrap_or(false);
    let mtype = if radar_ok {
        Some(model_type(radar_model.unwrap()))
    } else {
        None
    };
    // 彩色圆点 emoji：颜色=24h 重置概率（仅雷达就绪时显示，放在 title 末尾=Codex 额度之后）
    let dot = if radar_ok {
        Some(prob_emoji(radar_prob.unwrap_or(0.0)))
    } else {
        None
    };

    // title：「百分比 模型类型 彩色圆点」——emoji 在 macOS title 中彩色渲染
    let mut parts: Vec<String> = Vec::new();
    if !pct.is_empty() {
        parts.push(pct.clone());
    }
    if let Some(mt) = &mtype {
        parts.push(mt.clone());
    }
    if let Some(d) = dot {
        parts.push(d.to_string());
    }
    let title = parts.join(" ");
    let _ = tray.set_title(if title.is_empty() {
        None
    } else {
        Some(title.as_str())
    });

    // 图标恢复为应用原 logo（彩色指示改为 title 内的圆点 emoji，不再替代软件图标）
    let app = tray.app_handle();
    let _ = tray.set_icon(app.default_window_icon().cloned());

    // tooltip：完整模型名 + 百分比 + 数据来源（鼠标悬停看详情）
    let tip = match radar_model.filter(|m| !m.is_empty() && *m != "?") {
        Some(m) if !pct.is_empty() => format!("{} | {} | 数据来自 codexradar.com", m, pct),
        Some(m) => format!("{} | 数据来自 codexradar.com", m),
        None if !pct.is_empty() => pct.clone(),
        None => "GLM Quota Monitor".to_string(),
    };
    let _ = tray.set_tooltip(Some(tip.as_str()));
}

/// 提取模型「类型」：去掉版本前缀，保留 codename + effort。
/// "GPT-5.6 Sol max" -> "Sol max"；"GPT-5.5 xhigh" -> "xhigh"；"o3" -> "o3"
fn model_type(full: &str) -> String {
    let parts: Vec<&str> = full.split_whitespace().collect();
    if parts.len() <= 1 {
        return full.to_string();
    }
    parts[1..].join(" ")
}

/// 24h 重置概率 -> 彩色圆点 emoji（macOS title 中彩色渲染，色阶与前端 radarProbColor 对齐）
/// 必须用 emoji block 的彩色圆（U+1F7E2 等，默认 emoji presentation），
/// 不能用 ⚪/⚫（U+26AA/26AB，默认 text presentation 会渲染成细线圆圈看不见）。
/// menu bar 空间小，合为 3 档；\u{FE0F} 强制 emoji presentation 保险。
fn prob_emoji(p: f64) -> &'static str {
    if p >= 0.50 {
        "🟢\u{FE0F}" // 绿：重置概率较高（额度刷新利好）
    } else if p >= 0.15 {
        "🟡\u{FE0F}" // 黄：中等
    } else {
        "🔵\u{FE0F}" // 蓝：偏低/稳定
    }
}
