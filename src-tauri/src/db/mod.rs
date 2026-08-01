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
        if conn.prepare("SELECT is_primary FROM accounts LIMIT 0").is_err() {
            conn.execute_batch("ALTER TABLE accounts ADD COLUMN is_primary INTEGER DEFAULT 0")?;
        }
        if conn.prepare("SELECT dedupe_window_mins FROM alert_rules LIMIT 0").is_err() {
            conn.execute_batch("ALTER TABLE alert_rules ADD COLUMN dedupe_window_mins INTEGER DEFAULT 60")?;
        }
        Ok(())
    }

    /// 启动时把数据库里残留的明文 api_key 批量迁移到系统 Keychain，并清空明文。
    /// 新增账号本就写 ''（见 commands::account::add_account），这里只处理老版本遗留。
    /// 单条 store 失败时保留明文（下次启动重试），避免凭据丢失。
    pub fn migrate_legacy_api_keys(&self) -> SqlResult<usize> {
        let rows: Vec<(String, String)> = {
            let conn = self.conn.lock().map_err(|e| {
                rusqlite::Error::InvalidPath(format!("数据库锁定: {}", e).into())
            })?;
            let mut stmt = conn.prepare(
                "SELECT id, api_key FROM accounts WHERE api_key != '' AND platform = 'zhipu'",
            )?;
            let iter = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut v = Vec::new();
            for r in iter {
                if let Ok(r) = r {
                    v.push(r);
                }
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
    let token_limit = quota.limits.iter().find(|l| l.limit_type == "TOKENS_LIMIT");
    let mcp_limit = quota.limits.iter().find(|l| l.limit_type == "MCP_MONTHLY");

    conn.execute(
        "INSERT INTO usage_snapshots (account_id, timestamp, time_limit_pct, time_limit_reset, token_limit_pct, token_limit_reset, mcp_limit_pct, mcp_limit_reset, total_tokens_24h, total_calls_24h)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            account_id,
            now,
            time_limit.map(|l| l.percentage as f64),
            time_limit.map(|l| l.next_reset_time),
            token_limit.map(|l| l.percentage as f64),
            token_limit.map(|l| l.next_reset_time),
            mcp_limit.map(|l| l.percentage as f64),
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
