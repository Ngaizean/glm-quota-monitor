# Codex 鉴权失败诊断

**仓库**: glm-quota-monitor | **Session**: debug | **日期**: 2026-07-06
**症状**: codex 鉴权报 `查询 Gist 失败：error sending request for url (https://api.github.com/gists/30e3f0d216159f34774f...)`

---

## 结论：双重根因，配置层只能修一半，必须改代码

### 根因 1：默认代理端口错误（导致当前 resolve 报错）

`src-tauri/src/lib.rs:37`：
```rust
const DEFAULT_PROXY_URL: &str = "http://127.0.0.1:7897";
```

`proxy_http_client()`（lib.rs:62）在数据库无 `codex_proxy` 记录时，强制走 7897。但本机代理软件实际监听 **7890**（netstat 实测）：

| 端口 | netstat 监听 | curl 走该代理访问 GitHub |
|---|---|---|
| 7897（代码默认） | ❌ 未监听 | ❌ connection refused |
| 7890（实际） | ✅ LISTENING | ✅ HTTP 200 |

→ reqwest 连 127.0.0.1:7897 被拒 → `error sending request for url`。

**且前端无代理设置 UI**（grep `src/` 全空），后端 `set_codex_proxy` 命令存在但无界面调用，用户无法自行改端口。

### 根因 2：Windows native-tls 证书吊销检查失败（导致 fetch 必失败）

Cargo.lock 确认 reqwest 走 **native-tls**（= Windows schannel）。schannel 默认做证书吊销检查（CRL/OCSP），本机连不上吊销服务器：

```
curl 走 7890 代理访问 gist.githubusercontent.com（默认吊销检查）:
  → CRYPT_E_REVOCATION_OFFLINE (0x80092013)  TLS 握手失败

curl 走 7890 代理 + --ssl-no-revoke（= rustls 行为）:
  → HTTP 301  成功
```

| 阶段 | 域名 | native-tls（当前） | rustls（修复后） |
|---|---|---|---|
| resolve | api.github.com | ✅（无吊销问题） | ✅ |
| fetch | gist.githubusercontent.com | ❌ 吊销失败 | ✅ |

**关键**：api.github.com 的证书链不触发吊销检查，所以 resolve 直连/走代理都通；gist.githubusercontent.com 的证书链触发吊销 → 失败。即使修好代理端口，fetch 阶段（`fetch_from_gist`）仍会报 `拉取 Gist 失败`。

---

## 为什么"只改数据库代理值"不够

写入 `codex_proxy = http://127.0.0.1:7890` + 重启 → resolve（api.github.com）能通 → 但 fetch（gist.githubusercontent.com）撞吊销 → 仍失败。

配置层只能解决根因 1，根因 2 必须代码层切 TLS 后端。

---

## 代码修复方案（两处改动）

### 改动 A：切 rustls-tls（根治根因 2）

`src-tauri/Cargo.toml`：
```toml
reqwest = { version = "0.12", features = ["json", "system-proxy", "rustls-tls"] }
```
（保留 default-tls，新增 rustls-tls；只让境外 proxy client 用 rustls）

`src-tauri/src/lib.rs` `build_proxy_client`：
```rust
match reqwest::Proxy::all(url) {
    Ok(proxy) => reqwest::Client::builder()
        .use_rustls_tls()        // 新增：绕过 schannel 吊销检查
        .proxy(proxy)
        .build()
        .unwrap_or_else(|_| reqwest::Client::builder().use_rustls_tls().build().unwrap()),
    Err(_) => reqwest::Client::builder().use_rustls_tls().build().unwrap(),
}
```

### 改动 B：修默认代理端口（根治根因 1）

两种做法二选一：
- **B1（简单）**：`DEFAULT_PROXY_URL` 改 `7897` → `7890`。只对应当前环境，换端口仍要重编。
- **B2（推荐，长期）**：保留默认值，但**前端加代理设置输入框**，调 `set_codex_proxy`。以后改端口免重编。UI 加在 `src/CodexPane.tsx`。

改动后需 `npm run tauri build` 重编（增量，reqwest 重编 + 链接，约 5~8 分钟）+ 重装。

---

## 附：诊断命令速查

```bash
# 端口监听
netstat -ano | grep 7890   # 7890 LISTENING，7897 无

# 代理可达性
curl -x http://127.0.0.1:7897 -m5 https://api.github.com/   # 失败
curl -x http://127.0.0.1:7890 -m5 https://api.github.com/   # 200

# 吊销检查（native-tls 病灶）
curl -x http://127.0.0.1:7890 https://gist.githubusercontent.com/            # 吊销失败
curl -x http://127.0.0.1:7890 --ssl-no-revoke https://gist.githubusercontent.com/  # 301
```
