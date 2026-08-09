pub mod migrations;
pub mod models;

use crate::api::types::QuotaData;
use rusqlite::{Connection, Result as SqlResult};
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: &Path) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(db_path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| rusqlite::Error::InvalidPath(db_path.to_path_buf()))?;
        }
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn init_tables(&self) -> SqlResult<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("DB lock error: {}", e);
                return Err(rusqlite::Error::InvalidPath("数据库锁定".into()));
            }
        };
        conn.execute_batch(migrations::MIGRATION_SQL)?;
        if conn
            .prepare("SELECT purpose FROM accounts LIMIT 0")
            .is_err()
        {
            conn.execute_batch("ALTER TABLE accounts ADD COLUMN purpose TEXT NOT NULL DEFAULT ''")?;
        }
        if conn
            .prepare("SELECT is_primary FROM accounts LIMIT 0")
            .is_err()
        {
            conn.execute_batch("ALTER TABLE accounts ADD COLUMN is_primary INTEGER DEFAULT 0")?;
        }
        if conn
            .prepare("SELECT dedupe_window_mins FROM alert_rules LIMIT 0")
            .is_err()
        {
            conn.execute_batch(
                "ALTER TABLE alert_rules ADD COLUMN dedupe_window_mins INTEGER DEFAULT 60",
            )?;
        }
        if conn
            .prepare("SELECT weekly_limit_pct FROM usage_snapshots LIMIT 0")
            .is_err()
        {
            conn.execute_batch("ALTER TABLE usage_snapshots ADD COLUMN weekly_limit_pct REAL")?;
        }
        if conn
            .prepare("SELECT weekly_limit_reset FROM usage_snapshots LIMIT 0")
            .is_err()
        {
            conn.execute_batch(
                "ALTER TABLE usage_snapshots ADD COLUMN weekly_limit_reset INTEGER",
            )?;
        }
        // 旧版本把 Codex 周额度写进 token_limit_*；迁移时保留原列并复制到新列，
        // 兼容旧历史查询，同时让新版离线回显和活跃检测使用正确窗口。
        conn.execute_batch(
            "UPDATE usage_snapshots
             SET weekly_limit_pct = token_limit_pct,
                 weekly_limit_reset = token_limit_reset
             WHERE weekly_limit_pct IS NULL
               AND account_id IN (SELECT id FROM accounts WHERE platform = 'codex')",
        )?;
        Ok(())
    }

    /// 启动时把数据库里残留的明文 api_key 批量迁移到系统 Keychain，并清空明文。
    /// 新增账号本就写 ''（见 commands::account::add_account），这里只处理老版本遗留。
    /// 单条 store 失败时保留明文（下次启动重试），避免凭据丢失。
    pub fn migrate_legacy_api_keys(&self) -> SqlResult<usize> {
        let rows: Vec<(String, String)> = {
            let conn = self
                .conn
                .lock()
                .map_err(|e| rusqlite::Error::InvalidPath(format!("数据库锁定: {}", e).into()))?;
            let mut stmt = conn.prepare(
                "SELECT id, api_key FROM accounts WHERE api_key != '' AND platform = 'zhipu'",
            )?;
            let iter = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut v = Vec::new();
            for r in iter.flatten() {
                v.push(r);
            }
            v
        };

        let mut migrated = 0usize;
        for (id, key) in rows {
            match crate::crypto::store_api_key(&id, &key) {
                Ok(()) => {
                    if let Ok(conn) = self.conn.lock() {
                        let _ = conn.execute(
                            "UPDATE accounts SET api_key = '' WHERE id = ?1",
                            rusqlite::params![id],
                        );
                    }
                    migrated += 1;
                }
                Err(e) => eprintln!(
                    "迁移账号 {} 的 api_key 到 Keychain 失败: {}（明文保留，下次启动重试）",
                    id, e
                ),
            }
        }
        if migrated > 0 {
            eprintln!("已将 {} 个账号的明文 api_key 迁移到 Keychain", migrated);
        }
        Ok(migrated)
    }
}

/// 记录额度快照 + 更新账号等级（共享逻辑，避免重复代码）
/// today_tokens: 从 get_model_usage 获取的今日 token 用量，用于趋势图
/// today_calls: 今日模型调用次数（Codex 无此概念传 0）
pub fn record_quota_snapshot(
    conn: &Connection,
    account_id: &str,
    quota: &QuotaData,
    today_tokens: f64,
    today_calls: f64,
) -> SqlResult<()> {
    let now = chrono::Local::now().to_rfc3339();
    let time_limit = quota.limits.iter().find(|l| l.limit_type == "TIME_LIMIT");
    let weekly_limit = quota.weekly_token_limit();
    // unit 缺失的旧 API 响应仍按 5 小时窗口保存；仅有周窗口的 Codex 不再重复写入。
    let token_limit = quota
        .five_hour_token_limit()
        .or_else(|| quota.legacy_token_limit());
    let mcp_limit = quota.limits.iter().find(|l| l.limit_type == "MCP_MONTHLY");

    conn.execute(
        "INSERT INTO usage_snapshots (account_id, timestamp, time_limit_pct, time_limit_reset, token_limit_pct, token_limit_reset, weekly_limit_pct, weekly_limit_reset, mcp_limit_pct, mcp_limit_reset, total_tokens_24h, total_calls_24h)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            account_id,
            now,
            time_limit.map(|l| l.percentage),
            time_limit.map(|l| l.next_reset_time),
            token_limit.map(|l| l.percentage),
            token_limit.map(|l| l.next_reset_time),
            weekly_limit.map(|l| l.percentage),
            weekly_limit.map(|l| l.next_reset_time),
            mcp_limit.map(|l| l.percentage),
            mcp_limit.map(|l| l.next_reset_time),
            today_tokens,
            today_calls as i64,
        ],
    )?;

    conn.execute(
        "UPDATE accounts SET level = ?1 WHERE id = ?2",
        rusqlite::params![quota.level, account_id],
    )?;

    Ok(())
}

/// 记录 DeepSeek 余额快照（每币种一行）。
///
/// **仅用于 platform='deepseek' 账号**。绝不与 [`record_quota_snapshot`] 混用——
/// 后者只认 TIME/TOKENS/MCP，会把 DEEPSEEK_BALANCE 静默丢弃并写 NULL 到 usage_snapshots，
/// 污染 GLM 趋势查询。
///
/// 余额一律 coalesce 为 f64 写入（不留 NULL），与 converter 的 unwrap_or(0.0) 语义一致，
/// 保证读回 `row.get::<_, f64>()` 不会因 NULL 列报错。
/// `total_balance` 解析失败的币种跳过（与 balance_info_to_limit / balance_view_entries 一致）。
pub fn record_deepseek_snapshot(
    conn: &Connection,
    account_id: &str,
    balance: &crate::deepseek::types::BalanceResponse,
) -> SqlResult<()> {
    let now = chrono::Local::now().to_rfc3339();
    let raw = serde_json::to_string(balance).unwrap_or_default();
    let is_avail: i32 = if balance.is_available { 1 } else { 0 };

    for info in &balance.balance_infos {
        let total = match info.total_balance.trim().parse::<f64>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let granted = info.granted_balance.trim().parse::<f64>().unwrap_or(0.0);
        let topped = info.topped_up_balance.trim().parse::<f64>().unwrap_or(0.0);
        conn.execute(
            "INSERT INTO deepseek_snapshots (account_id, timestamp, currency, is_available, total_balance, granted_balance, topped_up_balance, raw_response)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                account_id, now, info.currency, is_avail, total, granted, topped, raw,
            ],
        )?;
    }

    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::{record_quota_snapshot, Database};
    use crate::api::types::{QuotaData, QuotaLimit};
    use rusqlite::Connection;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn database_file_permissions_are_restricted_to_the_current_user() {
        let path = std::env::temp_dir().join(format!(
            "glm-quota-monitor-permissions-{}.db",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, []).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        let database = Database::new(&path).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        drop(database);
        let _ = std::fs::remove_file(&path);

        assert_eq!(mode, 0o600);
    }

    #[test]
    fn old_databases_gain_and_backfill_weekly_limit_columns() {
        let path = std::env::temp_dir().join(format!(
            "glm-quota-monitor-weekly-migration-{}.db",
            uuid::Uuid::new_v4()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (
                    id TEXT PRIMARY KEY, alias TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '',
                    platform TEXT NOT NULL DEFAULT 'zhipu', level TEXT, api_key TEXT NOT NULL DEFAULT '',
                    is_primary INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                 );
                 CREATE TABLE usage_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL,
                    timestamp TEXT NOT NULL, time_limit_pct REAL, time_limit_reset INTEGER,
                    token_limit_pct REAL, token_limit_reset INTEGER, mcp_limit_pct REAL,
                    mcp_limit_reset INTEGER, total_tokens_24h REAL, total_calls_24h INTEGER,
                    raw_response TEXT
                 );
                 INSERT INTO accounts (id, alias, platform, created_at, updated_at)
                 VALUES ('codex-1', 'Codex', 'codex', 'now', 'now');
                 INSERT INTO usage_snapshots (account_id, timestamp, token_limit_pct, token_limit_reset)
                 VALUES ('codex-1', 'now', 42.0, 123);",
            )
            .unwrap();
        }

        let database = Database::new(&path).unwrap();
        database.init_tables().unwrap();
        let (pct, reset): (Option<f64>, Option<i64>) = database
            .conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT weekly_limit_pct, weekly_limit_reset FROM usage_snapshots LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        drop(database);
        let _ = std::fs::remove_file(&path);

        assert_eq!(pct, Some(42.0));
        assert_eq!(reset, Some(123));
    }

    #[test]
    fn snapshots_store_five_hour_and_weekly_windows_separately() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::migrations::MIGRATION_SQL)
            .unwrap();
        conn.execute(
            "INSERT INTO accounts (id, alias, created_at, updated_at) VALUES ('a', 'A', 'now', 'now')",
            [],
        )
        .unwrap();
        let limit = |percentage, unit| QuotaLimit {
            limit_type: "TOKENS_LIMIT".to_string(),
            percentage,
            next_reset_time: unit as i64 * 100,
            unit: Some(unit),
            number: None,
            usage: None,
            current_value: None,
            remaining: None,
            usage_details: None,
        };
        let quota = QuotaData {
            limits: vec![limit(72.0, 6.0), limit(18.0, 3.0)],
            ..Default::default()
        };

        record_quota_snapshot(&conn, "a", &quota, 0.0, 0.0).unwrap();
        let values: (Option<f64>, Option<f64>) = conn
            .query_row(
                "SELECT token_limit_pct, weekly_limit_pct FROM usage_snapshots",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(values, (Some(18.0), Some(72.0)));
    }
}
