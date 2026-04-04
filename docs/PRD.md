# GLM Quota Monitor — 产品需求文档 (PRD)

## 产品名称
GLM Quota Monitor（暂定）

## 产品定位
一款跨平台（macOS / Windows）桌面工具，专注智谱 GLM Coding Plan 的额度管理、用量统计、多账号管理和智能预警。

## 目标用户
- 使用智谱 GLM Coding Plan（Lite / Pro / Max）的开发者
- 拥有多个 GLM 账号/API Key 的用户
- 需要精细化管控 API 支出的个人或小团队

---

## MVP 功能点（v0.1）

### F1：国内智谱平台额度查询

#### 用户故事
> 作为一个智谱 GLM Coding Plan 用户，我希望打开软件就能看到我的实时额度消耗，不用每次都打开网页。

#### 功能描述
- 实时展示当前账户的额度信息：
  - **5 小时 Token 窗口**：已用/总量、百分比、进度条、重置倒计时
  - **周额度**：已用/总量、百分比、重置日期
  - **MCP 月度额度**（如适用）：已用次数/总量、重置日期
  - **套餐等级**：Lite / Pro / Max
  - **当前周期**：起止时间
- 后台自动刷新（默认每 5 分钟，可配置 1~30 分钟）
- 展示最近 24h 的模型用量统计（总 token、调用次数）

#### 技术方案
- **登录方式**：嵌入 WebView，用户在应用内登录智谱官网一次，提取 Cookie
- **数据获取**：用 Cookie 调用智谱监控 API
  - `GET /api/monitor/usage/quota/limit` → 额度百分比
  - `GET /api/monitor/usage/model-usage?startTime=&endTime=` → 模型用量
  - `GET /api/monitor/usage/tool-usage?startTime=&endTime=` → MCP 工具用量
- **API 基础地址**：`https://open.bigmodel.cn`
- **Cookie 刷新**：检测到 Cookie 过期（401/空响应）时，提示用户重新登录

#### 返回数据格式（参考）
```json
{
  "code": 200,
  "data": {
    "limits": [
      { "type": "TIME_LIMIT", "percentage": 33, "nextResetTime": 1774663282997 },
      { "type": "TOKENS_LIMIT", "percentage": 32, "nextResetTime": 1773734366338 }
    ],
    "level": "pro"
  }
}
```

---

### F2：历史用量统计

#### 用户故事
> 作为一个重度用户，我想查看过去一周/一月的用量趋势，了解自己的消耗模式，方便规划套餐。

#### 功能描述
- **数据采集**：每次刷新额度时，记录一条快照到本地数据库
  - 时间戳、5h 用量、周用量、MCP 用量、套餐等级
- **历史面板**：
  - 按天/周/月维度展示 token 消耗折线图
  - 支持 7 天 / 30 天 / 90 天 / 自定义范围
  - 鼠标悬停显示具体数值
- **统计摘要**：
  - 日均消耗、峰值消耗、最低消耗
  - 周均消耗趋势（环比上周）
- **数据导出**：导出为 CSV 文件（时间、token 用量、百分比、套餐等级）

#### 数据模型
见下方「数据模型」章节。

#### 技术方案
- 本地 SQLite 存储，应用首次启动时自动建表
- 图表库：前端渲染（Recharts / ECharts）
- 后台刷新时自动写入，无需用户干预

---

### F3：多 Key 跨账号管理

#### 用户故事
> 作为一个拥有多个智谱账号的用户，我希望在一个界面管理所有账号的额度，方便在不同账号间分配工作负载。

#### 功能描述
- **账号列表**：
  - 添加账号（输入账号别名 + 通过 WebView 登录获取 Cookie）
  - 编辑别名、删除账号
  - 每个账号独立显示额度状态
- **总览面板**：
  - 所有账号一览卡片，显示核心指标（套餐等级、5h 用量%、周用量%）
  - 按用量排序 / 按套餐等级筛选
  - 一键刷新全部账号
- **账号详情**：
  - 点击某个账号卡片 → 展开该账号的完整额度面板（同 F1）+ 历史趋势（同 F2）
- **数据隔离**：每个账号的历史数据独立存储

#### 数据模型
```sql
-- 账号表
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,   -- UUID
  alias       TEXT NOT NULL,      -- 用户自定义别名，如 "主账号"、"测试号"
  platform    TEXT NOT NULL,      -- "zhipu"（国内）, "zai"（国际，预留）
  level       TEXT,               -- 套餐等级：lite/pro/max，登录后自动填入
  cookie      TEXT,               -- 加密存储的 Cookie
  is_active   INTEGER DEFAULT 1,  -- 是否启用
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 用量快照表
CREATE TABLE usage_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  timestamp   TEXT NOT NULL,      -- ISO 8601
  -- 额度快照
  time_limit_pct    REAL,         -- 5h 窗口使用百分比
  time_limit_reset  INTEGER,      -- 5h 窗口重置时间戳 (ms)
  token_limit_pct   REAL,         -- 周额度使用百分比
  token_limit_reset INTEGER,      -- 周额度重置时间戳 (ms)
  mcp_limit_pct     REAL,         -- MCP 月度使用百分比（可选）
  mcp_limit_reset   INTEGER,      -- MCP 月度重置时间戳 (ms)
  -- 24h 用量
  total_tokens_24h  INTEGER,      -- 24h 总 token
  total_calls_24h   INTEGER,      -- 24h 总调用次数
  -- 原始响应（便于调试）
  raw_response      TEXT
);

-- 用量快照索引
CREATE INDEX idx_snapshots_account_time ON usage_snapshots(account_id, timestamp);
```

---

### F4：智能预警

#### 用户故事
> 作为一个开发者，我希望在额度快耗尽时自动收到通知，避免工作中断。

#### 功能描述
- **预警规则**（用户可配置）：
  - 5h Token 窗口超过阈值（默认 80%）
  - 周额度超过阈值（默认 90%）
  - MCP 月度额度超过阈值（默认 90%）
  - 5h 窗口即将重置（提前 10 分钟提醒）
- **预警方式**：
  - 应用内弹窗通知
  - 系统级通知（macOS Notification Center / Windows Action Center）
  - 托盘图标变色（绿色 → 黄色 → 红色）
- **预警去重**：
  - 同一规则同一周期内只触发一次（避免重复提醒）
  - 额度重置后自动解除
- **预警配置界面**：
  - 开关每个预警规则
  - 调整阈值百分比
  - 全局开关（一键静音/开启）

#### 数据模型
```sql
CREATE TABLE alert_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type   TEXT NOT NULL,      -- "token_5h" / "weekly" / "mcp_monthly" / "reset_soon"
  threshold   REAL NOT NULL,      -- 阈值百分比 0~100
  enabled     INTEGER DEFAULT 1,  -- 是否启用
  account_id  TEXT REFERENCES accounts(id)  -- NULL = 适用于所有账号
);

CREATE TABLE alert_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  rule_type   TEXT NOT NULL,
  value       REAL,               -- 触发时的实际值
  triggered_at TEXT NOT NULL,
  dismissed   INTEGER DEFAULT 0   -- 用户是否已关闭
);
```

#### 预警逻辑
```
每次刷新额度后:
  for each account:
    for each enabled rule:
      if rule 条件满足 AND 该规则在本周期内未触发过:
        发送通知
        记录到 alert_history
```

---

## 非功能需求

### 安全
- Cookie 加密存储（AES-256-GCM），密钥由系统 Keychain（macOS）/ Credential Manager（Windows）管理
- 不向任何第三方服务器传输数据
- 本地数据库文件权限 600

### 性能
- 应用启动时间 < 3s
- 内存占用 < 100MB（后台运行）
- 首次加载后切换账号面板 < 200ms

### 兼容性
- macOS 12+ (Apple Silicon & Intel)
- Windows 10+

---

## 技术架构概要

```
┌─────────────────────────────────────────────────┐
│                   前端 (Web)                     │
│  React + Tailwind + Recharts                    │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐       │
│  │总览面板│ │历史图表│ │账号管理│ │预警设置│       │
│  └───┬───┘ └───┬───┘ └───┬───┘ └───┬───┘       │
│      └─────────┴─────────┴─────────┘            │
│                     │ Tauri IPC                  │
├─────────────────────┼───────────────────────────┤
│                   后端 (Rust)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ API 模块 │ │ 数据模块 │ │ 预警模块 │         │
│  │ (HTTP)   │ │ (SQLite) │ │ (规则引擎)│         │
│  └────┬─────┘ └──────────┘ └──────────┘         │
│       │                                          │
│  ┌────┴─────┐  ┌──────────┐                     │
│  │ WebView  │  │ 系统托盘  │                     │
│  │ (登录)   │  │ + 通知    │                     │
│  └──────────┘  └──────────┘                     │
└─────────────────────────────────────────────────┘
```

### 模块职责

| 模块 | 职责 | 语言 |
|---|---|---|
| **前端** | UI 渲染、图表、用户交互 | TypeScript + React |
| **API 模块** | HTTP 请求智谱监控接口、Cookie 管理 | Rust |
| **数据模块** | SQLite CRUD、数据聚合查询 | Rust (rusqlite) |
| **预警模块** | 规则匹配、通知发送、去重 | Rust |
| **WebView** | 嵌入登录页面、Cookie 提取 | Tauri 内置 |
| **系统托盘** | 常驻图标、菜单、系统通知 | Tauri 内置 |

### 通信流程
```
用户添加账号 → WebView 打开智谱登录页 → 用户登录成功
→ 提取 Cookie → 加密存储到 DB + Keychain
→ 立即查询一次额度 → 显示在面板

定时刷新（后台）:
→ API 模块用 Cookie 请求监控接口
→ 解析响应 → 写入 usage_snapshots
→ 通过 IPC 推送更新到前端
→ 预警模块检查规则 → 触发通知（如需）
```

---

## 项目结构（建议）

```
glm-quota-monitor/
├── src-tauri/           # Rust 后端
│   ├── src/
│   │   ├── main.rs
│   │   ├── api/         # 智谱 API 客户端
│   │   │   ├── mod.rs
│   │   │   ├── client.rs
│   │   │   └── types.rs
│   │   ├── db/          # 数据库
│   │   │   ├── mod.rs
│   │   │   ├── migrations.rs
│   │   │   └── models.rs
│   │   ├── alert/       # 预警引擎
│   │   │   ├── mod.rs
│   │   │   ├── rules.rs
│   │   │   └── notifier.rs
│   │   ├── commands/    # Tauri IPC 命令
│   │   │   ├── mod.rs
│   │   │   ├── account.rs
│   │   │   ├── quota.rs
│   │   │   └── history.rs
│   │   ├── crypto.rs    # Cookie 加密
│   │   └── tray.rs      # 系统托盘
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                 # React 前端
│   ├── App.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx    # 总览面板
│   │   ├── History.tsx      # 历史统计
│   │   ├── Accounts.tsx     # 账号管理
│   │   └── Alerts.tsx       # 预警设置
│   ├── components/
│   │   ├── QuotaCard.tsx
│   │   ├── ProgressBar.tsx
│   │   ├── UsageChart.tsx
│   │   └── AccountList.tsx
│   ├── hooks/
│   │   ├── useAccounts.ts
│   │   ├── useQuota.ts
│   │   └── useHistory.ts
│   ├── lib/
│   │   └── tauri-commands.ts  # IPC 调用封装
│   └── styles/
├── package.json
├── tsconfig.json
└── README.md
```

---

## 开发路线图

### Phase 1：MVP（v0.1）
- [ ] F1：智谱国内平台额度查询（WebView 登录 + Cookie + 监控 API）
- [ ] F3：多 Key 账号管理（增删改查 + 总览面板）
- [ ] 系统托盘常驻

### Phase 2：统计与预警（v0.2）
- [ ] F2：历史用量统计（本地存储 + 折线图 + CSV 导出）
- [ ] F4：智能预警（规则配置 + 系统通知 + 去重）

### Phase 3：体验优化（v0.3）
- [ ] Z.AI 国际平台支持（API Key 方式，较简单）
- [ ] 费用估算
- [ ] 暗色主题
- [ ] 自动更新

### Phase 4：发布（v1.0）
- [ ] 代码签名 + 公证
- [ ] 安装包（DMG / MSI）
- [ ] GitHub Release
