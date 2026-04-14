# GLM Quota Monitor — Windows 开发计划书

> 负责人：余泓麟（Alidadei）
> 审阅人：相互
> 日期：2026-04-14

---

## 总览

将 Windows 平台适配拆分为 **5 个阶段**，每阶段产出可验证的交付物。阶段间有依赖关系，同一阶段内的任务可并行。

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
编译修复     平台适配     体验对齐     打包配置     发布
```

### 前提

macOS 版（v2.2.0）已完成全部核心功能，后端 API / 数据库 / 预警 / 前端 UI 均跨平台可用。Windows 侧需补充的是**平台特定代码 + 构建配置 + 安装包打包**。

---

## 当前 Windows 兼容性现状

| 模块 | macOS | Windows | 问题 |
|------|-------|---------|------|
| 编译 | 通过 | **失败** | `MacosLauncher` 类型不存在 |
| API 客户端 | OK | OK | `reqwest` 跨平台 |
| 数据库 | OK | OK | `rusqlite` bundled 模式跨平台 |
| 预警引擎 | OK | OK | 纯逻辑 + `tauri-plugin-notification` 跨平台 |
| 凭据存储 | Keychain | Credential Manager | `keyring` crate 自动适配，无代码问题 |
| Popover 圆角 | NSWindow API | **无** | 窗口呈生硬矩形 |
| 托盘图标文字 | `set_title()` | **无效** | Windows 托盘不支持图标旁文字 |
| 系统通知 | Notification Center | Toast 通知 | 插件自动适配，无需额外代码 |
| 自启动 | LaunchAgent | **未配置** | 硬编码 `MacosLauncher` |
| 构建配置 | DMG + Info.plist | **无** | 缺 `windows` 配置块 |

---

## Phase 0：编译修复

**目标**：项目在 Windows 上能 `cargo build` 通过并启动。

### 0.1 修复 `MacosLauncher` 编译错误

**问题**：`lib.rs:243-246` 硬编码了 `MacosLauncher::LaunchAgent`，该类型仅在 macOS 编译目标下存在。

**方案**：条件编译，Windows 使用 `tauri_plugin_autostart` 的默认初始化。

```rust
// 修改前（lib.rs:243-246）
.plugin(tauri_plugin_autostart::init(
    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
    None,
))

// 修改后
#[cfg(target_os = "macos")]
.plugin(tauri_plugin_autostart::init(
    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
    None,
))
```

> **注意**：`tauri-plugin-autostart` v2 的 `init()` 函数签名在 macOS 和非 macOS 平台不同。macOS 需要传 Launcher 类型参数，Windows 不需要。需要查阅该插件文档确认 Windows 侧的正确初始化方式。如果 `init()` 不接受平台差异化参数，则可能需要用 `#[cfg]` 分别调用不同的初始化函数。

**验证标准**：`cargo build` 在 Windows 上无错误通过。

### 0.2 创建 `platform/windows.rs` 模块

**问题**：`platform/mod.rs` 仅有 macOS 模块声明，Windows 编译时 `platform` 为空模块。

**方案**：

1. 创建 `src-tauri/src/platform/windows.rs`，初始内容为占位函数：

```rust
/// Windows 平台：应用窗口圆角
/// 待 Phase 1 实现
pub fn apply_rounded_corners(_window: &tauri::WebviewWindow, _radius: f64) {
    // TODO: 使用 DWM API 或其他方式实现
}
```

2. 修改 `src-tauri/src/platform/mod.rs`：

```rust
#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;
```

3. 修改 `lib.rs` 中的圆角调用：

```rust
// 修改前
#[cfg(target_os = "macos")]
platform::macos::apply_rounded_corners(&window, 12.0);

// 修改后
#[cfg(target_os = "macos")]
platform::macos::apply_rounded_corners(&window, 12.0);
#[cfg(target_os = "windows")]
platform::windows::apply_rounded_corners(&window, 12.0);
```

**验证标准**：`cargo build` 通过，`npm run tauri dev` 在 Windows 上能启动并显示托盘图标。

### 0.3 验证基础功能

**任务**：启动应用后逐项验证以下功能在 Windows 上的工作状态：

- [ ] 托盘图标正常显示
- [ ] 左键点击托盘图标弹出 Popover
- [ ] Popover 中添加账号、输入 API Key
- [ ] 额度查询正常返回数据
- [ ] 后台定时刷新正常运行
- [ ] 预警通知通过 Windows Toast 正常弹出
- [ ] 设置页面（账号/预警/通用/关于）可正常操作

**阶段交付**：Windows 上可编译、可运行、核心功能可用的应用。

---

## Phase 1：平台适配

**目标**：Popover 窗口体验与 macOS 对齐，托盘图标显示核心指标。

### 1.1 Popover 窗口圆角

**问题**：无边框窗口在 Windows 上没有圆角效果，显示为生硬矩形。

**方案**（选一）：

| 方案 | 实现方式 | 优点 | 缺点 |
|------|---------|------|------|
| A. DWM API | 调用 `DwmSetWindowAttribute` 设置圆角 | 系统原生效果 | 需要 Windows 11 22H2+，Win10 无效 |
| B. CSS border-radius | 前端层面加圆角 + 透明背景 | 跨 Windows 版本通用 | 需配合窗口透明设置 |
| C. 混合方案 | Win11 用 DWM，Win10 降级到 CSS | 兼容性最好 | 实现复杂度高 |

**推荐方案 B（CSS 方案）**，原因：
- 项目需要支持 Windows 10+，DWM 圆角仅 Win11 可用
- macOS 侧 `macos.rs` 已将窗口设为透明（`setOpaque:NO` + `clearColor`），Windows 侧同样设置窗口背景透明后，CSS 圆角即可生效
- 实现简单，维护成本低

**实现要点**：
1. `platform/windows.rs` 中设置窗口透明背景
2. 前端 `Popover.tsx` 的根容器添加 `border-radius` + `overflow: hidden`
3. 验证窗口四角无白色/黑色方角残留

**验证标准**：Popover 窗口四角呈现圆角，视觉与 macOS 版基本一致。

### 1.2 托盘图标显示百分比

**问题**：`tray.set_title()` 在 Windows 上无效，托盘图标旁无法显示百分比文字。

**方案**：动态生成带百分比文字的图标 PNG，通过 `tray.set_icon()` 更新。

**实现要点**：
1. 在 Rust 侧用 `image` crate 动态绘制图标：
   - 基础底图（应用图标 32×32）
   - 在图标右下角叠加百分比文字（如 "85%"）
   - 颜色随百分比变化：绿(<60%) → 黄(60-85%) → 红(>85%)
2. 每次额度刷新后重新生成并更新图标
3. 需要在 `Cargo.toml` 添加 `image` crate 依赖（`[target.'cfg(target_os = "windows")'.dependencies]`）

**验证标准**：托盘图标实时显示百分比数字和颜色变化。

### 1.3 Popover 点击外部自动收起

**问题**：macOS 上 Popover 点击外部自动收起的行为需要在 Windows 上验证和适配。

**方案**：
1. 测试当前 `window.hide()` 在 Windows 上的行为
2. 如果点击外部不会自动触发隐藏，需在前端监听 `window blur` 事件调用 `close_popover`

```typescript
// 前端可能的实现
useEffect(() => {
  const handleBlur = () => invoke("close_popover");
  window.addEventListener("blur", handleBlur);
  return () => window.removeEventListener("blur", handleBlur);
}, []);
```

**验证标准**：点击 Popover 外部任意位置，Popover 自动收起。

**阶段交付**：Windows 上视觉体验和交互行为与 macOS 对齐的应用。

---

## Phase 2：构建配置与打包

**目标**：生成可安装的 Windows 安装包。

### 2.1 配置 `tauri.conf.json` Windows 块

**方案**：在 `bundle` 中添加 `windows` 子配置。

```jsonc
{
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [/* ... 现有图标 ... */],
    "macOS": {
      "infoPlist": "../Info.plist"
    },
    "windows": {
      "webviewInstallMode": {
        "type": "downloadBootstrapper"
        // 或 "embedBootstrapper" / "offlineInstaller" / "fixedRuntime"
        // 根据目标用户群体选择
      },
      "wix": null,  // 如果用 WiX (MSI)
      "nsis": null   // 如果用 NSIS
    }
  }
}
```

**决策点**：安装包格式选择：

| 格式 | 优点 | 缺点 |
|------|------|------|
| NSIS (.exe) | 安装流程简单、体积小 | 非标准安装格式 |
| WiX (.msi) | Windows 标准格式、企业部署友好 | 配置复杂 |

**推荐 NSIS**，理由：个人工具类应用优先安装体验，NSIS 更轻量。

### 2.2 构建与测试

**任务**：
1. 运行 `npm run tauri build`，生成 NSIS/MSI 安装包
2. 在全新 Windows 10/11 环境安装测试
3. 验证：
   - [ ] 安装流程正常
   - [ ] 安装后启动正常
   - [ ] 托盘图标正常显示
   - [ ] 开机自启生效（任务管理器 → 启动项可见）
   - [ ] 卸载流程正常，残留文件清理干净

### 2.3 WebView2 运行时处理

**问题**：Tauri 2 在 Windows 上依赖 WebView2 运行时。

**方案**：
- Windows 11 已内置 WebView2，无需额外处理
- Windows 10 需要选择 `webviewInstallMode`：
  - `downloadBootstrapper`：首次启动自动下载安装（推荐，用户无感）
  - `offlineInstaller`：打包进安装包（体积增大约 100MB）

**推荐 `downloadBootstrapper`**，理由：安装包体积小，且大多数 Win10 用户已有 WebView2。

**验证标准**：
- Win11：安装后直接可用
- Win10（无 WebView2）：首次启动自动引导安装 WebView2

**阶段交付**：可在 Windows 10/11 上安装运行的应用安装包。

---

## Phase 3：完善与优化

**目标**：打磨细节，提升 Windows 原生体验。

### 3.1 `crypto.rs` 命名中性化

**问题**：错误类型 `CryptoError::Keychain` 和注释中 "系统 Keychain" 对 Windows 有误导性。`keyring` crate 在 Windows 上使用的是 Credential Manager。

**方案**：

```rust
// 修改前
#[error("Keychain error: {0}")]
Keychain(String),

/// 将 API Key 存入系统 Keychain
pub fn store_api_key(...)

// 修改后
#[error("Credential store error: {0}")]
CredentialStore(String),

/// 将 API Key 存入系统凭据管理器（macOS Keychain / Windows Credential Manager）
pub fn store_api_key(...)
```

**范围**：`CryptoError::Keychain` → `CredentialStore`，所有注释中的 "Keychain" → "凭据管理器"。

**注意**：此为破坏性重命名，需同时检查 `lib.rs` 中引用 `crypto::` 的地方是否使用了这个错误类型。如果前端不依赖这个错误类型的名称，则影响范围仅限 Rust 内部。

**验证标准**：`cargo build` 通过，功能无变化。

### 3.2 Windows 高 DPI 适配

**任务**：
1. 验证 Popover 在 125%/150%/200% 缩放下的显示效果
2. 如有模糊问题，添加 DPI 感知配置（Windows manifest 或 Tauri 配置）

**验证标准**：在 150% 缩放下 Popover 文字和图标清晰无模糊。

### 3.3 暗色模式适配

**任务**：
1. 验证 Windows 暗色模式下 Popover 和设置窗口的显示效果
2. 如有问题，跟随 `prefers-color-scheme` 媒体查询切换配色

**验证标准**：切换 Windows 暗色/亮色模式后 UI 正确响应。

**阶段交付**：Windows 上体验完善、无明显视觉问题的应用。

---

## Phase 4：发布

**目标**：达到可分发的质量。

### 4.1 全量功能测试

**测试清单**：

| 功能 | 测试项 | 预期结果 |
|------|--------|---------|
| 添加账号 | 输入别名 + API Key | 验证通过后加密存储，Popover 立即展示数据 |
| 额度查询 | 5h 窗口 / 周额度 / MCP 月度 | 百分比、进度条、倒计时正确显示 |
| 多账号 | 添加 3+ 个账号 | 列表显示、切换正常、各账号数据独立 |
| 历史统计 | 查看 7d/30d 趋势图 | 折线图正确渲染，悬停显示数值 |
| 预警通知 | 额度超阈值 | Windows Toast 通知弹出，同周期不重复 |
| 托盘图标 | 刷新后图标更新 | 百分比和颜色正确变化 |
| 定时刷新 | 等待一个刷新周期 | 数据自动更新，Popover 打开后显示最新值 |
| 设置页面 | 修改刷新间隔 / 开关预警 | 配置持久化，重启后保留 |
| 开机自启 | 启用后重启电脑 | 应用自动启动 |
| 系统通知权限 | 首次触发通知 | Windows 弹出通知权限请求 |

### 4.2 性能验证

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 启动时间 | < 3s | 从双击图标到托盘图标出现 |
| 内存占用 | < 100MB | 任务管理器查看后台运行时内存 |
| CPU 占用 | 空闲时 < 1% | 任务管理器，刷新间隔内 |

### 4.3 发布物

| 文件 | 格式 | 说明 |
|------|------|------|
| 安装包 | `.exe` (NSIS) | 主分发格式 |
| 符号文件 | `.pdb` | 调试用 |
| 校验文件 | `.sha256` | 安装包哈希 |

### 4.4 GitHub Release

- 创建 `v2.2.0-windows` Release（或与 macOS 共用 `v2.2.0`，分平台 assets）
- 上传安装包 + SHA256 校验文件
- Release notes 包含 Windows 已知限制（如有）

**阶段交付**：可公开分发的 Windows 安装包，发布到 GitHub Release。

---

## 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| `tauri-plugin-autostart` v2 Windows 初始化 API 与 macOS 不一致 | Phase 0 编译修复受阻 | 提前查阅插件源码/文档确认 Windows 初始化方式 |
| WebView2 在部分 Win10 机器上安装失败 | 用户无法使用 | 备选 `offlineInstaller` 模式，将 WebView2 打包进去 |
| CSS 圆角 + 透明窗口在部分 Win10 版本渲染异常 | 视觉降级 | 降级到直角窗口，不影响功能 |
| `image` crate 绘制文字图标质量不佳 | 托盘百分比不够清晰 | 备选：预生成一套固定百分比图标（0%/25%/50%/75%/90%/100%），按区间选择 |
| Windows Defender 误报 | 安装包被拦截 | 短期：用户手动放行；长期：代码签名 |

---

## 技术决策待确认

| 决策项 | 选项 | 建议 |
|--------|------|------|
| 安装包格式 | NSIS vs WiX | NSIS（轻量、体验好） |
| WebView2 安装方式 | downloadBootstrapper vs offlineInstaller | downloadBootstrapper（体积小） |
| 圆角实现方案 | DWM API vs CSS vs 混合 | CSS（兼容 Win10） |
| 托盘图标文字方案 | 动态绘制 vs 预生成图标集 | 动态绘制（更精确） |
| 版本号策略 | 与 macOS 共用 vs 独立版本 | 共用版本号，按平台分 assets |

---

## 工作量估算

| 阶段 | 任务数 | 预估复杂度 |
|------|--------|-----------|
| Phase 0 编译修复 | 3 | 低 — 改几行代码 + 验证 |
| Phase 1 平台适配 | 3 | 中 — 圆角和图标文字是核心工作 |
| Phase 2 构建打包 | 3 | 低中 — 主要是配置 |
| Phase 3 完善优化 | 3 | 低 — 打磨细节 |
| Phase 4 发布 | 4 | 低 — 测试和打包 |
| **合计** | **16** | |

---

## 建议执行顺序

Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 严格串行。每个 Phase 完成后可向 `dev` 分支提交 PR。

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
编译修复     平台适配     构建打包     完善优化     发布
  ↓            ↓            ↓            ↓           ↓
可编译       体验对齐     有安装包     无明显问题   GitHub Release
```
