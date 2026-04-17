# GLM Quota Monitor v3.0 — 详细 PRD（修订版）

**版本**: v3.0-r1
**日期**: 2026-04-16
**状态**: 需求修订，待确认
**修订说明**: 基于审阅意见重写，收缩 MVP 范围，明确定义，补齐验收标准

---

## 一、产品概述

GLM Quota Monitor 是一款跨平台桌面应用（macOS / Windows），用于监控大模型 API Key 额度、本机预算分配和受控 Agent 管理。

### 产品定位（修订后）

> **本机多 Key 额度监控 + 预算分配 + 受控 Agent 管理工具**

不做：真多用户共享额度核算系统、跨设备同步、外部 Agent 强控制、不重启热更新 Key。

---

## 二、核心术语定义

| 术语 | 定义 |
|------|------|
| **Key** | 一组 API 凭证（平台 + API Key），对应一个平台的计费账户 |
| **受控 Agent** | 由本应用启动并记录 PID 的 Agent 子进程，本应用对其有完整生命周期控制权 |
| **外部 Agent** | 用户自行启动的 Agent 进程，本应用只能检测和通知，不直接终止 |
| **预算分配** | 本机上为一个 Key 设置的多个虚拟预算槽位，每个槽位有名称和百分比上限 |
| **预算槽位** | 预算分配中的一个条目（如"项目A 40%"），仅用于本地估算，不保证与真实用量精确对应 |
| **可用 Key** | `availability_state = available` 的 Key，即额度未耗尽且最近一次轮询成功的 Key |
| **超额** | Key 的 `percentage >= 100%` 或 `availability_state = exhausted` |
| **额度恢复** | 轮询检测到 Key 的 `percentage` 从 >= 100% 降至 < 100% |
| **切换成功** | 已完成受控 Agent 重启且新 Key 的首次 API 调用返回非认证错误 |
| **切换失败** | 配置写入失败，或重启后首次 API 调用返回认证/平台错误 |

---

## 三、功能模块

### 模块 A：多平台 Key 管理

#### A1. 支持平台

| 平台 | API 格式 | 额度类型 | 支持监控 | 支持 Agent 切换 | 优先级 |
|------|---------|---------|---------|---------------|--------|
| 智谱 (GLM) | 自有 API | 月度 token 包 | MVP | MVP（Claude Code） | MVP |
| OpenAI (GPT) | OpenAI API | 月度 token / 余额 | P1 | P1 | P1 |
| DeepSeek | 兼容 OpenAI API | 月度 token / 余额 | P1 | P1 | P1 |
| Anthropic (Claude) | Anthropic API | 月度 token / 余额 | P1 | P1 | P1 |
| RightCode | 多端点代理 | 未知（需调研） | P2 | P2 | P2 |

#### A2. QuotaProvider 抽象层

```rust
struct QuotaInfo {
    total: Option<f64>,           // 总额度（None 表示未知）
    used: Option<f64>,            // 已用额度
    percentage: f64,              // 使用百分比（始终有值）
    unit: QuotaUnit,              // tokens | credits | unknown
    quota_type: QuotaType,        // monthly_tokens | prepaid_balance | unknown
    availability: Availability,   // available | exhausted | unknown | fetch_failed
    reset_at: Option<DateTime>,   // 重置时间（None 表示未知或不适用）
    supports_reset: bool,         // 该平台是否有额度重置机制
    fetched_at: DateTime,         // 本次数据获取时间
}
```

**关键语义规则**：
- `total` / `used` 为 `None` 时，UI 显示"--"而非 "0"
- `reset_at` 为 `None` 且 `supports_reset = false` 时（如余额制），不显示倒计时，显示"余额制，无周期重置"
- `availability = fetch_failed` 时，保留上次成功获取的数据，标记为"数据可能过时"，附带 `fetched_at` 时间
- **不同 `unit` 的 Key 之间不做排序比较**。UI 上"额度充裕度"排序仅在同 `unit` 内进行
- `availability = unknown` 时（如 RightCode 未调研完成），UI 显示"监控能力待确认"

#### A3. 统一 UI 展示

- 复用现有 Popover 界面，一个列表展示所有 Key
- 每个 Key 卡片显示：
  - 所属平台图标 + 别名
  - 额度信息（根据 `unit` 适配显示格式）
  - 使用百分比进度条（<60% 绿 / 60-85% 黄 / >85% 红 / 数据过时 灰）
  - 重置倒计时（仅 `supports_reset = true` 时显示）
  - 状态标记：数据过时 / 监控能力待确认

---

### 模块 B：本机预算分配（原"拼好模"降级）

#### B1. 产品定义

> **本机预算分配工具**：为单个 Key 设置多个预算槽位，每个槽位有名称和百分比上限。软件根据 Key 总用量和槽位比例做本地估算，不保证跨设备一致或精确到真实用量。

**明确不做**：
- 跨设备数据同步
- 精确到单用户的 token 归因
- 真多用户额度核算

#### B2. 预算槽位配置

- 每个 Key 可创建多个预算槽位
- 每个槽位字段：`名称`（文本）+ `百分比`（数字，所有槽位之和 ≤ 100%）
- 示例：

```
Key: GLM-Production
  ├─ 项目A  40%   [预估剩余: 120,000 tokens]
  ├─ 项目B  40%   [预估剩余: 98,000 tokens]
  └─ 预留   20%   [预估未使用]
```

#### B3. 用量估算规则

**明确标注：所有数据均为本地估算，不反映真实个人用量。**

- 轮询获取 Key 总用量 `total_used`
- 每个槽位的预估已用 = `total_used × (槽位百分比 / 100)`
- 每个槽位的预估剩余 = `(total × 槽位百分比 / 100) - 槽位预估已用`
- UI 上每个槽位标注 `* 估算值`

#### B4. 超额处理

- 预估剩余 < 10% 时：系统通知警告（标注"基于估算"）
- 预估剩余 ≤ 0 时：
  - **受控 Agent**：走模块 D 的停止流程
  - **外部 Agent**：仅弹出通知，不做任何自动操作
- 用户可在设置中关闭"受控 Agent 自动停止"，改为纯通知模式

---

### 模块 C：Key 自动切换（降级方案）

#### C1. 产品定义

> 当受控 Agent 使用的 Key 超额时，软件尝试切换到下一个可用 Key。切换方式为：通知用户 → 受控重启 Agent → 验证新 Key 可用。

**明确不做**：
- 不重启 Agent 的热更新 Key
- 跨平台自动切换（MVP 阶段仅同平台）
- 对外部 Agent 的自动切换

#### C2. 兼容矩阵

| Agent | 支持监控的平台 | Key 注入方式 | 支持热重载 | MVP 切换方式 |
|-------|--------------|-------------|-----------|-------------|
| Claude Code | GLM (MVP) | 环境变量 `ANTHROPIC_API_KEY` | 不确定 | 受控重启 |
| Cursor | 待定 | 应用配置 | 不确定 | P1 |
| Codex | 待定 | 环境变量 | 不确定 | P2 |
| GitHub Copilot | 待定 | VS Code settings.json | 不确定 | P2 |

#### C3. Key 优先级列表

- 每个 Agent 配置一个 Key 有序列表（仅限同平台 Key）
- 列表可拖拽排序
- 每个 Key 显示当前状态：可用 / 已超额 / 数据过时

#### C4. 切换策略

1. **同平台优先级排序**：按用户配置的优先级顺序选择第一个 `availability = available` 的 Key
2. **不跨 unit 比较**：不同额度类型的 Key 之间不做"充裕度"排序
3. **数据过时的 Key**：`fetch_failed` 的 Key 参与排序但标记警告，排在可用 Key 之后

#### C5. 切换流程

```
轮询检测到当前 Key 超额
    │
    ├─ 查找同平台优先级列表中下一个 available 的 Key
    │
    ├─ 找到可用 Key →
    │     ├─ 1. 系统通知："Key-A 额度已用完，准备切换到 Key-B"
    │     ├─ 2. 备份当前 Agent 配置文件
    │     ├─ 3. 写入新 Key 到 Agent 配置文件
    │     ├─ 4. 受控重启 Agent（SIGTERM → 等待 → 重启）
    │     ├─ 5. 等待 Agent 首次 API 调用
    │     ├─ 6a. 调用成功 → 切换状态: switch_verified → 继续监控
    │     └─ 6b. 调用失败 → 切换状态: switch_failed → 回滚配置 → 通知用户
    │
    └─ 所有 Key 都超额 →
          ├─ 1. 系统通知："所有 Key 额度已用完"
          └─ 2. 触发 Agent 停止流程（模块 D）
```

#### C6. 切换状态机

```
switch_idle         默认状态
  ↓ 检测到超额
switch_attempted    已发起切换
  ↓ 配置写入成功
switch_applied      配置已写入
  ↓ Agent 重启成功
switch_applied      等待验证
  ↓ 首次 API 调用成功              ↓ 首次 API 调用失败
switch_verified     切换成功      switch_failed → 回滚配置 → switch_idle
```

#### C7. 配置文件操作安全

- 写入前先备份原文件（`{filename}.glm-monitor.bak`）
- 写入失败 → 不删除备份，通知用户，状态: switch_failed
- 回滚时从备份恢复
- 备份文件保留 24 小时后自动清理

---

### 模块 D：Agent 自动控制

#### D1. Agent 分类

| 类型 | 启动方式 | 控制权限 | MVP 支持 |
|------|---------|---------|---------|
| **受控 Agent** | 由本应用启动，记录 PID、命令、工作目录、环境变量 | 完整生命周期（启动/停止/重启） | MVP |
| **外部 Agent** | 用户自行启动 | 仅检测运行状态 + 通知 | MVP |

**核心原则**：
- MVP 只终止受控 Agent（有 PID 记录的子进程）
- 外部 Agent 只做检测和通知，**绝不自动终止**
- 按进程名匹配仅用于"检测是否运行"，不用于"决定是否终止"

#### D2. 受控 Agent 启动

- 用户在设置中配置 Agent 启动参数：
  - 可执行文件路径
  - 命令行参数
  - 工作目录
  - 环境变量（含 API Key）
- 本应用作为父进程启动 Agent，记录 PID 和完整启动信息
- 启动信息持久化，用于重启恢复

#### D3. Agent 会话记录

```sql
-- 每次启动生成一条记录
CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    agent_type TEXT NOT NULL,
    pid INTEGER,                      -- 进程 ID（受控 Agent 有值）
    launch_mode TEXT NOT NULL,         -- 'managed' | 'external'
    executable_path TEXT,              -- 可执行文件路径
    args TEXT,                         -- JSON 数组：命令行参数
    cwd TEXT,                          -- 工作目录
    env_snapshot TEXT,                 -- JSON：环境变量快照（脱敏后）
    account_id TEXT REFERENCES accounts(id),  -- 绑定的 Key
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    end_reason TEXT                    -- 'manual' | 'quota_exhausted' | 'crashed' | 'unknown'
);
```

#### D4. 停止流程（仅受控 Agent）

```
触发条件：额度耗尽 且 agent_sessions.launch_mode = 'managed'
    │
    ├─ 1. 系统通知："额度已用完，30秒后将终止 Agent，请保存工作"
    │       （通知中包含 Agent 名称、使用的 Key、剩余等待时间）
    │
    ├─ 2. 等待 30 秒
    │
    ├─ 3. 发送 SIGTERM（Windows: WM_CLOSE）
    │
    ├─ 4. 等待 30 秒
    │
    ├─ 5. 检查进程是否退出
    │     ├─ 已退出 → 记录 end_reason = 'quota_exhausted'
    │     └─ 未退出 → 发送 SIGKILL（Windows: TerminateProcess）
    │                  记录 end_reason = 'force_killed'
    │
    └─ 对于 launch_mode = 'external' 的 Agent：
         仅弹出通知，不执行任何终止操作
```

#### D5. 恢复流程（MVP：仅提示）

- 额度恢复后：弹出系统通知"Key-X 额度已恢复"
- 如有受控 Agent 的历史启动记录：通知中附带"点击重新启动"按钮
- MVP 不做自动重启，用户需手动确认
- 重启时从 `agent_sessions` 中读取上次的启动参数

---

## 四、MVP 范围

### MVP 目标

> 基于 GLM 平台，实现：Key 监控 + 本机预算分配 + 受控 Claude Code 管理 + 同平台 Key 切换

### MVP 包含

- [x] GLM 单平台额度监控（已有）
- [ ] 多 Key 管理（添加/编辑/删除，同平台多个 Key）
- [ ] 本机预算槽位配置（名称 + 百分比，本地估算展示）
- [ ] Key 优先级列表配置（拖拽排序，同平台）
- [ ] 受控 Claude Code 启动（记录 PID、命令、环境变量）
- [ ] 受控 Claude Code 停止（SIGTERM → SIGKILL）
- [ ] Key 超额自动切换（受控重启 + 验证 + 回滚）
- [ ] 超额警告通知（预算槽位 + Key 级别）
- [ ] 额度恢复通知 + 手动重启入口
- [ ] 外部 Agent 检测 + 纯通知

### MVP 不包含

- [ ] 其他平台支持（OpenAI / DeepSeek / Anthropic / RightCode）
- [ ] 跨平台 Key 自动切换
- [ ] 跨设备数据同步
- [ ] 精确到单用户的 token 归因
- [ ] 不重启 Agent 的热更新 Key
- [ ] 其他 Agent 支持（Cursor / Copilot / Codex）
- [ ] Agent 自动重启（仅提示）
- [ ] 本地用户系统（MVP 无需登录，预算槽位不需要用户隔离）

---

## 五、技术方案

### 5.1 架构

- 保持当前 Tauri 2.0 桌面应用架构
- Rust 后端 + React 前端
- SQLite 本地存储

### 5.2 新增模块

| 模块 | 文件 | 说明 |
|------|------|------|
| `providers/mod.rs` | `src-tauri/src/providers/` | QuotaProvider trait 定义 |
| `providers/zhipu.rs` | `src-tauri/src/providers/` | 智谱平台实现 |
| `agent.rs` | `src-tauri/src/agent.rs` | Agent 进程管理（启动/停止/检测） |
| `budget.rs` | `src-tauri/src/budget.rs` | 本机预算分配逻辑 |
| `switch.rs` | `src-tauri/src/switch.rs` | Key 切换状态机 |
| `BudgetPanel.tsx` | `src/budget/` | 预算分配前端 UI |
| `AgentPanel.tsx` | `src/agent/` | Agent 管理前端 UI |

### 5.3 数据库变更

新增表：

```sql
-- 预算槽位（替代原 share_members）
CREATE TABLE budget_slots (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    name TEXT NOT NULL,                     -- 槽位名称（如"项目A"）
    percentage REAL NOT NULL CHECK(percentage > 0 AND percentage <= 100),
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Key 优先级列表（替代原 agent_configs 中的单 account_id）
CREATE TABLE agent_key_priorities (
    id TEXT PRIMARY KEY,
    agent_type TEXT NOT NULL,               -- 'claude_code' | ...
    account_id TEXT NOT NULL REFERENCES accounts(id),
    priority INTEGER NOT NULL,              -- 排序（小 = 优先）
    enabled INTEGER DEFAULT 1,              -- 是否参与自动切换
    UNIQUE(agent_type, account_id)
);

-- Agent 会话记录
CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    agent_type TEXT NOT NULL,
    pid INTEGER,
    launch_mode TEXT NOT NULL CHECK(launch_mode IN ('managed', 'external')),
    executable_path TEXT,
    args TEXT,                              -- JSON
    cwd TEXT,
    env_snapshot TEXT,                      -- JSON（API Key 脱敏）
    account_id TEXT REFERENCES accounts(id),
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    end_reason TEXT
);

-- 切换事件日志
CREATE TABLE switch_events (
    id TEXT PRIMARY KEY,
    agent_type TEXT NOT NULL,
    from_account_id TEXT REFERENCES accounts(id),
    to_account_id TEXT REFERENCES accounts(id),
    reason TEXT NOT NULL,                   -- 'quota_exhausted' | 'manual'
    status TEXT NOT NULL,                   -- 'attempted' | 'applied' | 'verified' | 'failed'
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    verified_at TEXT
);

-- 轮询记录（用于调试和审计）
CREATE TABLE quota_poll_records (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    provider_total REAL,
    provider_used REAL,
    percentage REAL,
    availability TEXT NOT NULL,             -- 'available' | 'exhausted' | 'unknown' | 'fetch_failed'
    fetched_at TEXT DEFAULT (datetime('now')),
    fetch_duration_ms INTEGER,
    error_message TEXT
);
```

### 5.4 安全方案

#### API Key 存储

- 继续使用系统凭据管理器（macOS Keychain / Windows Credential Manager）
- 数据库中不存储明文 Key
- 现有 `crypto.rs` 模块已有实现

#### 配置文件操作

- 写入前备份原文件（`{filename}.glm-monitor.bak`）
- 备份 24 小时自动清理
- 回滚时从备份恢复

---

## 六、验收标准

### A. 额度监控

| 场景 | 验收标准 |
|------|---------|
| 正常轮询 | ≤ 轮询间隔内（默认 5 分钟）数据更新 |
| API 失败 | 显示上次成功数据 + "数据过时"标记 + `fetched_at` 时间 |
| 重置时间未知 | 显示"余额制"或不显示倒计时 |
| 额度单位不同 | UI 不做跨单位排序 |

### B. 预算分配

| 场景 | 验收标准 |
|------|---------|
| 槽位创建 | 名称 + 百分比，总和不超 100% |
| 用量估算 | 显示 `* 估算值` 标记 |
| 预算耗尽 | 系统通知（标注"基于估算"） |

### C. Key 切换

| 场景 | 验收标准 |
|------|---------|
| 切换触发 | Key 超额后 ≤ 1 个轮询周期内发起 |
| 配置写入 | 写入前备份，失败时通知用户 + 不删除备份 |
| 切换验证 | Agent 重启后首次 API 调用判定成功/失败 |
| 切换失败 | 自动回滚配置文件 + 通知用户 |
| 全部超额 | 通知用户 + 触发受控 Agent 停止 |

### D. Agent 控制

| 场景 | 验收标准 |
|------|---------|
| 受控启动 | 记录 PID + 启动参数，成功后状态"运行中" |
| 受控停止 | SIGTERM → 30s → SIGKILL，记录 end_reason |
| 外部检测 | 检测到外部 Agent → 仅通知，不终止 |
| 配置写入失败 | 不修改原文件，通知用户 |
| 进程终止失败 | 日志记录，通知用户"终止失败，请手动处理" |

### E. 异常处理

| 场景 | 验收标准 |
|------|---------|
| 数据库迁移失败 | 弹出错误信息，应用不崩溃 |
| 轮询连续失败 3 次 | 显示"监控异常"状态 + 最近一次成功数据 |
| Agent 进程意外退出 | 检测到后更新会话记录 end_reason = 'crashed' |

---

## 七、开发路线

| 阶段 | 内容 | 复杂度 |
|------|------|--------|
| **Phase 1** | QuotaProvider 抽象层 + GLM 适配 | 中 |
| **Phase 2** | 多 Key 管理 + 预算槽位配置 + UI | 中 |
| **Phase 3** | 受控 Agent 启动/停止 + 会话记录 | 高 |
| **Phase 4** | Key 优先级 + 自动切换状态机 + 回滚 | 高 |
| **Phase 5** | 外部 Agent 检测 + 通知集成 | 低 |
| **Phase 6** | MVP 集成测试 + 修复 | 验收 |

---

## 八、待确认 / 风险

| 项目 | 说明 | 应对措施 |
|------|------|---------|
| 智谱 API 用量查询精度 | 需确认是否提供精确的已用 token 查询接口 | Phase 1 调研，如不支持则 `total/used` 为 `None` |
| RightCode API 文档 | 额度查询接口未调研 | 移至 P2 |
| Windows 进程终止 | CLI 程序可能不响应 WM_CLOSE | 改用 `TerminateProcess`，记录 force_killed |
| Claude Code 配置文件位置 | 不同版本路径可能不同 | Phase 3 调研，支持用户自定义路径 |
| 受控重启恢复不完整 | 无法恢复 Agent 的对话上下文 | MVP 接受此限制，UI 上明确提示 |
| 预算估算偏差 | 本地估算与真实用量不一致 | UI 明确标注"估算值"，不承诺精确 |

---

## 九、与初版 PRD 的变更对照

| 项目 | 初版 | 修订版 | 原因 |
|------|------|--------|------|
| "拼好模" | 多用户共享 Key，精确额度核算 | 本机预算槽位估算 | 无云同步无法实现真实核算 |
| 用户系统 | 本地用户名 + 密码 | MVP 不需要 | 预算槽位不需要用户隔离 |
| Key 切换 | 热更新 Agent 配置文件 | 受控重启 + 验证 | 热更新依赖 Agent 实现，不稳定 |
| Agent 控制 | 按进程名匹配 + 自动 kill | 仅终止受控子进程（有 PID） | 避免误杀外部进程 |
| 自动恢复 | 额度恢复后自动重启 Agent | 仅通知 + 手动重启入口 | 无法完整恢复上下文 |
| 跨平台切换 | Agent 列表可包含不同平台 Key | MVP 仅同平台 | 跨平台兼容性不确定 |
