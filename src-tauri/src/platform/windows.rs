/// Windows 平台实现
///
/// Win11 22H2+ 使用 DWM API 实现原生圆角，
/// Win10 依赖 CSS border-radius + 窗口透明背景。

use tauri::WebviewWindow;

pub fn apply_window_decoration(window: &WebviewWindow) {
    use std::ffi::c_void;

    let hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(_) => return,
    };

    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_ROUND: u32 = 2;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            dw_attribute: u32,
            pv_attribute: *const c_void,
            cb_attribute: u32,
        ) -> i32;
    }

    unsafe {
        let preference = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            hwnd.0 as *mut c_void,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const u32 as *const c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }
}

pub fn init_app(_app: &mut tauri::App) {
    // Windows 不需要 activation policy
}

/// Win32 原生窗口拖拽
pub fn start_drag(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;

    let hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(_) => return,
    };

    #[link(name = "user32")]
    extern "system" {
        fn ReleaseCapture() -> i32;
        fn SendMessageA(hwnd: *mut c_void, msg: u32, wparam: usize, lparam: isize) -> isize;
    }

    const WM_NCLBUTTONDOWN: u32 = 0x00A1;
    const HTCAPTION: usize = 2;

    unsafe {
        ReleaseCapture();
        SendMessageA(hwnd.0 as *mut c_void, WM_NCLBUTTONDOWN, HTCAPTION, 0);
    }
}

pub fn update_tray(tray: &tauri::tray::TrayIcon, percentage: i32) {
    if percentage >= 0 {
        let icon = generate_tray_icon(percentage);
        if let Some(img) = icon {
            let _ = tray.set_icon(Some(img));
        }
        let _ = tray.set_tooltip(Some(&format!("GLM Quota Monitor — {}%", percentage)));
    } else {
        let _ = tray.set_tooltip(Some("GLM Quota Monitor"));
    }
}

/// 生成带百分比文字的托盘图标（32×32 RGBA）
fn generate_tray_icon(percentage: i32) -> Option<tauri::image::Image<'static>> {
    let size: u32 = 32;
    let mut rgba = vec![0u8; (size * size * 4) as usize];

    let color = if percentage >= 85 {
        [239, 68, 68]  // 红
    } else if percentage >= 60 {
        [245, 158, 11] // 黄
    } else {
        [16, 185, 129] // 绿
    };

    // 绘制背景圆角矩形
    let margin = 2u32;
    let r = 6u32;
    for y in margin..size - margin {
        for x in margin..size - margin {
            if in_corner(x, y, margin + r, margin + r, r)
                || in_corner(x, y, size - margin - r - 1, margin + r, r)
                || in_corner(x, y, margin + r, size - margin - r - 1, r)
                || in_corner(x, y, size - margin - r - 1, size - margin - r - 1, r)
            {
                continue;
            }
            let idx = ((y * size + x) * 4) as usize;
            rgba[idx] = color[0];
            rgba[idx + 1] = color[1];
            rgba[idx + 2] = color[2];
            rgba[idx + 3] = 220;
        }
    }

    // 绘制百分比文字
    let text = format!("{}%", percentage);
    draw_text(&mut rgba, size, &text);

    Some(tauri::image::Image::new_owned(rgba, size, size))
}

fn in_corner(x: u32, y: u32, cx: u32, cy: u32, r: u32) -> bool {
    let dx = if x > cx { x - cx } else { cx - x };
    let dy = if y > cy { y - cy } else { cy - y };
    (dx * dx + dy * dy) as f64 > (r * r) as f64
}

/// 3×5 像素字体绘制
fn draw_text(rgba: &mut [u8], size: u32, text: &str) {
    const DIGITS: [&[u8]; 10] = [
        &[0b111, 0b101, 0b101, 0b101, 0b111],
        &[0b010, 0b110, 0b010, 0b010, 0b111],
        &[0b111, 0b001, 0b111, 0b100, 0b111],
        &[0b111, 0b001, 0b111, 0b001, 0b111],
        &[0b101, 0b101, 0b111, 0b001, 0b001],
        &[0b111, 0b100, 0b111, 0b001, 0b111],
        &[0b111, 0b100, 0b111, 0b101, 0b111],
        &[0b111, 0b001, 0b001, 0b001, 0b001],
        &[0b111, 0b101, 0b111, 0b101, 0b111],
        &[0b111, 0b101, 0b111, 0b001, 0b111],
    ];
    const PERCENT: &[u8; 5] = &[0b101, 0b001, 0b010, 0b100, 0b101];

    let chars: Vec<char> = text.chars().collect();
    let char_count = chars.len() as u32;
    let scale = 3u32;
    let char_w = 3 * scale;
    let spacing = 1u32;
    let total_w = char_count * char_w + (char_count - 1) * spacing;
    let start_x = (size.saturating_sub(total_w)) / 2;
    let total_h = 5 * scale;
    let start_y = (size.saturating_sub(total_h)) / 2;

    for (i, ch) in chars.iter().enumerate() {
        let pattern = if *ch == '%' {
            PERCENT
        } else if let Some(d) = ch.to_digit(10) {
            DIGITS[d as usize]
        } else {
            continue;
        };
        let offset_x = start_x + i as u32 * (char_w + spacing);

        for (row, &bits) in pattern.iter().enumerate() {
            for col in 0..3u32 {
                if bits & (1 << (2 - col)) != 0 {
                    for dy in 0..scale {
                        for dx in 0..scale {
                            let px = offset_x + col * scale + dx;
                            let py = start_y + row as u32 * scale + dy;
                            if px < size && py < size {
                                let idx = ((py * size + px) * 4) as usize;
                                rgba[idx] = 255;
                                rgba[idx + 1] = 255;
                                rgba[idx + 2] = 255;
                                rgba[idx + 3] = 255;
                            }
                        }
                    }
                }
            }
        }
    }
}
