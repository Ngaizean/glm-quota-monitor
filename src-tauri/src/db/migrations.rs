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
"#;
