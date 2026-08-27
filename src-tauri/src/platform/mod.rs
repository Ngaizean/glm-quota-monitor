#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

use tauri::WebviewWindow;

pub const POPOVER_WIDTH_LOGICAL: f64 = 420.0;

/// 显示器可用工作区的物理像素矩形。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WorkArea {
    pub const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

fn clamp_axis(value: i32, area_start: i32, area_size: u32, window_size: u32) -> i32 {
    let lower = i64::from(area_start);
    let upper = (lower + i64::from(area_size) - i64::from(window_size)).max(lower);
    i64::from(value)
        .clamp(lower, upper)
        .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

/// 将窗口坐标限制在目标显示器的 work area 内。
/// 窗口比 work area 更大时固定在左上角，避免负向上限导致 panic。
pub fn clamp_position_to_work_area(
    x: i32,
    y: i32,
    window_w: u32,
    window_h: u32,
    work_area: WorkArea,
) -> (i32, i32) {
    (
        clamp_axis(x, work_area.x, work_area.width, window_w),
        clamp_axis(y, work_area.y, work_area.height, window_h),
    )
}

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
    work_area: Option<WorkArea>,
) -> (i32, i32) {
    let x = tray_x + (tray_w as i32 - window_w as i32) / 2;
    let position = {
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
    };

    work_area.map_or(position, |area| {
        clamp_position_to_work_area(position.0, position.1, window_w, window_h, area)
    })
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

/// 格式化状态栏文本：G42% C0% C480 D10（G=GLM，C=Codex，D=DeepSeek）
///
/// DeepSeek 是绝对货币余额，显 `D{balance}`（无 %，四舍五入到整数）；
/// Codex 官方登录显 `C{pct}%`，中转站（钱包余额）显 `C{balance}`；
/// GLM 仍 `G{pct}%`。currency 不进托盘（空间有限），仅显数值。
pub fn format_tray_items(items: &[crate::PrimaryDisplay]) -> String {
    items
        .iter()
        .map(|i| match i.platform.as_str() {
            "codex" => match i.balance {
                Some(balance) => format!("C{balance:.0}"),
                None => format!("C{}%", i.pct),
            },
            "deepseek" => format!("D{:.0}", i.balance.unwrap_or(0.0)),
            _ => format!("G{}%", i.pct),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::{clamp_position_to_work_area, format_tray_items, WorkArea};

    #[test]
    fn formats_codex_official_and_relay_distinctly() {
        let items = vec![
            crate::PrimaryDisplay {
                platform: "zhipu".to_string(),
                pct: 42,
                balance: None,
            },
            crate::PrimaryDisplay {
                platform: "codex".to_string(),
                pct: 0,
                balance: Some(480.0),
            },
            crate::PrimaryDisplay {
                platform: "codex".to_string(),
                pct: 12,
                balance: None,
            },
        ];
        // 中转站（余额）无 %，官方登录（百分比）带 %
        assert_eq!(format_tray_items(&items), "G42% C480 C12%");
    }

    #[test]
    fn clamps_420_window_at_left_and_top_edges() {
        let work_area = WorkArea::new(0, 24, 1_440, 876);

        assert_eq!(
            clamp_position_to_work_area(-205, 5, 420, 600, work_area),
            (0, 24)
        );
    }

    #[test]
    fn clamps_760_window_at_right_and_bottom_edges() {
        let work_area = WorkArea::new(0, 24, 1_440, 876);

        assert_eq!(
            clamp_position_to_work_area(1_380, 700, 760, 500, work_area),
            (680, 400)
        );
    }

    #[test]
    fn respects_negative_coordinates_on_secondary_monitor() {
        let work_area = WorkArea::new(-1_920, -200, 1_920, 1_080);

        assert_eq!(
            clamp_position_to_work_area(-2_100, -250, 760, 900, work_area),
            (-1_920, -200)
        );
        assert_eq!(
            clamp_position_to_work_area(-200, 100, 760, 900, work_area),
            (-760, -20)
        );
    }

    #[test]
    fn anchors_oversized_window_to_work_area_origin() {
        let work_area = WorkArea::new(1_920, 0, 600, 480);

        assert_eq!(
            clamp_position_to_work_area(2_200, 200, 760, 600, work_area),
            (1_920, 0)
        );
    }
}
