# Windows 平台验证报告

> 对应 `PLAN_WINDOWS_ALIGNMENT.md` Phase A 交付物
> 测试日期：2026-07-05（整理：2026-07-06）
> 测试环境：Windows 11 Pro 10.0.26200
> 应用版本：6.1.0（master，HEAD `98e5653` feat: improve Codex auth refresh and quota status）

---

## 一、启动验证

| 项 | 结果 | 备注 |
|---|---|---|
| `cargo check`（Windows） | ✅ | 0 error，7 warnings（死代码） |
| `npm run tauri dev` 启动 | ✅ | Rust 1m22s 编译完成 |
| 应用进程 | ✅ | 内存 29MB（< PLAN_WINDOWS 目标 100MB） |
| Vite 前端 dev server | ✅ | http://localhost:1420 ready in 750ms |
| 托盘图标显示 | ✅ | 用户确认正常 |
| Popover 弹出 | ✅ | 用户确认正常 |
| 设置页 UI 渲染 | ✅ | 用户确认正常 |

---

## 二、发现并修复的 Bug

### Bug 1：Codex 同步鉴权失败 — URL 类型未分流

**现象**：`sync_codex_auth` 报错 `Base64 解码失败: invalid symbol 62, offset 109372`

**根因**：
- 数据库 `codex_gist_url` 实际存的是**网页 URL**（`https://gist.github.com/Ngaizean/...`），不是 raw URL
- `fetch_from_gist` 直接 GET 该 URL，GitHub 返回 Gist 网页的 HTML（HTTP 200）
- HTML 被当成加密 base64 送进 `decrypt`，在 offset 109372 处遇到 `>` 字符（ASCII 值 62）→ `invalid symbol 62`
- 旧 fallback 设计（"先试 raw、失败再 resolve"）**无效**：网页 URL / API URL 都返回 HTTP 200，永远不会触发 fallback

**关键认知**：
- `>` 字符的 ASCII 值是 62 — 错误信息里的 "symbol 62" 指字节值，不是 base64 字符集位置
- GitHub secret gist 实际是 "unlisted"，任何人知道 gist ID 都能匿名访问 API 拿 raw_url，不需要 token

**修复**：
1. **URL 类型分流**（`src-tauri/src/commands/codex.rs:184-198`）：
   - `gistusercontent.com` → 直接匿名 fetch（raw URL 路径）
   - 其他（网页 URL / API URL）→ 调 `resolve_gist_raw_url` 拿 raw URL 后再 fetch
2. **`resolve_gist_raw_url` 支持匿名**（`src-tauri/src/codex/sync.rs:48-58`）：
   - token 为空时不带 `Authorization` header
   - 原因：consumer 角色在 UI 中不暴露 GitHub Token 字段（`CodexPane.tsx:260` `{role === "owner" && ...}`），必须支持匿名 resolve

**验证结果**：网页 URL + consumer 角色（无 token）→ `sync_codex_auth` 成功拉取并解密

> 此 bug 非平台特异（macOS 同样会触发），但首次在 Windows 实测时暴露。

---

## 三、安全事件：测试产物误提交到 public 仓库

**事件**：调试 Bug 1 时，在项目根目录用 `curl -o gist_meta.json` 拉取了 gist 元数据。该文件被 Windows 计划任务 `\GitAutoSync` 自动 `git add -A && commit && push` 到 public 仓库（commit `48ba985`）。

**泄露内容**：
- 加密的 codex `auth.json`（AES-256-GCM 密文，含 access_token / refresh_token）
- gist owner、node_id 等元数据
- 加密密钥硬编码在源码 `src-tauri/src/codex/crypto.rs:10`，仓库 public → 任何观众可解密拿到 codex 凭证

**处置**：
1. `git filter-branch --index-filter 'git rm --cached --ignore-unmatch gist_meta.json' --prune-empty -- 64ef834..HEAD` 重写历史
2. `git push --force-with-lease origin master` 覆盖远程
3. 本地 `refs/original` 删除 + `git reflog expire --expire=now --all` + `git gc --prune=now --aggressive`
4. `.gitignore` 扩展：`gist_meta.json`、`*.token`、`*.secret`、`*.key`、`*.pem`、`.env*`、`secrets/`
5. 凭证轮换：本机 codex `refresh_token` 已被吊销（经 `codex` CLI 实测确认 `Your access token could not be refreshed because your refresh token was revoked`），泄露窗口实际已闭合

**遗留**：GitHub 对象缓存可能仍可通过 commit hash 直接访问几周。凭证轮换是真正的补救，历史清理只减少暴露面。

**教训**（写入 `.gitignore` 顶部注释 + 本报告）：
- 测试产物**不要放项目工作树**（GitAutoSync 每分钟扫描）
- 改用 `R:/Data/projects/glm-quota-monitor/runs/` 或系统 temp 目录

---

## 四、新增功能（commit `98e5653`）的 Windows 兼容性

协作者 Ngaizean 在本机清理历史之后（parent = `b9c41ca`）提交了 codex token 自动刷新机制。Windows 兼容性核查：

| 新增组件 | 平台依赖 | Windows 兼容 |
|---|---|---|
| `refresh_access_token`（auth.rs） | reqwest + serde_json + base64 + `tauri::async_runtime::block_on` | ✅ 无平台依赖 |
| `extract_client_id` / `is_token_expiring_soon`（JWT 解码） | base64 URL_SAFE + chrono | ✅ |
| 写本机 auth.json | `dirs::home_dir()` → Win 上为 `C:\Users\<user>\.codex\auth.json` | ✅ 与 codex CLI Win 版路径一致 |
| Keychain 同步 | `keyring` crate → Win 上为 Credential Manager | ✅ 自动适配 |
| `CodexApiError::TokenInvalidated` | HTTP 响应头 `x-openai-ide-error-code` | ✅ |

`grep` 确认新增代码中**零** `cfg(target_os)`、`#[link]`、`objc`、`winapi` 等平台特定构造。`cargo check` 在 Windows 通过。

---

## 五、待验证项

以下项目需要**有效的 codex 凭证**才能端到端验证（当前本机 refresh_token 已吊销，无法走 happy path）：

### 来自 `PLAN_WINDOWS_ALIGNMENT` 第一优先级
- [ ] access_token <2 天过期时主动刷新（`is_token_expiring_soon` + `refresh_and_sync`）
- [ ] API 返回 401 时刷新后重试（`fetch_codex_account_quota` 的双保险分支）
- [ ] 空转调度 + 多时段（低活跃时段降频）
- [ ] MCP 月度额度展示
- [ ] last_active 快照对比（首次快照不误触）
- [ ] 多账号轮询 + 主账号标记

### 来自 `PLAN_WINDOWS` Phase 3
- [ ] 高 DPI（125% / 150% / 200%）
- [ ] 多显示器 Popover 定位
- [ ] 暗色模式切换响应
- [ ] 长时间运行内存泄漏检查

### 当前可观察（不需要有效凭证）
- [x] `TokenInvalidated` 错误提示在 UI 上的展示（本机已吊销，正好可观察）

---

## 六、结论

Windows 平台**核心可用**：
- 编译 / 启动 / UI 渲染 / 托盘 / Popover / 设置页全部正常
- Codex 同步功能（修复 URL 分流后）在 consumer 角色 + 网页 URL 场景下端到端通过
- 新增的 token 自动刷新机制代码层完全跨平台，Windows 编译通过

**剩余风险**：token 自动刷新的运行时 happy path 待 owner（Ngaizean）重新 login + upload 有效凭证后验证。

---

## 附：本次工作产出

- 代码修复：`src-tauri/src/commands/codex.rs`、`src-tauri/src/codex/sync.rs`（已在 master）
- `.gitignore` 扩展（已在 master）
- 历史清理：移除误提交的 `gist_meta.json`（force push 完成）
- 本报告：`docs/WINDOWS_TEST_REPORT.md`
