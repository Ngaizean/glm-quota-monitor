# GLM Quota Monitor — Windows 版本对齐开发计划

> 基线版本：master (v4.2.0)
> 日期：2026-04-24
> 审查依据：mac-dev-2 分支进度 + PLAN.md + PLAN_WINDOWS.md + 实际代码

---

## 一、mac-dev-2 分支进度审查

### 分支定位

`origin/feature/mac-dev-2` 是 master 的**严格子集** — 落后 4 个 commit（v4.2.0 发布 + Windows CI + WORKLOG）。它没有独有的新功能，仅移除了 Windows 专属文件并回退版本号至 4.1.0。这表明 mac-dev-2 是在 Windows 适配合并前分叉的 Mac 纯净开发分支，**尚未同步 master 的最新进展**。

### macOS 计划（PLAN.md）完成度

| Phase | 状态 | 说明 |
|-------|------|------|
| Phase 0 脚手架 | ✅ 完成 | Tauri 2.0 + React + Tray 已搭建 |
| Phase 1 Rust 后端 | ✅ 完成 | API 客户端、数据库、加密、IPC 全部可用 |
| Phase 2 macOS 集成 | ✅ 完成 | Popover、通知、设置窗口、图标动态更新、开机自启 |
| Phase 3 前端 UI | ✅ 完成 | QuotaCard、MiniChart、AccountSwitch、设置四页面、Hooks |
| Phase 4 业务逻辑 | ✅ 完成 | 账号流程、定时刷新、快照记录、预警引擎、多账号轮询 |
| Phase 5 打磨发布 | ✅ 完成 | 暗色主题、错误处理、性能优化、DMG 打包 |

### 计划外新增功能（v2.2.0 → v4.2.0）

| 功能 | 引入版本 | 描述 |
|------|---------|------|
| 平台抽象层 | v2.3.0 | `platform/macos.rs` + `platform/windows.rs` 条件编译 |
| Accordion UI | v2.3.0 | 展开/折叠面板组件 |
| 性能优化 + 动态高度 | v3.x | Popover 内容自适应高度 |
| 主账号概念 | v3.x | 多账号中标记主账号 |
| Agent Key 热重载 | v4.0 | 无需重启即可更新 API Key |
| 默认模型设置 | v4.0 | 可配置查询使用的默认模型 |
| 空转调度 + 多时段 | v4.0 | 低活跃时段自动降低刷新频率 |
| MCP 展示 | v4.0 | MCP 月度额度信息展示 |
| 弹窗定位优化 | v4.0 | 模型选择器交互改进 |
| last_active 快照 | v4.1 | 上次活跃时间展示 + 快照对比方案 |
| Windows CI | v4.2 | GitHub Actions 自动构建 Windows 安装包 |

### 结论

macOS 版（master）已**全部完成 PLAN.md 的 6 个 Phase**，并额外增加了 11 项计划外功能。mac-dev-2 分支已无继续存在的必要，其功能已完全包含在 master 中。

---

## 二、Windows 版本对齐计划

### 当前 Windows 状态

| 模块 | 状态 | 说明 |
|------|------|------|
| 编译 + 启动 | ✅ | 条件编译已修复，`cargo build` 通过 |
| Popover 圆角 | ✅ | CSS 透明方案已实现 |
| Popover 拖拽 | ✅ | Win32 FFI (`ReleaseCapture` + `SendMessageW`) |
| 托盘图标百分比 | ✅ | `image` crate 动态绘制 |
| 点击外部收起 | ✅ | blur 事件监听 |
| 暗色模式 | ✅ | CSS 跟随系统 |
| 构建配置 | ✅ | NSIS 安装包 + tauri.conf.json Windows 块 |
| CI 构建 | ✅ | GitHub Actions `build-windows.yml` |
| 开机自启 | ✅ | `tauri-plugin-autostart` 条件编译 |

### Windows 功能缺口分析

对比 master (v4.2.0) 的完整功能列表，以下功能在 Windows 侧需要验证或补充：

#### 第一优先级：核心功能验证（必须）

| # | 功能 | 风险评估 | 工作量 |
|---|------|---------|--------|
| 1.1 | Agent Key 热重载 | 低 — 纯 IPC 逻辑 | 验证 `invoke("reload_api_keys")` 正常工作 |
| 1.2 | 默认模型设置 | 低 — 纯前端 + IPC | 验证设置页模型选择器可用 |
| 1.3 | 空转调度 + 多时段 | 中 — 涉及后台定时器 | 验证 `last_active` 检测和频率切换在 Win 上正常 |
| 1.4 | MCP 月度额度展示 | 低 — 纯前端渲染 | 验证数据展示正确 |
| 1.5 | last_active 快照对比 | 中 — 涉及时间戳比较 | 验证首次快照不误触、活跃时间正确显示 |
| 1.6 | 多账号轮询 | 低 — 纯逻辑 | 验证多账号切换和主账号标记 |

#### 第二优先级：体验优化（建议）

| # | 功能 | 风险评估 | 工作量 |
|---|------|---------|--------|
| 2.1 | 弹窗定位精确度 | 中 — 屏幕坐标差异 | 验证 Popover 在不同 DPI/多显示器下定位正确 |
| 2.2 | 高 DPI 适配 | 中 — WebView2 缩放 | 验证 125%/150%/200% 缩放无模糊 |
| 2.3 | 动态高度适配 | 低 — CSS | 验证 Popover 内容展开/折叠时高度自动调整 |
| 2.4 | Accordion 动画 | 低 — CSS transition | 验证展开/折叠动画流畅 |
| 2.5 | 模型选择器交互 | 低 — 前端 | 验证下拉选择器在 Popover 内定位正确 |

#### 第三优先级：长期优化（可选）

| # | 功能 | 风险评估 | 工作量 |
|---|------|---------|--------|
| 3.1 | Windows 11 原生圆角 | 低 — DWM API | Win11 可用 `DwmSetWindowAttribute` 替代 CSS 方案 |
| 3.2 | 代码签名 | 中 — 需购买证书 | 避免 Defender 误报 |
| 3.3 | 自动更新 | 低 — Tauri updater | Windows 版自动检查新版本 |

---

## 三、实施建议

### Phase A：全量功能验证（1-2 天）

**目标**：在 Windows 10/11 上启动 v4.2.0，逐一验证第一优先级功能。

```
1. npm run tauri dev（Windows）
2. 逐一测试第一优先级 6 项功能
3. 记录每个功能的测试结果（通过/异常/失败）
4. 对异常和失败的项创建 Issue
```

**交付物**：Windows 功能验证报告（`docs/WINDOWS_TEST_REPORT.md`）

### Phase B：问题修复（按需）

根据 Phase A 的验证结果，修复发现的问题。预估大部分功能"开箱即用"（纯前端/IPC 逻辑），可能需要修复的：

- 空转调度的时间相关逻辑（Windows 时区/时间格式差异）
- 高 DPI 下 Popover 定位偏移
- `last_active` 首次快照的边界条件

### Phase C：体验打磨（1 天）

- 高 DPI 测试（125%/150%/200%）
- 多显示器测试
- 暗色/亮色模式切换
- 长时间运行稳定性（内存泄漏检查）

### Phase D：发布（0.5 天）

- 更新版本号至下一版本
- 更新 CHANGELOG
- GitHub Release 发布 Windows 安装包
- 更新 README 添加 Windows 使用说明

---

## 四、执行流程

```
Phase A（验证）──→ Phase B（修复）──→ Phase C（打磨）──→ Phase D（发布）
   1-2 天              按需              1 天            0.5 天
```

**总预估**：3-4 天（假设无重大平台兼容性问题）

---

## 五、mac-dev-2 分支处理建议

`mac-dev-2` 已是 master 的严格子集，没有独有的新功能。建议：

1. **合并 master 到 mac-dev-2**（将 mac-dev-2 更新到最新），或
2. **删除 mac-dev-2 分支**（本地的已在上一轮清理）

如果 Mac 侧仍有独立开发需求，从最新 master 创建新的 Mac 开发分支即可。

---

## 六、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| WebView2 在 Win10 渲染差异 | CSS/布局异常 | 使用 `downloadBootstrapper` 确保 WebView2 版本较新 |
| Windows 时区影响空转检测 | 误判活跃状态 | 验证 `chrono` 在 Windows 上的时区处理 |
| 高 DPI 多显示器定位偏移 | Popover 位置错误 | 使用系统 API 获取实际 DPI 缩放比 |
| Defender 误报安装包 | 用户无法安装 | 短期：引导手动放行；长期：购买代码签名证书 |
