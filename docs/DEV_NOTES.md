# 开发踩坑记录

## Tauri 2 构建与调试

### cargo build vs npx tauri build

**问题**：使用 `cargo build` 编译后，弹出窗口白屏，Web Inspector 报 `Failed to load resource: Could not connect to the server`。

**原因**：`cargo build` 只编译 Rust 代码，**不会**将 `frontendDist`（dist/）目录嵌入到二进制文件中。`tauri_build::build()` 在 build.rs 中虽然存在，但前端资源的嵌入需要通过 Tauri CLI 完成完整的打包流程。

**解决**：必须使用 `npx tauri build --debug` 或 `npx tauri dev` 来构建。前者生成带嵌入资源的 .app bundle，后者启动 Vite dev server + 热重载。

**构建顺序**：前端先构建 → 再构建 Rust（Tauri CLI 会自动按 `beforeBuildCommand` → Rust 编译的顺序执行）。

```
# 正确：Tauri CLI 自动处理
npx tauri build --debug --bundles app

# 错误：cargo build 不嵌入前端资源
cargo build
./target/debug/glm-quota-monitor  # → 白屏
```

### 调试白屏的方法

1. 在 `WebviewWindowBuilder` 后加 `window.open_devtools()`（debug 构建生效），右键可打开 Inspector
2. 直接用 `.app` bundle 启动而非裸二进制
3. 检查 Inspector Console 和 Network 标签页

### Tauri 2 权限系统

**问题**：设置页面报 `window.set_size not allowed` 错误。

**原因**：Tauri 2 采用 capability-based 权限模型。默认只有 `core:default`，窗口操作（set-size、set-position 等）需要显式声明。

**解决**：在 `src-tauri/capabilities/default.json` 中添加所需权限：

```json
{
  "permissions": [
    "core:default",
    "core:window:allow-set-size",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-focus",
    "core:window:allow-set-position",
    "core:window:allow-close",
    "core:window:allow-is-visible"
  ]
}
```

### CSP 与 IPC 通信

**问题**：Console 报 `Refused to connect to ipc://localhost` CSP 错误。

**原因**：`tauri.conf.json` 的 CSP `default-src` 缺少 IPC 协议声明。Tauri 2 会降级到 postMessage 但有性能损耗。

**解决**：CSP 中添加 `connect-src ipc://localhost`：

```json
"csp": "default-src 'self'; connect-src ipc://localhost; style-src 'self' 'unsafe-inline'; ..."
```

## Rust 后端

### .unwrap() 崩溃风险

所有 `Mutex::lock().unwrap()` 在多线程环境下遇到 panic 会传播导致整个应用崩溃。统一替换为 `.map_err(|e| format!("数据库锁定: {}", e))?`。

### API Key 明文迁移

旧版 API Key 存在数据库明文中，新版迁移到系统 Keychain 后，需要在每次读取时检查：如果 Keychain 没找到但数据库有明文，自动迁移到 Keychain 并清空数据库明文。使用 `crypto::resolve_api_key()` 统一处理。

### 平台代码抽象

macOS/Windows 的窗口装饰、托盘定位、应用初始化等逻辑通过 `#[cfg(target_os)]` 条件编译分发到 `platform/macos.rs` 和 `platform/windows.rs`，主入口 `lib.rs` 不含任何平台特定代码。

## 前端

### 暗色模式适配

颜色值不要硬编码（如 `text-red-600`），统一使用 CSS 变量（`text-[var(--color-danger)]`），在 `@media (prefers-color-scheme: dark)` 中覆盖变量值。

### Accordion 布局

从横向 Tab 切换改为竖向折叠卡片布局：
- 使用 `max-h-0/max-h-[500px]` + `opacity` 过渡实现折叠动画
- 折叠态显示头像 + 别名 + 等级 badge + 额度百分比 + 箭头
- 展开态显示用途说明 + 额度条 + 用量统计
