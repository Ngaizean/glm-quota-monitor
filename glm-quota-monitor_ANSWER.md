# 编译最新版 Windows 软件

**仓库**: glm-quota-monitor | **Session**: build | **日期**: 2026-07-06
**任务**: 在 Windows 本机编译 v6.1.0 安装包

---

## 结论：✅ 成功，两个安装包已生成

完整报告见 `record/windows-build-v6.1.0-20260706.md`。

| 产物 | 大小 | 路径 |
|---|---|---|
| NSIS 安装包（推荐） | 4.8 MB | `src-tauri/target/release/bundle/nsis/GLM Quota Monitor_6.1.0_x64-setup.exe` |
| MSI 安装包 | 6.8 MB | `src-tauri/target/release/bundle/msi/GLM Quota Monitor_6.1.0_x64_en-US.msi` |

版本资源确认：ProductName=GLM Quota Monitor, ProductVersion=6.1.0, Company=ngaizean。

---

## 构建过程（7.5 分钟）

`npm run tauri build` 三阶段全过：

1. **前端** `tsc + vite`（~9s）— 739 模块打包到 `dist/`
2. **Rust** `cargo build --release`（6m48s）— 首次全量编译，0 error，7 个死代码 warning
3. **打包** NSIS + MSI 各 ~30s 生成

---

## 构建中遇到的两个问题

### 问题 1：前端缺 npm 依赖（已修复）

第一次构建在 TypeScript 阶段失败：找不到 `@tauri-apps/plugin-updater` 和 `plugin-process` 模块。

**根因**：`node_modules/` 是从别的机器同步过来的，`package.json` 里声明了这两个包但本机没装（`@tauri-apps/` 下只有 `plugin-opener`）。这两个是后加的依赖。

**修复**：跑了一次 `npm install`，补装 2 个包后构建通过。

### 问题 2：Updater 签名缺私钥（非阻塞，可忽略）

两个安装包都生成完之后，末尾报：
```
A public key has been found, but no private key. Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
```
进程退出码 1。

**这只影响自动更新用的 `.sig` 签名文件，不影响安装包本身**。原因：`tauri.conf.json` 配置了 updater（`createUpdaterArtifacts: true` + 固定 `pubkey`），但本机没有对应的 `TAURI_SIGNING_PRIVATE_KEY`。

本地自用无需处理。若要发布带自动更新的正式版，需由持有对应私钥的 owner（Ngaizean）在签名环境构建。这也与 `build-install.sh` 里的注释一致（"本地自用不需要自动更新签名"）。

---

## 环境信息

- Node v24.13.0 / npm 11.6.2
- Rust 1.94.1 / Cargo 1.94.1
- Tauri CLI 2.10.1
- 目标三元组：`x86_64-pc-windows-msvc`
- 构建机：Windows 10 Pro，4 核 8 线程

---

## 复现（本机二次构建走增量缓存，秒~分钟级）

```bash
cd C:/Users/y/Desktop/glm-quota-monitor
npm install          # 仅首次或依赖变更后
npm run tauri build  # 产物在 src-tauri/target/release/bundle/
```

## 安装

双击 `GLM Quota Monitor_6.1.0_x64-setup.exe`（NSIS，体积小）或 `.msi` 即可。缺 WebView2 时安装包会自动下载引导器。
