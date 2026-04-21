use crate::api::client::ZhipuClient;
use crate::crypto;
use crate::db::Database;
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct AgentBinding {
    pub agent: String,
    pub account_id: Option<String>,
    pub label: String,
}

const AGENTS: &[(&str, &str)] = &[
    ("claude_code", "Claude Code"),
    ("openclaw", "OpenClaw"),
];

const DEFAULT_MODEL_KEY: &str = "default_model";
const FALLBACK_MODEL: &str = "glm-5.1";

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("读取失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {}", e))
}

fn write_json(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(path, content).map_err(|e| format!("写入失败: {}", e))
}

fn read_default_model(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![DEFAULT_MODEL_KEY],
        |row| row.get(0),
    )
    .ok()
}

fn write_claude_code_key(api_key: &str, model: &str) -> Result<(), String> {
    let claude_dir = dirs::home_dir()
        .ok_or("无法获取 home 目录")?
        .join(".claude");
    let path = claude_dir.join("settings.json");

    std::fs::create_dir_all(&claude_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let mut settings: serde_json::Value = if path.exists() {
        read_json(&path)?
    } else {
        serde_json::json!({})
    };

    if settings.get("env").is_none() {
        settings["env"] = serde_json::json!({});
    }

    let env = settings["env"].as_object_mut().ok_or("env 格式错误")?;
    env.insert(
        "ANTHROPIC_BASE_URL".into(),
        serde_json::Value::String("https://open.bigmodel.cn/api/anthropic".into()),
    );
    env.insert(
        "ANTHROPIC_AUTH_TOKEN".into(),
        serde_json::Value::String(api_key.into()),
    );
    env.insert(
        "ANTHROPIC_MODEL".into(),
        serde_json::Value::String(model.into()),
    );
    env.entry("ANTHROPIC_DEFAULT_HAIKU_MODEL")
        .or_insert(serde_json::Value::String(model.into()));
    env.entry("ANTHROPIC_DEFAULT_SONNET_MODEL")
        .or_insert(serde_json::Value::String(model.into()));
    env.entry("ANTHROPIC_DEFAULT_OPUS_MODEL")
        .or_insert(serde_json::Value::String(model.into()));

    write_json(&path, &settings)
}

fn write_openclaw_key(api_key: &str, model: &str) -> Result<(), String> {
    let oc_dir = dirs::home_dir()
        .ok_or("无法获取 home 目录")?
        .join(".openclaw");
    let path = oc_dir.join("openclaw.json");

    std::fs::create_dir_all(&oc_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let mut config: serde_json::Value = if path.exists() {
        read_json(&path)?
    } else {
        serde_json::json!({
            "providers": {
                "zai": {
                    "name": "zai",
                    "base_url": "https://open.bigmodel.cn/api/coding/paas/v4",
                    "api_format": "openai-completions"
                }
            },
            "auth": { "profiles": {} },
            "agents": { "defaults": {} }
        })
    };

    if config["auth"]["profiles"].is_null() {
        config["auth"] = serde_json::json!({ "profiles": {} });
    }

    config["auth"]["profiles"]["zai:default"] = serde_json::json!({
        "provider": "zai",
        "mode": "api_key",
        "apiKey": api_key
    });

    config["agents"]["defaults"]["model"] =
        serde_json::Value::String(format!("zai/{}", model));

    write_json(&path, &config)
}

#[tauri::command]
pub fn bind_agent(
    db: State<'_, Database>,
    agent: String,
    account_id: String,
    model: Option<String>,
) -> Result<(), String> {
    let api_key = crypto::get_api_key(&account_id)
        .map_err(|e| format!("获取 API Key 失败: {}", e))?;

    let model_val = match model {
        Some(m) => m,
        None => {
            let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
            read_default_model(&conn).unwrap_or_else(|| FALLBACK_MODEL.to_string())
        }
    };

    match agent.as_str() {
        "claude_code" => write_claude_code_key(&api_key, &model_val)?,
        "openclaw" => write_openclaw_key(&api_key, &model_val)?,
        _ => return Err(format!("未知 agent: {}", agent)),
    }

    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![format!("agent_{}", agent), account_id],
    )
    .map_err(|e| format!("保存绑定失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn get_agent_bindings(db: State<'_, Database>) -> Result<Vec<AgentBinding>, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    let mut bindings = Vec::new();

    for (agent, label) in AGENTS {
        let key = format!("agent_{}", agent);
        let account_id: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                rusqlite::params![key],
                |row| row.get(0),
            )
            .ok();
        bindings.push(AgentBinding {
            agent: agent.to_string(),
            account_id,
            label: label.to_string(),
        });
    }

    Ok(bindings)
}

#[tauri::command]
pub fn unbind_agent(db: State<'_, Database>, agent: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        rusqlite::params![format!("agent_{}", agent)],
    )
    .map_err(|e| format!("删除绑定失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn fetch_models(account_id: String) -> Result<Vec<String>, String> {
    let api_key = crypto::get_api_key(&account_id)
        .map_err(|e| format!("获取 API Key 失败: {}", e))?;

    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    let resp = tauri::async_runtime::block_on(client.list_models())
        .map_err(|e| format!("获取模型列表失败: {}", e))?;

    let mut models: Vec<String> = resp.data.into_iter().map(|m| m.id).collect();
    models.sort();
    Ok(models)
}

#[tauri::command]
pub fn get_default_model(db: State<'_, Database>) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    Ok(read_default_model(&conn).unwrap_or_else(|| FALLBACK_MODEL.to_string()))
}

#[tauri::command]
pub fn set_default_model(db: State<'_, Database>, model: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![DEFAULT_MODEL_KEY, model],
    )
    .map_err(|e| format!("保存默认模型失败: {}", e))?;
    Ok(())
}
