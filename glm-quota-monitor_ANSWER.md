# 代理设计是否必须 + 原设计是怎样的

**仓库**: glm-quota-monitor | **Session**: design-q&a | **日期**: 2026-07-06

---

## 一、先看事实：应用到底访问哪些端点

代码里两个 HTTP client，各管一摊：

| client | 用途 | 端点（代码出处） | 大陆可达性 |
|---|---|---|---|
| `HTTP_CLIENT`（直连） | 智谱 GLM | `open.bigmodel.cn`（api/client.rs:4）、`open.bigmodel.cn/api/anthropic`（agent.rs:75） | ✅ 国内，直连 |
| `PROXY_CLIENT`（走代理） | Codex 额度 | `chatgpt.com/backend-api/wham/usage`（codex/client.rs:4） | ❌ **被墙** |
| | Codex token 刷新 | `auth.openai.com/oauth/token`（codex/auth.rs:92） | ❌ **被墙** |
| | Gist 同步 | `api.github.com` + `gist.githubusercontent.com`（codex/sync.rs） | ⚠️ 直连不稳 |

---

## 二、代理是否必须？

**分功能看，不是一刀切：**

- **智谱额度监控**：完全不需要代理。走 `HTTP_CLIENT` 直连，国内端点。
- **Codex 额度监控**：在大陆**实质上必须有代理**——`chatgpt.com` 和 `auth.openai.com` 被墙，直连一定失败。这不是设计选择，是网络硬约束。
- **Gist 鉴权同步**：不必须。GitHub 直连通常可达，代理只是更稳（也是本次 fetch 阶段吊销问题的来源）。

**所以"代理设计必须吗"的精确答案：**
> Codex 这条线在大陆绕不开代理；但"在应用代码里**硬编码代理端口**"这个具体做法不是必须的，有更优雅的替代（见第四节）。

---

## 三、原来的设计是怎样的

代码现状（lib.rs:30-64）揭示的原设计意图：

1. **双 client 分流**（注释 lib.rs:32-33 原文）：
   - `HTTP_CLIENT = reqwest::Client::new()` → 智谱直连
   - `PROXY_CLIENT`（OnceLock）→ codex/gist 走代理
   - 理由：国内端点不该绕代理（慢、且代理可能不计费国内流量），境外端点必须绕代理

2. **默认代理硬编码 `http://127.0.0.1:7897`**（原值，本次改成 7890）：
   - 7897 是 **Clash Verge / Mihomo 的混合端口**（macOS 协作者 Ngaizean 的取向）
   - 经典 Clash for Windows 用 7890——所以原默认值对 Windows 用户经常不匹配（本次 bug 根源）

3. **前端无代理配置 UI**：后端有 `set_codex_proxy`/`get_codex_proxy` 命令，但前端从未接线。用户改不了端口，只能重编。**本次新加了 UI。**

4. **代理 client 用 `OnceLock`**：启动时读一次数据库，之后不可变——改地址要重启 app。

**原设计的隐含假设**：用户开着 Clash，且监听 7897（macOS Verge 默认）。在 macOS 协作者机器上自洽，搬到 Windows + 7890 就炸了。

---

## 四、如果想去掉"应用层代理逻辑"，有这些替代

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. TUN/系统代理 + 应用直连** | 用户在 Clash 开 TUN 模式（或设 Windows 系统代理），应用全部 `reqwest::Client::new()` 直连，OS 透明代理 | 应用代码删掉所有代理逻辑，最干净 | 要求用户会配 TUN；reqwest 默认不读 Windows 注册表代理，需 TUN（网络层）才有效 |
| **B. reqwest 读环境变量** | 删掉硬编码，靠 reqwest 的 `system-proxy` feature 读 `HTTPS_PROXY` 环境变量 | 零硬编码 | Windows 用户一般不设这些 env（Clash 不自动设），等于没代理 |
| **C. 直连 + 失败回退代理** | 先直连，超时再走代理 | 自适应 | codex 直连必失败，每次回退，慢且日志脏 |
| **D. 保留显式代理 + UI（当前）** | 默认 7890 + UI 可改 | 明确可控、不依赖系统配置 | 用户必须开 HTTP 代理软件 |

**我的建议**：保持现状（方案 D）是最务实的——你已经开了 Clash（7890 在听），显式代理最稳、最不依赖用户系统配置。如果想极致简化代码，**方案 A（让用户开 TUN，应用直连）** 是唯一能真正"删掉代理代码"的路子，但代价是把网络责任转嫁给用户的 Clash 配置。对个人/小团队工具，不值得。

---

## 附：本次会话已落地的改动（上一轮）
Cargo.toml(+rustls-tls) · lib.rs(7897→7890 + use_rustls_tls) · CodexPane.tsx(代理 UI) · zh/en.json(文案)。已重编译重装，你确认"网络通了"。
