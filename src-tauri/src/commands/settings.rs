use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn get_setting(db: State<'_, Database>, key: String) -> Result<Option<String>, String> {
    let conn = db.conn.lock().unwrap();
    let result = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(result)
}

#[tauri::command]
pub fn set_setting(db: State<'_, Database>, key: String, value: String) -> Result<(), String> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
