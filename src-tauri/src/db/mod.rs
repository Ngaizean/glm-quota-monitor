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
        if conn.prepare("SELECT purpose FROM accounts LIMIT 0").is_err() {
            conn.execute_batch("ALTER TABLE accounts ADD COLUMN purpose TEXT NOT NULL DEFAULT ''")?;
        }
        Ok(())
    }
}

/// 记录额度快照 + 更新账号等级（共享逻辑，避免重复代码）
pub fn record_quota_snapshot(
    conn: &Connection,
    account_id: &str,
    quota: &QuotaData,
) -> SqlResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let time_limit = quota.limits.iter().find(|l| l.limit_type == "TIME_LIMIT");
    let token_limit = quota.limits.iter().find(|l| l.limit_type == "TOKENS_LIMIT");

    // Token 已用量（万为单位）
    let token_usage = token_limit.and_then(|l| l.usage).unwrap_or(0.0);

    conn.execute(
        "INSERT INTO usage_snapshots (account_id, timestamp, time_limit_pct, time_limit_reset, token_limit_pct, token_limit_reset, total_tokens_24h)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            account_id,
            now,
            time_limit.map(|l| l.percentage as f64),
            time_limit.map(|l| l.next_reset_time),
            token_limit.map(|l| l.percentage as f64),
            token_limit.map(|l| l.next_reset_time),
            token_usage as i64,
        ],
    )?;

    conn.execute(
        "UPDATE accounts SET level = ?1 WHERE id = ?2",
        rusqlite::params![quota.level, account_id],
    )?;

    Ok(())
}
