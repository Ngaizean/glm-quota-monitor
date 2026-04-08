pub const MIGRATION_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    alias       TEXT NOT NULL,
    platform    TEXT NOT NULL DEFAULT 'zhipu',
    level       TEXT,
    api_key     TEXT NOT NULL,
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
    mcp_limit_pct       REAL,
    mcp_limit_reset     INTEGER,
    total_tokens_24h    INTEGER,
    total_calls_24h     INTEGER,
    raw_response        TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_account_time
    ON usage_snapshots(account_id, timestamp);

CREATE TABLE IF NOT EXISTS alert_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_type   TEXT NOT NULL,
    threshold   REAL NOT NULL,
    enabled     INTEGER DEFAULT 1,
    account_id  TEXT REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS alert_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL REFERENCES accounts(id),
    rule_type   TEXT NOT NULL,
    value       REAL,
    triggered_at TEXT NOT NULL,
    dismissed   INTEGER DEFAULT 0
);
"#;
