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
pub fn set_setting(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    key: String,
    value: String,
) -> Result<(), String> {
    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )
        .map_err(|e| e.to_string())?;
    }

    // 开机自启：实际注册/取消系统自启
    if key == "auto_start" {
        use tauri_plugin_autostart::ManagerExt;
        if value == "1" {
            app.autolaunch()
                .enable()
                .map_err(|e| format!("自启注册失败: {}", e))?;
        } else {
            app.autolaunch()
                .disable()
                .map_err(|e| format!("取消自启失败: {}", e))?;
        }
    }

    Ok(())
}
