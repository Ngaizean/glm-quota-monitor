/// Windows 平台：应用窗口圆角
///
/// Win11 22H2+ 使用 DWM API 实现原生圆角，
/// Win10 及更早版本依赖 CSS border-radius + 窗口透明背景（由 .transparent(true) 启用）。
pub fn apply_rounded_corners(window: &tauri::WebviewWindow, _radius: f64) {
    use std::ffi::c_void;

    let hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(_) => return,
    };

    // DWMWA_WINDOW_CORNER_PREFERENCE = 33 (Win11 22H2+)
    // DWMWCP_ROUND = 2
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
        // Win11 上设置成功，Win10 上此属性不存在但返回错误不影响运行
        // Win10 回退到 CSS border-radius
    }
}

/// 生成带百分比文字的托盘图标
///
/// 在 32×32 透明背景上绘制百分比文字，颜色随额度变化：
/// - <60%: 绿色 (#10B981)
/// - 60-85%: 黄色 (#F59E0B)
/// - >85%: 红色 (#EF4444)
pub fn generate_tray_icon(percentage: i32) -> Option<tauri::image::Image<'static>> {
    use image::{ImageBuffer, Rgba};

    let size = 32u32;
    let mut img = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(size, size, Rgba([0, 0, 0, 0]));

    // 根据百分比选择颜色
    let color = if percentage >= 85 {
        [239, 68, 68, 255]  // 红 #EF4444
    } else if percentage >= 60 {
        [245, 158, 11, 255] // 黄 #F59E0B
    } else {
        [16, 185, 129, 255] // 绿 #10B981
    };

    // 绘制背景圆角矩形
    let margin = 2u32;
    let r = 6u32; // 圆角半径
    for y in margin..size - margin {
        for x in margin..size - margin {
            // 简单的圆角检测
            let in_corner = |cx: u32, cy: u32| -> bool {
                let dx = if x > cx { x - cx } else { cx - x };
                let dy = if y > cy { y - cy } else { cy - y };
                (dx * dx + dy * dy) as f64 > (r * r) as f64
            };
            if in_corner(margin + r, margin + r)
                || in_corner(size - margin - r - 1, margin + r)
                || in_corner(margin + r, size - margin - r - 1)
                || in_corner(size - margin - r - 1, size - margin - r - 1)
            {
                continue;
            }
            let pixel = img.get_pixel_mut(x, y);
            *pixel = Rgba([color[0], color[1], color[2], 220]);
        }
    }

    // 绘制百分比文字（简单位图方式）
    // 由于 image crate 不支持文字渲染，使用预定义的数字图案
    let text = format!("{}%", percentage);
    draw_text(&mut img, &text, color);

    // 转换为 Tauri Image
    let rgba_data = img.into_raw();
    Some(tauri::image::Image::new_owned(rgba_data, size, size))
}

/// 简易数字绘制（3×5 像素字体）
fn draw_text(img: &mut image::ImageBuffer<image::Rgba<u8>, Vec<u8>>, text: &str, _fg: [u8; 4]) {
    use image::Rgba;

    // 3×5 像素数字定义 (行优先)
    const DIGITS: [&[u8]; 10] = [
        &[0b111, 0b101, 0b101, 0b101, 0b111], // 0
        &[0b010, 0b110, 0b010, 0b010, 0b111], // 1
        &[0b111, 0b001, 0b111, 0b100, 0b111], // 2
        &[0b111, 0b001, 0b111, 0b001, 0b111], // 3
        &[0b101, 0b101, 0b111, 0b001, 0b001], // 4
        &[0b111, 0b100, 0b111, 0b001, 0b111], // 5
        &[0b111, 0b100, 0b111, 0b101, 0b111], // 6
        &[0b111, 0b001, 0b001, 0b001, 0b001], // 7
        &[0b111, 0b101, 0b111, 0b101, 0b111], // 8
        &[0b111, 0b101, 0b111, 0b001, 0b111], // 9
    ];
    const PERCENT: &[u8; 5] = &[0b101, 0b001, 0b010, 0b100, 0b101]; // %

    let chars: Vec<char> = text.chars().collect();
    let char_count = chars.len() as u32;
    let scale = 3u32; // 每个像素放大倍数
    let char_w = 3 * scale;
    let spacing = 1u32;
    let total_w = char_count * char_w + (char_count - 1) * spacing;
    let start_x = (32 - total_w) / 2;
    let total_h = 5 * scale;
    let start_y = (32 - total_h) / 2;

    let white = Rgba([255, 255, 255, 255]);

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
                    // 绘制 scale×scale 的像素块
                    for dy in 0..scale {
                        for dx in 0..scale {
                            let px = offset_x + col * scale + dx;
                            let py = start_y + row as u32 * scale + dy;
                            if px < 32 && py < 32 {
                                img.put_pixel(px, py, white);
                            }
                        }
                    }
                }
            }
        }
    }
}
