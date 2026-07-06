# Windows 构建报告 — v6.1.0

**仓库**: glm-quota-monitor | **分支**: master | **HEAD**: 46cf2e3
**构建日期**: 2026-07-06 13:49 → 13:57（约 7.5 分钟）
**构建机**: Windows 10 Pro 10.0.19045，4 核 8 线程
**目标**: x86_64-pc-windows-msvc

---

## 一、工具链

| 工具 | 版本 |
|---|---|
| Node | v24.13.0 |
| npm | 11.6.2 |
| Rust | 1.94.1 (e408947bf 2026-03-25) |
| Cargo | 1.94.1 (29ea6fb6a 2026-03-24) |
| Tauri CLI | 2.10.1 |
| Vite | 7.3.2 |

---

## 二、构建过程

### 命令
```bash
npm run tauri build
# 等价于：npm run build (tsc + vite) → cargo build --release → bundle (nsis + msi)
```

### 阶段耗时
| 阶段 | 耗时 | 结果 |
|---|---|---|
| 前端 (tsc + vite) | ~9s | ✅ 739 模块，dist 生成 |
| Rust release 全量编译 | 6m48s | ✅ 0 error，7 warnings（死代码） |
| Bundle NSIS | ~30s | ✅ setup.exe 生成 |
| Bundle MSI (WiX) | ~30s | ✅ .msi 生成 |
| Updater 签名 | — | ⚠ 跳过（无私钥，见第四节） |

---

## 三、产物

| 产物 | 大小 | 路径 |
|---|---|---|
| NSIS 安装包 | 4.8 MB (4,929,536 B) | `src-tauri/target/release/bundle/nsis/GLM Quota Monitor_6.1.0_x64-setup.exe` |
| MSI 安装包 | 6.8 MB (7,122,944 B) | `src-tauri/target/release/bundle/msi/GLM Quota Monitor_6.1.0_x64_en-US.msi` |
| 裸可执行文件 | 19 MB | `src-tauri/target/release/glm-quota-monitor.exe` |

**exe 版本资源**（PowerShell `Get-Item .VersionInfo`）：
- ProductName: GLM Quota Monitor
- ProductVersion / FileVersion: 6.1.0
- CompanyName: ngaizean
- FileDescription: GLM Quota Monitor

**前端产物**（`dist/`，已嵌入 exe）：
- `index.html` 0.48 kB
- `assets/index-wioRVVPn.css` 42.73 kB
- `assets/index-D4d7YcLz.js` 725.15 kB（gzip 214 kB）

---

## 四、构建中遇到的问题

### 问题 1：前端缺 npm 依赖（已修复）

**现象**：首次 `npm run tauri build` 在 `beforeBuildCommand` 阶段失败：
```
src/settings/AboutPane.tsx(2,23): error TS2307: Cannot find module '@tauri-apps/plugin-updater'
src/settings/AboutPane.tsx(3,26): error TS2307: Cannot find module '@tauri-apps/plugin-process'
src/settings/AboutPane.tsx(80,40): error TS7006: Parameter 'event' implicitly has an 'any' type
```

**根因**：`node_modules/` 是从别的机器同步过来的，`package.json` 声明了 `plugin-process` 和 `plugin-updater`，但 `node_modules/@tauri-apps/` 下只有 `plugin-opener`。`event` 隐式 any 是 updater 类型缺失的连锁反应。

**修复**：`npm install`（补装 2 个包）。

### 问题 2：Updater 签名缺失私钥（非阻塞，可忽略）

**现象**：两个安装包生成完毕后，末尾报错：
```
A public key has been found, but no private key. Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
```
进程退出码 1。

**根因**：`tauri.conf.json` 设了 `bundle.createUpdaterArtifacts: true` + `plugins.updater.pubkey`，但本机没有 `TAURI_SIGNING_PRIVATE_KEY` 环境变量，无法生成 `.sig` 签名产物。

**影响范围**：仅影响自动更新校验用的 `.sig` / `latest.json`。**安装包本身已正常生成**，不受影响。

**处置**：本地自用忽略（与 `build-install.sh` 注释一致："本地自用不需要自动更新签名"）。若要正式发布带自动更新的版本，需由持有对应私钥的 owner（Ngaizean）在签名环境构建。

---

## 五、Rust 编译 warnings（7 个，均为死代码）

与 `cargo_check.log` 一致，无新增：
- `agent.rs:81` unused `mut`
- `lib.rs:176` `fetch_account_quota` 未使用
- `alert/notifier.rs:7` `check_and_notify` 未使用
- `codex/auth.rs:83` `delete_auth_from_keychain` 未使用
- `codex/sync.rs:34` `Gist.id` 字段未读
- `pricing.rs:5` `PRICING` static 未使用
- `pricing.rs:27` `get_price` 未使用

均不影响运行。可用 `cargo fix --lib -p glm-quota-monitor` 自动清理 1 处。

---

## 六、安装

二选一：
- **NSIS**（推荐，体积小）：双击 `GLM Quota Monitor_6.1.0_x64-setup.exe`
- **MSI**：双击 `GLM Quota Monitor_6.1.0_x64_en-US.msi`

NSIS 配置（`tauri.conf.json`）：`webviewInstallMode: downloadBootstrapper`（缺 WebView2 时自动下载引导器），语言 SimpChinese + English。

---

## 七、复现命令（仅本机构建）

```bash
cd C:/Users/y/Desktop/glm-quota-monitor
npm install          # 首次或依赖变更后
npm run tauri build  # 增量构建（二次起 Rust 编译 < 1 分钟）
```

注意：本机首次全量 Rust 编译需 6~7 分钟；二次构建走增量缓存，秒级到分钟级。
