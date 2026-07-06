# gist 能否不走代理 + clash 开着够不够

**仓库**: glm-quota-monitor | **Session**: design-q&a | **日期**: 2026-07-06

---

## 问题1：gist 不用代理也行？

**技术上行，但实际没意义。**

- ✅ rustls 修复后，github 端点直连是通的（刚验证）：
  - `gist.githubusercontent.com` 直连 → HTTP 301（不走代理，1.0s）
  - `api.github.com` 直连 → HTTP 404（1.1s，404 是 gist ID 问题，网络通）
- ⚠️ 但**当前代码强制 gist 走代理**：`sync.rs` 的 `fetch_from_gist`/`resolve_gist_raw_url` 都接收 `proxy_http_client()`（commands/codex.rs:189,196,197），和 codex 额度查询**共用同一个代理 client**。要 gist 直连得拆分 client。
- ❌ **关键：gist 单独直连没意义**。gist 在这个应用里只为 **codex 鉴权同步**服务；而 codex 额度查询访问 `chatgpt.com`（被墙）**必须代理**。所以只要你用 codex 功能，代理就跑不掉——把 gist 拆出来直连，codex 额度查询照样要代理。

> 一句话：gist 是 codex 流程的一环，codex 整体（chatgpt.com）必须代理，所以 gist 走不走代理不影响"是否需要 clash"。

---

## 问题2：本机开 clash 就行吗？

**是的，而且这就是当前的工作方式。**

- 应用的代理逻辑 = 显式连接 clash 的 HTTP 端口 `127.0.0.1:7890`
- clash 开着（监听 7890）→ 应用经它出境 → 你已验证"网络通了"
- **不需要 TUN 模式、不需要系统代理**——应用自己主动连 clash，不依赖 OS 层配置

换句话说，当前架构里"clash 开着"就是应用正常工作的**前提条件**（对 codex 必须，对 gist 是顺手）。

---

## 结论速览

| 场景 | 需要 clash? |
|---|---|
| 只用智谱额度 | ❌ 不需要（国内直连） |
| 用 codex 额度（chatgpt.com） | ✅ 必须（被墙） |
| gist 同步（为 codex 服务） | ⚠️ gist 本身可直连，但绑在 codex 流程里，clash 开着最省心 |
| **你现在的用法（codex 全功能）** | ✅ **clash 开着即可，已验证** |

只要 clash 开着，当前设计就正常运转，不用改任何东西。
