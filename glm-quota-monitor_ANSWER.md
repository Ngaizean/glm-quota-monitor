# Codex CLI: refresh token was revoked

**仓库**: glm-quota-monitor | **Session**: debug | **日期**: 2026-07-06
**现象**: codex CLI 报
`⚠ Falling back from WebSockets to HTTPS transport. request timed out`
`■ Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.`

---

## 一、这不是应用 bug，是凭证在服务端失效

本机 `~/.codex/auth.json` 实测（只读元信息，未读 token 值）：

| 项 | 值 | 含义 |
|---|---|---|
| 修改时间 | 2026-07-06 19:41 | sync 确实更新了本机文件 ✅ |
| access_token exp | 2026-07-16 | 本地看**还没过期** |
| refresh_token | 存在 | — |

**但 codex CLI 报 `revoked`** → 矛盾说明：这套凭证（access + refresh）在 **OpenAI 服务端被主动吊销**，本地 exp 只是理论有效期，服务端可以随时作废。

**关键认知**：sync 成功 ≠ token 有效。应用只是把 gist 里的（已失效的）凭证复制到本机。这印证了 `WINDOWS_TEST_REPORT.md` 的遗留风险——"gist 里的凭证是旧的/失效的，待 owner 重新 login 上传有效凭证"。

---

## 二、为什么会被吊销

最可能的原因（OpenAI codex 的 OAuth 行为）：
1. **单会话吊销**：owner 在别处（或本机）重新 `codex login`，新登录会**吊销之前的 refresh_token**——这是 OAuth token rotation 的常见行为
2. **安全事件延续**：上次 gist_meta.json 泄露事件中，本机 refresh_token 曾被主动吊销（见 WINDOWS_TEST_REPORT 第三节）；如果 gist 里上传的还是那套旧凭证，就一直是失效的
3. 账号安全策略主动吊销

不管哪种，结论一样：**需要重新登录拿新凭证**。

---

## 三、两条错误信息分别是什么

| 信息 | 含义 | 性质 |
|---|---|---|
| `refresh token was revoked` | 凭证服务端失效 | **核心矛盾**，必须重新 login |
| `Falling back from WebSockets to HTTPS / request timed out` | codex CLI 连 chatgpt.com 超时 | 次要：codex CLI **不走应用的 7890 代理**，自己没配代理 → 访问 chatgpt.com 被墙超时 |

即使修好网络（给 codex 配代理），token revoked 还是登不上。所以**先解决凭证，网络是配套**。

---

## 四、解决步骤

### 步骤 1：给 codex CLI 配代理（解决 timeout）
codex CLI 是独立程序，不读应用的代理设置，要单独配。在终端设环境变量：
```bash
# Git Bash / WSL
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890

# 或 Windows cmd/PowerShell
set HTTPS_PROXY=http://127.0.0.1:7890
```
（codex 读 `HTTPS_PROXY` 出境。clash 要开着监听 7890）

### 步骤 2：重新登录（解决 revoked）
```bash
codex login
```
这是交互式 OAuth（开浏览器）。在本会话里可以用：
```
! HTTPS_PROXY=http://127.0.0.1:7890 codex login
```
登录成功后本机 `~/.codex/auth.json` 更新为有效凭证，codex CLI 立即可用。

### 步骤 3（仅 owner）：把新凭证上传 gist 供其他设备同步
本机应用 → Codex 设置 → 角色=owner → 填 Gist URL + GitHub Token → 点「上传鉴权文件」。
其他 consumer 设备再 sync 就能拿到这套新凭证。

---

## 五、如果你是 consumer（不是 codex 账号拥有者）
本机 `codex login` 你没权限（不是你的账号）。需要 owner（Ngaizean）在他的机器执行步骤 2+3，重新 upload 有效 gist，你这边再 sync。

---

## 附：与本次应用修复的关系
应用侧（rustls + 默认代理 7890 + 代理 UI）已经修好——你确认"网络通了"。本次 codex CLI 报错是**另一层**问题（凭证失效 + codex CLI 自身没配代理），不在应用的可修复范围内，需要按上面步骤在本机处理 codex CLI 本身。
