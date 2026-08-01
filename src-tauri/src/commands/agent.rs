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

const ANTHROPIC_BASE_URL: &str = "https://open.bigmodel.cn/api/anthropic";
/// DeepSeek 官方 Anthropic 协议原生兼容端点（与 GLM 的 /api/anthropic 完全平行）。
const DEEPSEEK_ANTHROPIC_BASE_URL: &str = "https://api.deepseek.com/anthropic";
/// DeepSeek 快速绑定/未显式选模型时的防御性回落（UI 仍要求用户从 picker 显式选择）。
const DEEPSEEK_FALLBACK_MODEL: &str = "deepseek-v4-flash";

/// 把指定 base_url + api_key + 模型写入 ~/.claude/settings.json 的 env 块。
/// GLM 与 DeepSeek 均提供 Anthropic 协议原生兼容端点，仅 base_url 与模型名不同，故共用此函数。
/// 合并到现有 env，保留用户其他环境变量；env 字段缺失或非对象（用户手动改坏）时重建为空对象，避免 panic。
fn write_claude_code_env(api_key: &str, model: &str, base_url: &str) -> Result<(), String> {
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

    if !settings["env"].is_object() {
        settings["env"] = serde_json::json!({});
    }
    let env = settings["env"]
        .as_object_mut()
        .ok_or("settings.json 的 env 字段格式异常，无法写入")?;
    env.insert("ANTHROPIC_BASE_URL".into(), serde_json::Value::String(base_url.into()));
    env.insert("ANTHROPIC_AUTH_TOKEN".into(), serde_json::Value::String(api_key.into()));
    env.insert("ANTHROPIC_MODEL".into(), serde_json::Value::String(model.into()));
    env.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".into(), serde_json::Value::String(model.into()));
    env.insert("ANTHROPIC_DEFAULT_SONNET_MODEL".into(), serde_json::Value::String(model.into()));
    env.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".into(), serde_json::Value::String(model.into()));

    write_json(&path, &settings)
}

fn write_claude_code_key(api_key: &str, model: &str) -> Result<(), String> {
    write_claude_code_env(api_key, model, ANTHROPIC_BASE_URL)
}

/// DeepSeek 覆盖 Claude Code：官方 Anthropic 兼容端点 + Bearer key（与余额/模型查询同一把 key）。
fn write_claude_code_key_deepseek(api_key: &str, model: &str) -> Result<(), String> {
    write_claude_code_env(api_key, model, DEEPSEEK_ANTHROPIC_BASE_URL)
}

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
    // 读取账号平台 + GLM 默认模型（同一把锁，避免重复加锁）
    let (platform, glm_default_model) = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        let platform: String = conn
            .query_row(
                "SELECT platform FROM accounts WHERE id = ?1",
                rusqlite::params![account_id],
                |row| row.get(0),
            )
            .map_err(|_| format!("账号不存在: {}", account_id))?;
        let glm_default_model =
            read_default_model(&conn).unwrap_or_else(|| FALLBACK_MODEL.to_string());
        (platform, glm_default_model)
    };

    // 按平台取 API Key（GLM 走 crypto，DeepSeek 走 deepseek::auth，keychain key 前缀不同）。
    // crypto 返回 CryptoError、deepseek 返回 String，统一到 String 再加前缀。
    let api_key = match platform.as_str() {
        "deepseek" => crate::deepseek::auth::get_api_key(&account_id),
        _ => crypto::get_api_key(&account_id).map_err(|e| e.to_string()),
    }
    .map_err(|e| format!("获取 API Key 失败: {}", e))?;

    // 默认模型按平台：DeepSeek 用 v4-flash（防御性；UI 应通过 picker 显式选择），GLM 用全局默认模型
    let model_val = match model {
        Some(m) => m,
        None => match platform.as_str() {
            "deepseek" => DEEPSEEK_FALLBACK_MODEL.to_string(),
            _ => glm_default_model,
        },
    };

    match agent.as_str() {
        "claude_code" => match platform.as_str() {
            "deepseek" => write_claude_code_key_deepseek(&api_key, &model_val)?,
            _ => write_claude_code_key(&api_key, &model_val)?,
        },
        "openclaw" => {
            // OpenClaw 绑定目前仅支持智谱 GLM（本工具定位）；DeepSeek 暂不支持
            if platform == "deepseek" {
                return Err("OpenClaw 暂不支持 DeepSeek，仅支持智谱 GLM".to_string());
            }
            write_openclaw_key(&api_key, &model_val)?
        }
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
pub fn fetch_models(
    db: State<'_, Database>,
    account_id: String,
) -> Result<Vec<String>, String> {
    // 按账号平台分发：DeepSeek 走其 /models（v4-flash/v4-pro），GLM 走智谱模型列表
    let platform: String = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        conn.query_row(
            "SELECT platform FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| row.get(0),
        )
        .map_err(|_| format!("账号不存在: {}", account_id))?
    };

    let mut models: Vec<String> = match platform.as_str() {
        "deepseek" => {
            let api_key = crate::deepseek::auth::get_api_key(&account_id)
                .map_err(|e| format!("获取 API Key 失败: {}", e))?;
            let resp = tauri::async_runtime::block_on(
                crate::deepseek::client::DeepSeekClient::get_models(&crate::HTTP_CLIENT, &api_key),
            )
            .map_err(|e| format!("获取模型列表失败: {}", e))?;
            resp.data.into_iter().map(|m| m.id).collect()
        }
        _ => {
            let api_key = crypto::get_api_key(&account_id)
                .map_err(|e| format!("获取 API Key 失败: {}", e))?;
            let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
            let resp = tauri::async_runtime::block_on(client.list_models())
                .map_err(|e| format!("获取模型列表失败: {}", e))?;
            resp.data.into_iter().map(|m| m.id).collect()
        }
    };
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
