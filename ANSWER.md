# Windows vs macOS 功能对齐检查

**仓库**: glm-quota-monitor | **Session**: debug | **日期**: 2026-05-22

---

## 结论：两平台功能基本对齐，无缺失功能

---

## 逐项对比

### 1. 窗口装饰（圆角/透明/阴影）

| | Windows | macOS |
|---|---|---|
| 实现 | DWM API `DwmSetWindowAttribute` 设圆角偏好 | `objc` crate 调 NSWindow 透明+圆角+阴影 |
| 状态 | **对齐** | **对齐** |
| 备注 | Win11 22H2+ 原生圆角，Win10 降级到 CSS 圆角 | macOS 原生三层效果 |

### 2. 应用初始化

| | Windows | macOS |
|---|---|---|
| 实现 | 空函数 | `set_activation_policy(Accessory)` 隐藏 Dock 图标 |
| 状态 | **对齐** | **对齐** |
| 备注 | Windows 托盘应用天然不显示在任务栏，无需额外设置 | macOS 必须显式设置 |

### 3. 托盘百分比显示

| | Windows | macOS |
|---|---|---|
| 实现 | 32×32 自定义像素图标（含数字+颜色分级），~100行 | `tray.set_title("85%")` 文本，3行 |
| 状态 | **对齐** | **对齐** |
| 备注 | macOS 菜单栏原生支持文本标题，Windows 必须用图标 | 设计差异，非功能缺失 |

### 4. 弹窗定位方向

| | Windows | macOS |
|---|---|---|
| 实现 | 托盘**上方**弹出 `y = tray_y - window_h - 4` | 托盘**下方**弹出 `y = tray_y + tray_h + 4` |
| 状态 | **对齐** | **对齐** |
| 备注 | 符合各 OS 习惯（macOS 菜单栏在顶部，Windows 托盘在底部） |

### 5. 无边框窗口拖拽

| | Windows | macOS |
|---|---|---|
| 实现 | Win32 API `ReleaseCapture + SendMessageA(WM_NCLBUTTONDOWN)` | **无原生实现**（空操作） |
| 前端 | `data-tauri-drag-region` + `invoke("start_window_drag")` | `data-tauri-drag-region` |
| 状态 | **对齐** | **对齐** |
| 备注 | macOS 通过 Tauri 内置 `data-tauri-drag-region` 实现拖拽，无需额外原生代码 | 两平台均可用 |

### 6. 平台专属依赖

| | Windows | macOS |
|---|---|---|
| Crate | 无（直接 FFI 调 `dwmapi`/`user32`） | `objc = "0.2"` |
| 状态 | **对齐** | **对齐** |

### 7. 前端平台检测

- `src/` 目录中 **无任何** 平台检测代码（无 `navigator.platform`、`isMac`、`isWindows`）
- 所有平台差异集中在 Rust 后端的 `#[cfg(target_os)]` 条件编译
- **状态：对齐**

---

## 总结

| 功能 | Windows | macOS | 缺失？ |
|------|---------|-------|--------|
| 窗口圆角 | DWM API | NSWindow layer | 无 |
| 应用初始化 | 无需 | Accessory 模式 | 无 |
| 托盘显示 | 像素图标 | 文本标题 | 无 |
| 弹窗方向 | 向上 | 向下 | 无 |
| 窗口拖拽 | Win32 + Tauri | Tauri 内置 | 无 |
| API 数据读取 | 完全共享同一代码 | 完全共享同一代码 | 无 |

**两平台功能完全对齐，无功能缺失。**
