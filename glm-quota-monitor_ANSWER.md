# Codex 鉴权修复完成

**仓库**: glm-quota-monitor | **Session**: fix | **日期**: 2026-07-06
**症状**: codex 鉴权报 `查询 Gist 失败：error sending request for url (https://api.github.com/gists/...)`
**状态**: ✅ 已修复（rustls-tls + 默认代理 7890 + 前端代理 UI），已重编译重装

---

## 根因（双重，详见上一版诊断）

1. **代理端口错**：`lib.rs` 默认 `http://127.0.0.1:7897`，你的 Clash 实际监听 `7890` → 连不上代理
2. **Windows native-tls 吊销检查失败**：reqwest 默认 schannel，吊销服务器不可达 → `gist.githubusercontent.com` TLS 握手失败（`CRYPT_E_REVOCATION_OFFLINE`）

---

## 已完成的改动（4 文件）

### 后端
- **`src-tauri/Cargo.toml`**：reqwest 加 `rustls-tls` feature
  ```toml
  reqwest = { version = "0.12", features = ["json", "system-proxy", "rustls-tls"] }
  ```
- **`src-tauri/src/lib.rs`**：
  - `DEFAULT_PROXY_URL`：`7897` → `7890`
  - `build_proxy_client`：所有分支加 `.use_rustls_tls()`，绕过 schannel 吊销检查

### 前端
- **`src/settings/CodexPane.tsx`**：配置区加「代理地址」输入框（调 `get/set_codex_proxy`），owner/consumer 均可见
- **`src/i18n/locales/{zh,en}.json`**：加 `codexPane.proxyPlaceholder` / `proxyDesc`（含"修改后需重启"提示）

> 注：代理 client 用 `OnceLock` 缓存，**改代理地址需重启 app 生效**（UI 上有提示）。rustls 修复对所有 GitHub 域名（含 `gist.githubusercontent.com`）生效，无需重启即可在网络层修复。

---

## 验证

### 网络层（已用 curl 证明，等价于修复后的 reqwest 行为）
```
curl -x http://127.0.0.1:7890 https://api.github.com/gists/...        → 通（resolve 阶段）
curl -x http://127.0.0.1:7890 --ssl-no-revoke https://gist.githubusercontent.com/  → 301（fetch 阶段，= rustls）
```

### 端到端（需你在 app 里操作）
1. 打开 app → 设置 → **Codex** 页
2. 确认「代理地址」栏（默认空 = 用 7890，或显式填 `http://127.0.0.1:7890`）
3. 角色=接收者(consumer)：点「同步鉴权文件」
4. 预期：不再报 `查询 Gist 失败: error sending request`，而是
   - ✅ 成功（gist 存在 + 可解密）→ 显示上次同步时间
   - 或 404 / 解密错误（说明网络已通，是 gist 本身的问题，如 ID 错或凭证已吊销）

---

## 重编译记录
- 增量编译 2m31s（首次 6m48s），0 error，7 warnings（死代码，与改动无关）
- 产物：NSIS 4.8 MB + MSI 6.8 MB，已静默覆盖安装到 `%LOCALAPPDATA%\GLM Quota Monitor\`
- 中途 cargo 下载 `quinn`（rustls-tls 引入的 HTTP/3 依赖）因 schannel 间歇握手失败 → 加 `HTTPS_PROXY=127.0.0.1:7890 CARGO_NET_RETRY=10` 后通过

---

## 遗留 / 可选改进
- 代理 client 用 `OnceLock`，改地址要重启。若要热更新，需把 `proxy_http_client()` 返回类型从 `&'static Client` 改为 `Arc<RwLock<Client>>`，涉及所有调用点（commands/codex.rs 等），改动较大，暂未做。
- `reqwest` 同时编译了 native-tls(default) 和 rustls-tls，二进制略增。若要精简，可 `default-features = false` + 显式列默认 feature，但要补偿 `charset`/`http2` 等，风险较高，暂不动。
- updater 签名错误（无 `TAURI_SIGNING_PRIVATE_KEY`）仍在末尾，不影响安装包，本地自用可忽略。
