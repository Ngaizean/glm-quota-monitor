use crate::api::client::ZhipuClient;
use crate::api::types::QuotaData;
use crate::crypto;
use crate::db::{self, Database};
use tauri::State;

#[tauri::command]
pub fn get_quota(db: State<'_, Database>, account_id: String) -> Result<QuotaData, String> {
    // 从系统凭据管理器读取 API Key，降级到数据库明文（兼容旧数据迁移）
    let api_key = match crypto::get_api_key(&account_id) {
        Ok(key) => key,
        Err(_) => {
            // 旧数据迁移：从数据库读取明文，迁移到系统凭据管理器
            let conn = db.conn.lock().unwrap();
            let db_key: String = conn
                .query_row(
                    "SELECT api_key FROM accounts WHERE id = ?1",
                    rusqlite::params![account_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("账号不存在: {}", e))?;

            if db_key.is_empty() {
                return Err("API key not found".to_string());
            }

            // 迁移到系统凭据管理器
            let _ = crypto::store_api_key(&account_id, &db_key);
            // 清除数据库明文
            let _ = conn.execute(
                "UPDATE accounts SET api_key = '' WHERE id = ?1",
                rusqlite::params![account_id],
            );
            db_key
        }
    };

    let client = ZhipuClient::new(&api_key);
    let quota = tauri::async_runtime::block_on(client.get_quota_limit())
        .map_err(|e| e.to_string())?;

    // 记录快照
    let conn = db.conn.lock().unwrap();
    db::record_quota_snapshot(&conn, &account_id, &quota)
        .map_err(|e| e.to_string())?;

    Ok(quota)
}
