# Windows 平台适配工作记录

**分支**: `feature/windows-support`
**日期**: 2026-04-15
**状态**: 已发布 v2.3.0，PR #1 等待合并

---

## 目标

将 GLM Quota Monitor（macOS 桌面应用）适配到 Windows 平台，实现功能对等。

---

## 提交记录

| # | Commit | 说明 |
|---|--------|------|
| 1 | `1dac554` | Phase 0-1: 编译修复 + 平台条件编译适配 |
| 2 | `56bd545` | Phase 2-3: 构建配置、命名中性化、暗色模式 |
| 3 | `8bc4390` | Popover 拖拽支持 + 定位修复 |
| 4 | `451d43e` | Win32 原生拖拽 + 窗口边框修复 + 关闭按钮 |

---

## 各阶段详细工作

### Phase 0-1: 编译修复 + 平台适配 (`1dac554`)

**问题**: 项目原仅支持 macOS，大量代码使用 `#[cfg(target_os = "macos")]` 条件编译，Windows 编译失败。

**主要工作**:
- 修复 Rust 编译错误：补充 Windows 平台的条件编译分支
- 适配 `platform` 模块，新增 `platform/windows.rs`
- 实现 Windows 版 `apply_rounded_corners()` — Win11 使用 DWM API (`DwmSetWindowAttribute`)，Win10 回退到 CSS border-radius
- 实现 Windows 版 `generate_tray_icon()` — 32×32 像素位图方式绘制百分比文字（macOS 使用 tray title，Windows 不支持）

**关键文件**:
- `src-tauri/src/platform/windows.rs` — 新增
- `src-tauri/src/lib.rs` — 条件编译分支
- `src-tauri/Cargo.toml` — 添加 `windows` 平台依赖（`windows-sys`, `image` 等）

### Phase 2-3: 构建配置 + 命名中性化 + 暗色模式 (`56bd545`)

**主要工作**:
- `tauri.conf.json` 配置 Windows 构建参数（NSIS/MSI 安装包）
- 应用名称、菜单项命名中性化（去 macOS 专属术语）
- CSS 暗色模式适配 Windows 系统
- 托盘菜单文字统一

### Phase 3: Popover 拖拽 + 定位 (`8bc4390`)

**问题**: Windows 上 Popover 窗口无法拖拽，定位方向与 macOS 相反（macOS 菜单栏在顶部，Windows 任务栏在底部）。

**主要工作**:
- `position_popover()` 添加平台分支：Windows 窗口显示在托盘图标正上方
- Fallback 定位：无法获取托盘位置时，Windows 放在屏幕右下角

### Phase 4: 三大 Bug 修复 (`451d43e`)

构建安装包后实际测试发现三个问题：

#### Bug 1: 关闭按钮不工作

| 方案 | 结果 |
|------|------|
| `getCurrentWindow().hide()` | 失败 — Tauri JS API 在 Windows 透明窗口上行为异常 |
| `invoke("close_popover")` | 成功 — 通过 IPC 调用 Rust 后端隐藏窗口 |

**根因**: Tauri 2.0 的 `WebviewWindow` JS API 在 Windows `.transparent(true)` 窗口上部分失效。

#### Bug 2: 窗口无法拖拽（三次迭代）

| 迭代 | 方案 | 结果 |
|------|------|------|
| 1 | `data-tauri-drag-region` + `getCurrentWindow().startDragging()` | 失败 |
| 2 | 手动 `setPosition()` + `document.addEventListener` 追踪鼠标 | 失败 |
| 3 | Win32 FFI: `ReleaseCapture()` + `SendMessageW(WM_NCLBUTTONDOWN, HTCAPTION)` | 成功 |

**最终方案** (`src-tauri/src/lib.rs`):
```rust
#[tauri::command]
fn start_window_drag(window: tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            use std::ffi::c_void;
            #[link(name = "user32")]
            extern "system" {
                fn ReleaseCapture() -> i32;
                fn SendMessageW(hwnd: *mut c_void, msg: u32, wparam: usize, lparam: isize) -> isize;
            }
            const WM_NCLBUTTONDOWN: u32 = 0x00A1;
            const HTCAPTION: usize = 2;
            unsafe {
                ReleaseCapture();
                SendMessageW(hwnd.0 as *mut c_void, WM_NCLBUTTONDOWN, HTCAPTION, 0);
            }
        }
    }
}
```

**前端调用** (`src/popover/Header.tsx`):
```tsx
const handleDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a") || target.closest("input")) return;
    invoke("start_window_drag");
};
```

**根因**: Tauri 2.0 的 JS 拖拽 API（包括 `data-tauri-drag-region` 和 `startDragging()`）在 Windows 透明窗口上完全失效。手动 `setPosition()` 同样失败（疑似 WebView2 事件捕获问题）。最终绕过 Tauri/WebView2 层，直接使用 Win32 窗口管理器 API 实现原生拖拽。

#### Bug 3: 圆角外侧可见边框

**原因**: `.shadow(true)`（默认值）会给窗口添加原生阴影，在透明圆角窗口的四个角落产生可见边框。

**修复**: 创建窗口时 Windows 平台显式设置 `.shadow(false)`。

```rust
#[cfg(target_os = "windows")]
let builder = builder.shadow(false);
```

---

## 关键经验总结

1. **Tauri 2.0 + Windows 透明窗口**: JS 窗口管理 API（拖拽、隐藏等）在 `.transparent(true)` 窗口上可能失效，需要通过 `invoke()` IPC 调用 Rust 后端或直接使用 Win32 FFI。

2. **无边框窗口拖拽**: Windows 标准做法是 `ReleaseCapture` + `SendMessage(WM_NCLBUTTONDOWN, HTCAPTION)`，让窗口管理器将鼠标按下事件视为标题栏拖拽。这比手动追踪鼠标位置 + `setPosition()` 更可靠。

3. **圆角窗口 + 阴影冲突**: 在 Windows 上使用 `decorations(false)` + `transparent(true)` 实现自定义窗口时，需关闭原生阴影 (`.shadow(false)`)，否则会在圆角处出现边框。

4. **`data-tauri-drag-region` 仍需保留**: macOS 上该属性工作正常，保留可同时支持两个平台。Windows 分支由 `onMouseDown` + `invoke` 处理。

5. **Windows 托盘图标**: 不支持 `set_title()`（macOS 专有），需动态生成位图图标，用 `set_icon()` 设置。

---

## 发布

- **PR**: https://github.com/Ngaizean/glm-quota-monitor/pull/1
- **Release**: https://github.com/Ngaizean/glm-quota-monitor/releases/tag/v2.3.0
- **安装包**: NSIS (.exe) + MSI (.msi)
