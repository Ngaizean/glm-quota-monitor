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

    // 合并 GLM 配置到现有 env，保留用户其他环境变量
    // 若 env 字段缺失或非对象（用户手动改坏），重建为空对象，避免 unwrap panic
    if !settings["env"].is_object() {
        settings["env"] = serde_json::json!({});
    }
    let env = settings["env"]
        .as_object_mut()
        .ok_or("settings.json 的 env 字段格式异常，无法写入")?;
    env.insert("ANTHROPIC_BASE_URL".into(), serde_json::Value::String("https://open.bigmodel.cn/api/anthropic".into()));
    env.insert("ANTHROPIC_AUTH_TOKEN".into(), serde_json::Value::String(api_key.into()));
    env.insert("ANTHROPIC_MODEL".into(), serde_json::Value::String(model.into()));
    env.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".into(), serde_json::Value::String(model.into()));
    env.insert("ANTHROPIC_DEFAULT_SONNET_MODEL".into(), serde_json::Value::String(model.into()));
    env.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".into(), serde_json::Value::String(model.into()));

    write_json(&path, &settings)
}

const ANTHROPIC_BASE_URL: &str = "https://open.bigmodel.cn/api/anthropic";

/// 查找 openclaw CLI 路径 — 覆盖 Homebrew / Cargo / npm / 用户本地 / Windows
fn find_openclaw_cli() -> Result<String, String> {
    // 已知常见安装路径（按平台区分）
    #[cfg(target_os = "windows")]
    let mut candidates: Vec<String> = {
        let mut v: Vec<String> = Vec::new();
        if let Some(home) = dirs::home_dir() {
            v.push(home.join(r".cargo\bin\openclaw.exe").to_string_lossy().into_owned());
            v.push(home.join(r"AppData\Roaming\npm\openclaw.cmd").to_string_lossy().into_owned());
            v.push(home.join(r".local\bin\openclaw.exe").to_string_lossy().into_owned());
        }
        v
    };
    #[cfg(not(target_os = "windows"))]
    let mut candidates: Vec<String> = vec![
        "/opt/homebrew/bin/openclaw".into(),
        "/usr/local/bin/openclaw".into(),
    ];
    #[cfg(not(target_os = "windows"))]
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/openclaw").to_string_lossy().into_owned());
        candidates.push(home.join(".cargo/bin/openclaw").to_string_lossy().into_owned());
        candidates.push(home.join(".npm-global/bin/openclaw").to_string_lossy().into_owned());
    }
    for path in &candidates {
        if Path::new(path).exists() {
            return Ok(path.clone());
        }
    }
    // PATH 查找（跨平台：Unix 用 which，Windows 用 where）
    let lookup = if cfg!(windows) { "where" } else { "which" };
    if let Ok(output) = std::process::Command::new(lookup).arg("openclaw").output() {
        if output.status.success() {
            let p = String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or("").trim().to_string();
            if !p.is_empty() && Path::new(&p).exists() {
                return Ok(p);
            }
        }
    }
    Err("未找到 openclaw CLI，请确保已安装 OpenClaw".to_string())
}

/// 决定 OpenClaw 的 provider 标识。
/// 本工具专用于绑定智谱 GLM，故优先 zhipu；若配置中仅有 zai 则用 zai。
/// 不再依赖"已存在 zhipu profile"（那是循环依赖——绑定动作正是要创建它）。
fn resolve_oc_provider(config: &serde_json::Value) -> String {
    let has_zhipu = config["auth"]["profiles"]
        .as_object()
        .map(|p| p.keys().any(|k| k.starts_with("zhipu:")))
        .unwrap_or(false);
    if has_zhipu { "zhipu" } else { "zai" }.to_string()
}

fn oc_config_set(cli: &str, path: &str, value: &str) -> Result<(), String> {
    let output = std::process::Command::new(cli)
        .args(["config", "set", path, value])
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("执行 openclaw config set 失败: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("openclaw config set {} 失败: {}", path, stderr));
    }
    Ok(())
}

/// 备份 openclaw.json 内容，用于多次 config set 失败时回滚，保证原子性。
fn backup_config(path: &std::path::Path) -> Option<Vec<u8>> {
    std::fs::read(path).ok()
}

/// 执行多次 oc_config_set，任一失败则回滚到备份。保证原子性。
fn oc_config_set_all(
    cli: &str,
    config_path: &std::path::Path,
    ops: &[(&str, &str)],
) -> Result<(), String> {
    let backup = backup_config(config_path);
    for (path, value) in ops {
        if let Err(e) = oc_config_set(cli, path, value) {
            if let Some(data) = &backup {
                let _ = std::fs::write(config_path, data);
            }
            return Err(e);
        }
    }
    Ok(())
}

fn write_openclaw_key(api_key: &str, model: &str) -> Result<(), String> {
    let cli = find_openclaw_cli()?;
    let oc_dir = dirs::home_dir()
        .ok_or("无法获取 home 目录")?
        .join(".openclaw");
    let config_path = oc_dir.join("openclaw.json");
    if !config_path.exists() {
        return Err("OpenClaw 配置文件不存在，请先安装并初始化 OpenClaw".to_string());
    }
    let config = read_json(&config_path)?;
    let provider = resolve_oc_provider(&config);
    let model_full = format!("{}/{}", provider, model);

    // 三次 config set：apiKey、baseUrl（恢复此前删除的写入）、默认模型
    let api_key_path = format!("models.providers.{}.apiKey", provider);
    let base_url_path = format!("models.providers.{}.baseUrl", provider);
    oc_config_set_all(&cli, &config_path, &[
        (&api_key_path, api_key),
        (&base_url_path, ANTHROPIC_BASE_URL),
        ("agents.defaults.model.primary", &model_full),
    ])?;

    Ok(())
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
