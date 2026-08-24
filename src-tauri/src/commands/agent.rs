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

const AGENTS: &[(&str, &str)] = &[("claude_code", "Claude Code"), ("openclaw", "OpenClaw")];

const DEFAULT_MODEL_KEY: &str = "default_model";
/// 用户自定义模型列表（JSON 数组存储于 app_settings）：允许绑定 API 模型列表之外的 GLM 模型名。
const CUSTOM_MODELS_KEY: &str = "custom_models";
/// 兜底默认模型：升级后未显式配置时取当前最新旗舰（GLM 5.x 代际）。
/// 注意：绑定"使用默认模型"时会优先从 GLM API 动态取最新模型，此常量仅作离线/失败兜底。
const FALLBACK_MODEL: &str = "glm-5.2";

/// 从模型 ID 中解析 GLM 版本号（如 "glm-5.2" -> (5,2)；非 glm 系列返回 None）。
fn parse_glm_version(model: &str) -> Option<(u32, u32)> {
    let rest = model.strip_prefix("glm-")?;
    let (major, minor_and_suffix) = rest.split_once('.')?;
    let minor: String = minor_and_suffix
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if minor.is_empty() {
        return None;
    }
    let major = major.parse::<u32>().ok()?;
    let minor = minor.parse::<u32>().ok()?;
    Some((major, minor))
}

/// 从模型列表中挑出「最新」GLM 旗舰模型：
/// - 取版本号（major.minor）最高者；同版本优先非 flash（旗舰）。
/// - 版本解析失败的非 glm-* 模型（embedding/cogview 等）直接忽略。
fn pick_latest_glm_model(models: &[String]) -> Option<String> {
    let mut best: Option<(u32, u32, bool)> = None; // (major, minor, is_flash)
    let mut best_name: Option<String> = None;
    for m in models {
        let Some((major, minor)) = parse_glm_version(m) else {
            continue;
        };
        let is_flash = m.contains("flash");
        let key = (major, minor, is_flash);
        match best {
            None => {
                best = Some(key);
                best_name = Some(m.clone());
            }
            Some(b) => {
                // 先比版本，再比旗舰优先
                let b_ver = (b.0, b.1);
                let k_ver = (major, minor);
                let better = if k_ver > b_ver {
                    true
                } else if k_ver == b_ver {
                    !is_flash && b.2 // 同版本：非 flash 优于 flash
                } else {
                    false
                };
                if better {
                    best = Some(key);
                    best_name = Some(m.clone());
                }
            }
        }
    }
    best_name
}

/// 从智谱 API 拉取模型列表并挑选最新 GLM 旗舰模型。
/// 失败返回 None（由调用方回退到 DB 配置 / FALLBACK_MODEL）。
fn fetch_latest_glm_model(account_id: &str) -> Option<String> {
    let api_key = crate::crypto::get_api_key(account_id).ok()?;
    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    let resp = tauri::async_runtime::block_on(client.list_models()).ok()?;
    let ids: Vec<String> = resp.data.into_iter().map(|m| m.id).collect();
    pick_latest_glm_model(&ids)
}

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("读取失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {}", e))
}

fn write_json(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {}", e))?;
    crate::codex::auth::write_sensitive_file(path, content.as_bytes())
        .map_err(|e| format!("写入失败: {}", e))
}

fn read_default_model(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![DEFAULT_MODEL_KEY],
        |row| row.get(0),
    )
    .ok()
}

/// 读取自定义模型列表（缺失或格式异常时返回空列表，兼容旧数据）。
fn read_custom_models(conn: &rusqlite::Connection) -> Vec<String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![CUSTOM_MODELS_KEY],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
    .unwrap_or_default()
}

fn write_custom_models(conn: &rusqlite::Connection, models: &[String]) -> Result<(), String> {
    let raw = serde_json::to_string(models).map_err(|e| format!("序列化失败: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![CUSTOM_MODELS_KEY, raw],
    )
    .map_err(|e| format!("保存自定义模型失败: {}", e))?;
    Ok(())
}

/// 合并 API 模型列表与自定义模型：去重 + 字典序，保证 picker 展示稳定。
fn merge_models(api: &[String], custom: &[String]) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    seen.extend(api.iter().cloned());
    seen.extend(custom.iter().cloned());
    seen.into_iter().collect()
}

const ANTHROPIC_BASE_URL: &str = "https://open.bigmodel.cn/api/anthropic";
/// DeepSeek 官方 Anthropic 协议原生兼容端点（与 GLM 的 /api/anthropic 完全平行）。
const DEEPSEEK_ANTHROPIC_BASE_URL: &str = "https://api.deepseek.com/anthropic";
/// DeepSeek 快速绑定/未显式选模型时的防御性回落（UI 仍要求用户从 picker 显式选择）。
const DEEPSEEK_FALLBACK_MODEL: &str = "deepseek-v4-flash";

/// 按平台解析 Claude Code 的 base_url（远程 SSH 绑定复用）。
/// pub 是为了 commands::codex::ssh_bind_claude_code 调用，避免在两处硬编码 URL。
pub fn cc_base_url_for_platform(platform: &str) -> &'static str {
    match platform {
        "deepseek" => DEEPSEEK_ANTHROPIC_BASE_URL,
        _ => ANTHROPIC_BASE_URL,
    }
}

/// 按 account_id 解析「要写入 Claude Code env 的三元组」(api_key, model, base_url)。
/// 抽自 bind_agent 的中段，供本机绑定与远程 SSH 绑定共用，保证两端行为一致。
///
/// - 取 platform + DB 默认模型（同一把锁，避免重复加锁）
/// - 按 platform 取 api_key（GLM 走 crypto、DeepSeek 走 deepseek::auth）
/// - 解析模型：显式传入优先；DeepSeek 缺省 v4-flash；GLM 缺省动态拉最新旗舰，失败回退 DB/FALLBACK
///
/// 返回 (api_key, model, base_url)。model 为空字符串时由调用方决定是否兜底。
pub fn resolve_cc_bind_params(
    db: &crate::db::Database,
    account_id: &str,
    model: Option<&str>,
) -> Result<(String, String, String), String> {
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

    let api_key = match platform.as_str() {
        "deepseek" => crate::deepseek::auth::get_api_key(account_id),
        _ => crypto::get_api_key(account_id).map_err(|e| e.to_string()),
    }
    .map_err(|e| format!("获取 API Key 失败: {}", e))?;

    let model_val = match model {
        Some(m) => m.to_string(),
        None => match platform.as_str() {
            "deepseek" => DEEPSEEK_FALLBACK_MODEL.to_string(),
            _ => fetch_latest_glm_model(account_id).unwrap_or(glm_default_model),
        },
    };

    let base_url = cc_base_url_for_platform(&platform).to_string();
    Ok((api_key, model_val, base_url))
}

/// 把指定 base_url + api_key + 模型写入 ~/.claude/settings.json 的 env 块。
/// GLM 与 DeepSeek 均提供 Anthropic 协议原生兼容端点，仅 base_url 与模型名不同，故共用此函数。
/// 单一模型统一填入 ANTHROPIC_MODEL + 三个 DEFAULT_*_MODEL tier 槽：用户选哪个模型，
/// cc 的 haiku/sonnet/opus 三个 tier 就全部对应同一个模型（选 flash 全 flash、选 pro 全 pro），
/// 避免不同 tier 取到不同模型名导致端点 400。
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
    env.insert(
        "ANTHROPIC_BASE_URL".into(),
        serde_json::Value::String(base_url.into()),
    );
    env.insert(
        "ANTHROPIC_AUTH_TOKEN".into(),
        serde_json::Value::String(api_key.into()),
    );
    env.insert(
        "ANTHROPIC_MODEL".into(),
        serde_json::Value::String(model.into()),
    );
    env.insert(
        "ANTHROPIC_DEFAULT_HAIKU_MODEL".into(),
        serde_json::Value::String(model.into()),
    );
    env.insert(
        "ANTHROPIC_DEFAULT_SONNET_MODEL".into(),
        serde_json::Value::String(model.into()),
    );
    env.insert(
        "ANTHROPIC_DEFAULT_OPUS_MODEL".into(),
        serde_json::Value::String(model.into()),
    );

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
            v.push(
                home.join(r".cargo\bin\openclaw.exe")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                home.join(r"AppData\Roaming\npm\openclaw.cmd")
                    .to_string_lossy()
                    .into_owned(),
            );
            v.push(
                home.join(r".local\bin\openclaw.exe")
                    .to_string_lossy()
                    .into_owned(),
            );
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
        candidates.push(
            home.join(".local/bin/openclaw")
                .to_string_lossy()
                .into_owned(),
        );
        candidates.push(
            home.join(".cargo/bin/openclaw")
                .to_string_lossy()
                .into_owned(),
        );
        candidates.push(
            home.join(".npm-global/bin/openclaw")
                .to_string_lossy()
                .into_owned(),
        );
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
            let p = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
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
    oc_config_set_all(
        &cli,
        &config_path,
        &[
            (&api_key_path, api_key),
            (&base_url_path, ANTHROPIC_BASE_URL),
            ("agents.defaults.model.primary", &model_full),
        ],
    )?;

    Ok(())
}

#[tauri::command]
pub fn bind_agent(
    db: State<'_, Database>,
    agent: String,
    account_id: String,
    model: Option<String>,
) -> Result<(), String> {
    // 复用统一 helper：按 platform 取 api_key + 解析模型 + 决定 base_url（与远程 SSH 绑定一致）
    let (api_key, model_val, _base_url) =
        resolve_cc_bind_params(&db, &account_id, model.as_deref())?;

    // 读平台用于分支判断（GLM 默认绑定同步写回 default_model；OpenClaw 不支持 DeepSeek）
    let platform: String = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        conn.query_row(
            "SELECT platform FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| row.get(0),
        )
        .map_err(|_| format!("账号不存在: {}", account_id))?
    };

    // GLM 默认绑定解析到最新模型后，同步写回 default_model，让 UI 显示与绑定一致地自动跟进。
    if model.is_none() && platform != "deepseek" {
        if let Ok(conn) = db.conn.lock() {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
                rusqlite::params![DEFAULT_MODEL_KEY, model_val],
            );
        }
    }

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
pub fn fetch_models(db: State<'_, Database>, account_id: String) -> Result<Vec<String>, String> {
    // 按账号平台分发：DeepSeek 走其 /models（v4-flash/v4-pro），GLM 走智谱模型列表 + 自定义模型合并
    let (platform, custom_models): (String, Vec<String>) = {
        let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
        let platform: String = conn
            .query_row(
                "SELECT platform FROM accounts WHERE id = ?1",
                rusqlite::params![account_id],
                |row| row.get(0),
            )
            .map_err(|_| format!("账号不存在: {}", account_id))?;
        (platform, read_custom_models(&conn))
    };

    let models: Vec<String> = match platform.as_str() {
        "deepseek" => {
            let api_key = crate::deepseek::auth::get_api_key(&account_id)
                .map_err(|e| format!("获取 API Key 失败: {}", e))?;
            let fallback = crate::proxy_http_client();
            let resp = tauri::async_runtime::block_on(
                crate::deepseek::client::DeepSeekClient::get_models_with_fallback(
                    &crate::HTTP_CLIENT,
                    &fallback,
                    &api_key,
                ),
            )
            .map_err(|e| format!("获取模型列表失败: {}", e))?;
            let mut models: Vec<String> = resp.data.into_iter().map(|m| m.id).collect();
            models.sort();
            models
        }
        _ => {
            let api_key = crypto::get_api_key(&account_id)
                .map_err(|e| format!("获取 API Key 失败: {}", e))?;
            let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
            match tauri::async_runtime::block_on(client.list_models()) {
                Ok(resp) => {
                    let api_models: Vec<String> = resp.data.into_iter().map(|m| m.id).collect();
                    merge_models(&api_models, &custom_models)
                }
                // API 拉取失败时降级：已有自定义模型则返回之（自定义模型不依赖 API 列表），否则维持报错
                Err(_) if !custom_models.is_empty() => custom_models,
                Err(e) => return Err(format!("获取模型列表失败: {}", e)),
            }
        }
    };
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

/// 读取用户自定义模型列表。
#[tauri::command]
pub fn get_custom_models(db: State<'_, Database>) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    Ok(read_custom_models(&conn))
}

/// 添加自定义模型（trim + 非空校验 + 去重），返回更新后的列表。
fn add_custom_model_impl(
    conn: &rusqlite::Connection,
    model: String,
) -> Result<Vec<String>, String> {
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err("模型名不能为空".to_string());
    }
    let mut models = read_custom_models(conn);
    if !models.contains(&model) {
        models.push(model);
        models.sort();
        write_custom_models(conn, &models)?;
    }
    Ok(models)
}

fn remove_custom_model_impl(
    conn: &rusqlite::Connection,
    model: String,
) -> Result<Vec<String>, String> {
    let mut models = read_custom_models(conn);
    models.retain(|m| *m != model);
    write_custom_models(conn, &models)?;
    Ok(models)
}

#[tauri::command]
pub fn add_custom_model(db: State<'_, Database>, model: String) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    add_custom_model_impl(&conn, model)
}

#[tauri::command]
pub fn remove_custom_model(db: State<'_, Database>, model: String) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    remove_custom_model_impl(&conn, model)
}

#[cfg(test)]
mod tests {
    use super::{
        add_custom_model_impl, merge_models, parse_glm_version, pick_latest_glm_model,
        read_custom_models, remove_custom_model_impl,
    };

    #[test]
    fn parses_standard_glm_versions_and_suffixes() {
        assert_eq!(parse_glm_version("glm-5.2"), Some((5, 2)));
        assert_eq!(parse_glm_version("glm-5.2-flash"), Some((5, 2)));
        assert_eq!(parse_glm_version("glm-4.5-air"), Some((4, 5)));
        assert_eq!(parse_glm_version("embedding-3"), None);
    }

    #[test]
    fn picks_latest_non_flash_model() {
        let models = vec![
            "glm-4.5".to_string(),
            "glm-5.2-flash".to_string(),
            "embedding-3".to_string(),
            "glm-5.2".to_string(),
            "glm-5.1".to_string(),
        ];

        assert_eq!(pick_latest_glm_model(&models).as_deref(), Some("glm-5.2"));
    }

    #[test]
    fn merges_api_and_custom_models_dedup_sorted() {
        let api = vec!["glm-5.2".to_string(), "glm-4.5-air".to_string()];
        let custom = vec!["glm-custom".to_string(), "glm-5.2".to_string()];

        assert_eq!(
            merge_models(&api, &custom),
            vec![
                "glm-4.5-air".to_string(),
                "glm-5.2".to_string(),
                "glm-custom".to_string()
            ]
        );
        assert!(merge_models(&[], &[]).is_empty());
    }

    fn test_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::migrations::MIGRATION_SQL)
            .unwrap();
        conn
    }

    #[test]
    fn custom_models_add_remove_roundtrip() {
        let conn = test_conn();
        assert!(read_custom_models(&conn).is_empty());

        // 添加两个 + 重复添加去重
        assert_eq!(
            add_custom_model_impl(&conn, " glm-custom ".to_string()).unwrap(),
            vec!["glm-custom".to_string()]
        );
        assert_eq!(
            add_custom_model_impl(&conn, "glm-5.2".to_string()).unwrap(),
            vec!["glm-5.2".to_string(), "glm-custom".to_string()]
        );
        assert_eq!(
            add_custom_model_impl(&conn, "glm-custom".to_string()).unwrap(),
            vec!["glm-5.2".to_string(), "glm-custom".to_string()]
        );
        // 空名校验
        assert!(add_custom_model_impl(&conn, "   ".to_string()).is_err());

        // 删除后持久化生效
        assert_eq!(
            remove_custom_model_impl(&conn, "glm-custom".to_string()).unwrap(),
            vec!["glm-5.2".to_string()]
        );
        assert_eq!(read_custom_models(&conn), vec!["glm-5.2".to_string()]);
        // 删除不存在的模型不报错
        assert!(remove_custom_model_impl(&conn, "glm-none".to_string()).is_ok());
    }
}
