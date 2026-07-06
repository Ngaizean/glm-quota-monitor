# 代理端口自动探测（取代硬编码默认值）

**仓库**: glm-quota-monitor | **Session**: feat | **日期**: 2026-07-06

---

## 改动：删掉硬编码默认端口，改成启动时自动探测

**`src-tauri/src/lib.rs`**：
- 删 `const DEFAULT_PROXY_URL = "http://127.0.0.1:7890"`
- 新增 `probe_local_proxy_port()`：TCP 连通探测 `[7890, 7897, 10809]`，返回第一个在监听的端口；都不通返回 `None`
- `build_proxy_client` 逻辑变为：
  - 用户填了代理 → 用用户的
  - **没填 → 探测本机端口**，探测到就用 `http://127.0.0.1:{port}`
  - **探测不到 → 直连**（rustls）

```rust
const PROXY_PROBE_PORTS: &[u16] = &[7890, 7897, 10809];

fn probe_local_proxy_port() -> Option<u16> {
    for &port in PROXY_PROBE_PORTS {
        let addr: std::net::SocketAddr = ([127, 0, 0, 1], port).into();
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Some(port);
        }
    }
    None
}
```

**为什么快**：回环端口未监听 → 立即 `ECONNREFUSED`（毫秒级），不会等满 200ms。3 个端口实测几十毫秒。

**i18n**（zh/en）：`proxyPlaceholder` / `proxyDesc` 文案改为「留空自动探测本机端口（7890/7897/10809），探测不到则直连」。

---

## 为什么这样设计

| 之前（硬编码 7890） | 现在（自动探测） |
|---|---|
| 你本机 clash 在 7890 → 碰巧能用 | 探测到 7890 → 用 7890 |
| macOS owner clash 在 7897 → 默认值不匹配，他 pull 代码后要改 | 探测到 7897 → 自动用 7897 |
| 没开 clash → 强制连 7890 失败 | 探测不到 → 直连（不报错） |

**附带好处**：消除了上一轮你担心的「push 代码影响 owner」问题——默认值不再绑死 7890，macOS 协作者 pull 后会自动探测他自己的端口，无需改代码。

---

## 端口覆盖范围
- `7890`：Clash 经典 / Clash for Windows HTTP 混合端口
- `7897`：Clash Verge / Mihomo 默认混合端口
- `10809`：v2rayN 默认 HTTP 端口

覆盖主流代理软件。如果你用别的端口（如 SOCKS 1080 / 自定义），在 UI「代理地址」栏显式填即可，优先级最高。

---

## 当前状态
- ✅ 已重编译（增量 1m25s，0 error）+ 静默重装 + 启动（exe 时间 20:06）
- ✅ 端口探测逻辑生效：本机 7890 在听（netstat 已证）→ app 启动后自动用 7890
- ⚠️ **codex 同步能否成功仍取决于凭证**：上轮的 `refresh token was revoked` 问题没解决（需 owner `codex login` 重新上传有效 gist）。端口探测只修网络层，凭证是另一层。

**验证方法**：app 里点「同步鉴权」，看是否还报 `error sending request`（网络层）。若改成 404 / 解密错误 / revoked，说明网络已通，剩下是凭证问题。
