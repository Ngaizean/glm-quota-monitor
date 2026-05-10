use crate::api::client::ZhipuClient;
use crate::api::types::ToolUsageData;
use crate::crypto;
use crate::db::Database;
use tauri::State;

#[tauri::command]
pub async fn get_tool_usage(
    db: State<'_, Database>,
    account_id: String,
) -> Result<ToolUsageData, String> {
    let db_key = {
        let conn = db.conn.lock().map_err(|e| format!("DB locked: {}", e))?;
        conn.query_row(
            "SELECT api_key FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("Account not found: {}", e))?
    };

    let api_key = crypto::resolve_api_key(&account_id, &db_key, &|| {
        if let Ok(c) = db.conn.lock() {
            let _ = c.execute(
                "UPDATE accounts SET api_key = '' WHERE id = ?1",
                rusqlite::params![account_id],
            );
        }
    })
    .ok_or("API key not found".to_string())?;

    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    let now = chrono::Local::now();
    let start = (now - chrono::Duration::hours(24))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let end = now.format("%Y-%m-%d %H:%M:%S").to_string();

    client
        .get_tool_usage(&start, &end)
        .await
        .map_err(|e| e.to_string())
}
