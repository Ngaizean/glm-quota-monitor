# 协作规范 — GLM Quota Monitor

## 团队成员

| 成员 | GitHub | 负责平台 | 角色 |
|---|---|---|---|
| Ngaizean | [@Ngaizean](https://github.com/Ngaizean) | macOS | 项目负责人 / macOS 开发 |
| 余泓麟 | [@Alidadei](https://github.com/Alidadei) | Windows | Windows 开发 |

## 仓库地址

https://github.com/Ngaizean/glm-quota-monitor

## 分支策略

```
main          ← 稳定代码，仅通过 PR 合入
dev           ← 日常开发分支
feature/*     ← 功能分支（如 feature/quota-api）
fix/*         ← 修复分支（如 fix/windows-tray-crash）
```

### 工作流
1. 从 `dev` 拉最新代码：`git checkout dev && git pull`
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 开发 + 提交
4. 推送并提 PR 到 `dev`：`git push origin feature/your-feature`
5. 对方 review 后合并
6. `dev` 稳定后合并到 `main`

## 平台分工

### 共享代码（Rust 后端 + 公共逻辑）
- API 客户端（智谱监控接口，API Key Bearer Token 认证）
- 数据库模块（SQLite schema、CRUD）
- 预警引擎（规则匹配、去重）
- 加密模块（API Key AES-256-GCM 加密，密钥存系统 Keychain/Credential Manager）
- IPC 命令定义

### Ngaizean 负责（macOS）
- Tauri macOS 特定配置（LSUIElement=true 纯菜单栏应用）
- macOS 状态栏图标 + Popover 无边框窗口
- macOS 系统通知（Notification Center）
- macOS Keychain 集成（keychain-rs）
- macOS 构建打包（DMG + 代码签名）

### Alidadei 负责（Windows）
- Tauri Windows 特定配置
- Windows 系统托盘 + 通知（Action Center）
- Windows Credential Manager 集成（keychain-rs 自动适配）
- Windows 构建打包（MSI / NSIS）

### 共同负责
- 前端 UI（React，确保跨平台一致性）
- 联调与测试
- 文档维护

## 提交规范

```
<type>(<scope>): <description>

# 示例
feat(api): add quota limit endpoint client
fix(db): handle migration on first launch
feat(ui): dashboard quota cards
fix(tray): notification not showing on macOS
docs: update collaboration guide
```

| type | 说明 |
|---|---|
| feat | 新功能 |
| fix | 修复 |
| docs | 文档 |
| refactor | 重构 |
| test | 测试 |
| chore | 构建/工具链 |

## PR 规范
- 标题格式：`[平台] 功能描述`，如 `[macOS] 实现系统托盘常驻`
- 描述中说明改动内容、测试方式
- 至少 1 人 review 通过后合并
- 解决冲突后 rebase（不要 merge）

## 沟通方式
- **GitHub Issues** — Bug 报告、功能讨论
- **GitHub PR** — 代码 review
- **微信 / 邮件** — 紧急沟通
- **项目文档** — `docs/` 目录下维护

## 开发环境
- **框架**: Tauri 2.0（Rust + React + TypeScript）
- **包管理**: npm（前端）+ cargo（后端）
- **数据库**: SQLite
- **Node**: >= 18
- **Rust**: >= 1.70

## 项目目录结构（更新版）

```
glm-quota-monitor/
├── docs/                    # 文档
│   ├── PRD.md               # 产品需求文档
│   └── COLLABORATION.md     # 本协作文档
├── src/                     # React 前端（跨平台共享）
│   ├── App.tsx
│   ├── pages/
│   ├── components/
│   └── ...
├── src-tauri/               # Rust 后端（跨平台共享）
│   ├── src/
│   │   ├── api/             # 智谱 API 客户端
│   │   ├── db/              # 数据库
│   │   ├── alert/           # 预警引擎
│   │   ├── commands/        # Tauri IPC 命令
│   │   ├── platform/        # 平台特定代码 ⭐
│   │   │   ├── mod.rs
│   │   │   ├── macos.rs     # Ngaizean
│   │   │   └── windows.rs   # Alidadei
│   │   ├── crypto.rs
│   │   └── tray.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .github/
│   └── PULL_REQUEST_TEMPLATE.md
└── README.md
```

## 开发路线图（含分工）

### Phase 1：MVP（v0.1）
| 任务 | 负责人 | 优先级 |
|---|---|---|
| Rust 后端 API 客户端 | 共同 | P0 |
| 数据库模块 | 共同 | P0 |
| 前端 UI 框架搭建 | 共同 | P0 |
| API Key 账号管理（macOS 纯菜单栏） | Ngaizean | P0 |
| API Key 账号管理（Windows 托盘） | Alidadei | P0 |
| 状态栏 + Popover（macOS） | Ngaizean | P0 |
| 系统托盘（Windows） | Alidadei | P0 |

### Phase 2：统计与预警（v0.2）
| 任务 | 负责人 | 优先级 |
|---|---|---|
| 历史数据采集 + 存储 | 共同 | P0 |
| 前端图表 | 共同 | P1 |
| 预警引擎 | 共同 | P1 |
| 系统通知（macOS） | Ngaizean | P1 |
| 系统通知（Windows） | Alidadei | P1 |

### Phase 3：发布（v1.0）
| 任务 | 负责人 | 优先级 |
|---|---|---|
| macOS 打包 + 签名 | Ngaizean | P0 |
| Windows 打包（MSI） | Alidadei | P0 |
| GitHub Release | Ngaizean | P0 |
