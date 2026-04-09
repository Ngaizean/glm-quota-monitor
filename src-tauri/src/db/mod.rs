pub mod migrations;
pub mod models;

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
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(migrations::MIGRATION_SQL)?;
        // 迁移：为已有数据库添加 purpose 列
        if conn.prepare("SELECT purpose FROM accounts LIMIT 0").is_err() {
            conn.execute_batch("ALTER TABLE accounts ADD COLUMN purpose TEXT NOT NULL DEFAULT ''")?;
        }
        Ok(())
    }
}
