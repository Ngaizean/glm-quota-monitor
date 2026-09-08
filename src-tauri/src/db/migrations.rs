pub const MIGRATION_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    alias       TEXT NOT NULL,
    purpose     TEXT NOT NULL DEFAULT '',
    platform    TEXT NOT NULL DEFAULT 'zhipu',
    level       TEXT,
    api_key     TEXT NOT NULL DEFAULT '',
    is_primary  INTEGER DEFAULT 0,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_snapshots (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id          TEXT NOT NULL REFERENCES accounts(id),
    timestamp           TEXT NOT NULL,
    time_limit_pct      REAL,
    time_limit_reset    INTEGER,
    token_limit_pct     REAL,
    token_limit_reset   INTEGER,
    weekly_limit_pct    REAL,
    weekly_limit_reset  INTEGER,
    mcp_limit_pct       REAL,
    mcp_limit_reset     INTEGER,
    total_tokens_24h    REAL,
    total_calls_24h     INTEGER,
    raw_response        TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_account_time
    ON usage_snapshots(account_id, timestamp);

-- DeepSeek 余额快照：绝对货币本位，与 usage_snapshots（百分比）完全解耦。
-- 每币种一行（双币种账号一次拉取写多行，共享同一 timestamp）。
-- total_balance 解析失败的币种不写入（与 converter / 前端过滤语义一致）。
CREATE TABLE IF NOT EXISTS deepseek_snapshots (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id         TEXT NOT NULL REFERENCES accounts(id),
    timestamp          TEXT NOT NULL,
    currency           TEXT NOT NULL DEFAULT 'CNY',
    is_available       INTEGER DEFAULT 1,
    total_balance      REAL,
    granted_balance    REAL,
    topped_up_balance  REAL,
    raw_response       TEXT
);

CREATE INDEX IF NOT EXISTS idx_deepseek_snapshots_account_time
    ON deepseek_snapshots(account_id, timestamp);

CREATE TABLE IF NOT EXISTS alert_rules (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_type          TEXT NOT NULL,
    threshold          REAL NOT NULL,
    enabled            INTEGER DEFAULT 1,
    account_id         TEXT REFERENCES accounts(id),
    dedupe_window_mins INTEGER DEFAULT 60
);

CREATE TABLE IF NOT EXISTS alert_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL REFERENCES accounts(id),
    rule_type   TEXT NOT NULL,
    value       REAL,
    triggered_at TEXT NOT NULL,
    dismissed   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS codex_profiles (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('official', 'relay')),
    base_url TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    reasoning_effort TEXT NOT NULL DEFAULT ''
);

	CREATE TABLE IF NOT EXISTS codex_devices (
	    host TEXT PRIMARY KEY,
	    account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
	    follow_local INTEGER NOT NULL DEFAULT 0,
	    model TEXT NOT NULL DEFAULT '',
	    reasoning_effort TEXT NOT NULL DEFAULT '',
	    auto_sync INTEGER NOT NULL DEFAULT 0,
	    status TEXT NOT NULL DEFAULT 'bound',
	    last_sync TEXT,
	    last_error TEXT
	);
"#;

/// 旧版 accounts.api_key 是无默认值的 NOT NULL 列；Codex 多账号体系改由 Keychain
/// 存凭据后，accounts 的写入不再提供该列，旧库上会触发 NOT NULL 约束失败。
/// 检测到旧列定义时重建 accounts 表补上 DEFAULT ''（显式列名拷贝，不依赖列序）。
pub const REBUILD_ACCOUNTS_SQL: &str = r#"
CREATE TABLE accounts_rebuild (
    id          TEXT PRIMARY KEY,
    alias       TEXT NOT NULL,
    purpose     TEXT NOT NULL DEFAULT '',
    platform    TEXT NOT NULL DEFAULT 'zhipu',
    level       TEXT,
    api_key     TEXT NOT NULL DEFAULT '',
    is_primary  INTEGER DEFAULT 0,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
INSERT INTO accounts_rebuild (id, alias, purpose, platform, level, api_key, is_primary, is_active, created_at, updated_at)
    SELECT id, alias, COALESCE(purpose, ''), platform, level, api_key, is_primary, is_active, created_at, updated_at FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_rebuild RENAME TO accounts;
"#;

