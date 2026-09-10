use super::{auth, types::AuthJson};
use crate::db::Database;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use toml_edit::{value, DocumentMut, Item, Table};

pub static DISTRIBUTION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
pub struct Profile {
    pub account_id: String,
    pub alias: String,
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub reasoning_effort: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Device {
    pub host: String,
    pub account_id: Option<String>,
    pub follow_local: bool,
    pub model: String,
    pub reasoning_effort: String,
    pub auto_sync: bool,
    pub status: String,
    pub last_sync: Option<String>,
    pub last_error: Option<String>,
}

// Credentials only cross the backend transport boundary, never a UI command response.
#[derive(Clone, Serialize, Deserialize)]
pub struct Bundle {
    pub version: u32,
    pub profile: Profile,
    pub auth: Option<AuthJson>,
    pub api_key: Option<String>,
}

pub fn setting(db: &Database, key: &str) -> Option<String> {
    db.conn
        .lock()
        .ok()?
        .query_row("SELECT value FROM app_settings WHERE key=?1", [key], |r| {
            r.get(0)
        })
        .ok()
}

pub fn set_setting(db: &Database, key: &str, val: &str) -> Result<(), String> {
    db.conn
        .lock()
        .map_err(|e| e.to_string())?
        .execute(
            "INSERT OR REPLACE INTO app_settings(key,value) VALUES(?1,?2)",
            params![key, val],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list(db: &Database) -> Result<Vec<Profile>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT a.id,a.alias,COALESCE(p.kind,'official'),COALESCE(p.base_url,''),COALESCE(p.model,''),COALESCE(p.reasoning_effort,'') FROM accounts a LEFT JOIN codex_profiles p ON a.id=p.account_id WHERE a.platform='codex' AND a.is_active=1 ORDER BY a.created_at,a.id").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Profile {
                account_id: r.get(0)?,
                alias: r.get(1)?,
                kind: r.get(2)?,
                base_url: r.get(3)?,
                model: r.get(4)?,
                reasoning_effort: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get(db: &Database, id: &str) -> Result<Profile, String> {
    list(db)?
        .into_iter()
        .find(|p| p.account_id == id)
        .ok_or_else(|| "账号不存在或已删除".into())
}

pub fn validate(profile: &Profile) -> Result<(), String> {
    if !matches!(profile.kind.as_str(), "official" | "relay") {
        return Err("未知账号类型".into());
    }
    if profile.alias.trim().is_empty() {
        return Err("账号名称不能为空".into());
    }
    if profile.model.chars().any(char::is_control) {
        return Err("模型名称包含控制字符".into());
    }
    if !["", "none", "minimal", "low", "medium", "high", "xhigh"]
        .contains(&profile.reasoning_effort.as_str())
    {
        return Err("无效的推理强度".into());
    }
    if profile.kind == "relay" {
        crate::sub2api::codex_config::normalize_relay_base_url(&profile.base_url)?;
        if profile.model.trim().is_empty() {
            return Err("中转账号需要默认模型".into());
        }
    }
    Ok(())
}

pub fn save(db: &Database, profile: &Profile) -> Result<(), String> {
    validate(profile)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO accounts(id,alias,purpose,platform,created_at,updated_at) VALUES(?1,?2,'codex','codex',?3,?3) ON CONFLICT(id) DO UPDATE SET alias=excluded.alias,updated_at=excluded.updated_at", params![profile.account_id,profile.alias,chrono::Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO codex_profiles(account_id,kind,base_url,model,reasoning_effort) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(account_id) DO UPDATE SET kind=excluded.kind,base_url=excluded.base_url,model=excluded.model,reasoning_effort=excluded.reasoning_effort",params![profile.account_id,profile.kind,profile.base_url,profile.model,profile.reasoning_effort]).map_err(|e| e.to_string())?;
    tx.execute("UPDATE codex_devices SET status='pending',last_error=NULL WHERE account_id=?1 OR follow_local=1", [&profile.account_id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn bundle(db: &Database, id: &str) -> Result<Bundle, String> {
    let profile = get(db, id)?;
    let (auth, api_key) = if profile.kind == "relay" {
        (
            None,
            Some(
                crate::crypto::get_api_key(&format!("codex_relay_{id}"))
                    .map_err(|e| e.to_string())?,
            ),
        )
    } else {
        (Some(auth::read_auth_from_keychain(id)?), None)
    };
    let result = Bundle {
        version: 1,
        profile,
        auth,
        api_key,
    };
    validate_bundle(&result)?;
    Ok(result)
}

pub fn validate_bundle(bundle: &Bundle) -> Result<(), String> {
    if bundle.version != 1 {
        return Err("不支持的账号同步版本".into());
    }
    validate(&bundle.profile)?;
    if bundle.profile.kind == "relay" {
        if bundle
            .api_key
            .as_deref()
            .is_none_or(|s| s.trim().is_empty())
        {
            return Err("中转账号缺少密钥".into());
        }
    } else if bundle
        .auth
        .as_ref()
        .is_none_or(|a| a.tokens.access_token.trim().is_empty())
    {
        return Err("官方账号缺少登录凭据".into());
    }
    Ok(())
}

pub fn merge(existing: &str, bundle: &Bundle) -> Result<String, String> {
    validate_bundle(bundle)?;
    let mut doc = existing
        .parse::<DocumentMut>()
        .map_err(|e| format!("配置 TOML 无效: {e}"))?;
    // A selected profile can override top-level routing. Clear that selection, preserving its table.
    doc.remove("profile");
    doc["cli_auth_credentials_store"] = value("file");
    for (key, val) in [
        ("model", &bundle.profile.model),
        ("model_reasoning_effort", &bundle.profile.reasoning_effort),
    ] {
        if val.is_empty() {
            doc.remove(key);
        } else {
            doc[key] = value(val.as_str());
        }
    }
    if bundle.profile.kind == "official" {
        doc.remove("model_provider");
    } else {
        doc["model_provider"] = value("quota_monitor");
        if doc.get("model_providers").is_none() {
            doc["model_providers"] = Item::Table(Table::new());
        }
        let providers = doc["model_providers"]
            .as_table_like_mut()
            .ok_or("model_providers 必须是表")?;
        let mut provider = Table::new();
        for (key, val) in [
            ("name", bundle.profile.alias.as_str()),
            ("base_url", bundle.profile.base_url.as_str()),
            ("wire_api", "responses"),
            (
                "experimental_bearer_token",
                bundle.api_key.as_deref().unwrap_or_default(),
            ),
        ] {
            provider[key] = value(val);
        }
        provider["requires_openai_auth"] = value(false);
        provider["supports_websockets"] = value(false);
        providers.insert("quota_monitor", Item::Table(provider));
    }
    Ok(doc.to_string())
}

pub fn auth_content(bundle: &Bundle) -> Result<String, String> {
    // Relay distribution intentionally excludes the distributor's official credentials.
    match &bundle.auth {
        Some(auth) if bundle.profile.kind == "official" => {
            serde_json::to_string_pretty(auth).map_err(|e| e.to_string())
        }
        _ => Ok("{\"auth_mode\":\"apikey\",\"OPENAI_API_KEY\":null}".into()),
    }
}

pub fn apply_local(db: &Database, bundle: &Bundle) -> Result<super::session_repair::RepairReport, String> {
    let _guard = DISTRIBUTION_LOCK.lock().map_err(|e| e.to_string())?;
    get(db, &bundle.profile.account_id)?;
    apply_local_unlocked(db, bundle)
}

fn apply_local_unlocked(
    db: &Database,
    bundle: &Bundle,
) -> Result<super::session_repair::RepairReport, String> {
    let auth_path = auth::auth_json_path()?;
    let dir = auth_path.parent().ok_or("账号目录不存在")?;
    apply_local_files(dir, bundle)?;
    // 切换后旧会话记录的 provider 与新账号不一致会导致 resume 失败，尽力自动修复；
    // 修复失败不阻断切换（用户可手动再修），结果随命令返回给界面提示。
    let target = super::session_repair::target_provider(&bundle.profile.kind);
    let repair = match super::session_repair::repair_sessions(dir, target) {
        Ok(report) => report,
        Err(error) => {
            eprintln!("会话 provider 修复失败: {error}");
            super::session_repair::RepairReport::default()
        }
    };
    set_setting(db, "codex_local_account", &bundle.profile.account_id)?;
    Ok(repair)
}

fn apply_local_files(dir: &std::path::Path, bundle: &Bundle) -> Result<(), String> {
    let auth_path = dir.join("auth.json");
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let config_path = dir.join("config.toml");
    let original = read_optional(&config_path)?;
    let merged = merge(
        std::str::from_utf8(original.as_deref().unwrap_or_default()).map_err(|e| e.to_string())?,
        bundle,
    )?;
    let old_auth = read_optional(&auth_path)?;
    let next_auth = auth_content(bundle)?;
    for (path, data) in [(&config_path, &original), (&auth_path, &old_auth)] {
        if let Some(data) = data {
            auth::write_sensitive_file(
                &path.with_extension(format!(
                    "{}.bak-quota-monitor",
                    path.extension().and_then(|s| s.to_str()).unwrap_or("")
                )),
                data,
            )?;
        }
    }
    auth::write_sensitive_file(&auth_path, next_auth.as_bytes())?;
    if let Err(error) = auth::write_sensitive_file(&config_path, merged.as_bytes()) {
        let rollback = match old_auth {
            Some(ref bytes) => auth::write_sensitive_file(&auth_path, bytes),
            None => std::fs::remove_file(&auth_path).map_err(|e| e.to_string()),
        };
        return Err(format!(
            "配置应用失败: {error}; 凭据回滚: {}",
            rollback.err().unwrap_or_else(|| "成功".into())
        ));
    }
    Ok(())
}

fn read_optional(path: &std::path::Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn devices(db: &Database) -> Result<Vec<Device>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT host,account_id,follow_local,model,reasoning_effort,auto_sync,status,last_sync,last_error FROM codex_devices ORDER BY host").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Device {
                host: r.get(0)?,
                account_id: r.get(1)?,
                follow_local: r.get(2)?,
                model: r.get(3)?,
                reasoning_effort: r.get(4)?,
                auto_sync: r.get(5)?,
                status: r.get(6)?,
                last_sync: r.get(7)?,
                last_error: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn bind(db: &Database, device: &Device) -> Result<(), String> {
    if !super::ssh::scan_ssh_hosts()
        .iter()
        .any(|h| h.alias == device.host)
    {
        return Err("SSH 主机不在配置中".into());
    }
    validate_binding(db, device)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO codex_devices(host,account_id,follow_local,model,reasoning_effort,auto_sync,status) VALUES(?1,?2,?3,?4,?5,?6,'pending') ON CONFLICT(host) DO UPDATE SET account_id=excluded.account_id,follow_local=excluded.follow_local,model=excluded.model,reasoning_effort=excluded.reasoning_effort,auto_sync=excluded.auto_sync,status='pending',last_error=NULL",params![device.host,device.account_id,device.follow_local,device.model,device.reasoning_effort,device.auto_sync]).map_err(|e|e.to_string())?;
    Ok(())
}

fn validate_binding(db: &Database, device: &Device) -> Result<(), String> {
    let id = if device.follow_local {
        setting(db, "codex_local_account")
    } else {
        device.account_id.clone()
    };
    let mut profile = get(db, &id.ok_or("请先选择账号")?)?;
    if !device.model.is_empty() {
        profile.model = device.model.clone();
    }
    if !device.reasoning_effort.is_empty() {
        profile.reasoning_effort = device.reasoning_effort.clone();
    }
    validate(&profile)
}

pub fn device_bundle(db: &Database, device: &Device) -> Result<Bundle, String> {
    let id = if device.follow_local {
        setting(db, "codex_local_account")
    } else {
        device.account_id.clone()
    };
    let mut bundle = bundle(db, &id.ok_or("设备尚未绑定账号")?)?;
    if !device.model.is_empty() {
        bundle.profile.model = device.model.clone();
    }
    if !device.reasoning_effort.is_empty() {
        bundle.profile.reasoning_effort = device.reasoning_effort.clone();
    }
    validate_bundle(&bundle)?;
    Ok(bundle)
}

pub fn push(db: &Database, host: &str, password: Option<&str>) -> Result<(), String> {
    let _guard = DISTRIBUTION_LOCK.lock().map_err(|e| e.to_string())?;
    let device = devices(db)?
        .into_iter()
        .find(|d| d.host == host)
        .ok_or("设备尚未绑定账号")?;
    let result = (|| {
        let bundle = device_bundle(db, &device)?;
        let saved = super::ssh::read_ssh_password(host);
        let credentials = password.or(saved.as_deref());
        if !super::ssh::remote_has_codex(host, credentials)? {
            return Err("目标服务器未安装 Codex，无法同步；请先在远端安装 codex 或改用 Claude Code 同步".into());
        }
        super::ssh::push_bundle(host, credentials, &bundle)
    })();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    match &result {
        Ok(()) => {
            conn.execute("UPDATE codex_devices SET status='verified',last_sync=?2,last_error=NULL WHERE host=?1",params![host,chrono::Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;
        }
        Err(error) => {
            conn.execute("UPDATE codex_devices SET status='failed',last_error=?2 WHERE host=?1",params![host,error]).map_err(|e|e.to_string())?;
        }
    }
    result
}

pub const CLOUD_ACCOUNTS_KEY: &str = "codex_cloud_accounts";

/// 云端分发的多账号选择；从未设置过时回落到旧的单一选择，再回落到本机账号。
pub fn cloud_account_ids(db: &Database) -> Vec<String> {
    setting(db, CLOUD_ACCOUNTS_KEY)
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .filter(|ids| !ids.is_empty())
        .or_else(|| setting(db, "codex_cloud_account").map(|id| vec![id]))
        .or_else(|| setting(db, "codex_local_account").map(|id| vec![id]))
        .unwrap_or_default()
}

pub fn set_cloud_accounts(db: &Database, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Err("请至少选择一个分发账号".into());
    }
    for id in ids {
        get(db, id)?;
    }
    let raw = serde_json::to_string(ids).map_err(|e| e.to_string())?;
    set_setting(db, CLOUD_ACCOUNTS_KEY, &raw)
}

/// 打包全部选中的云端分发账号；缺凭据的账号直接报错，避免发布出残缺包。
pub fn cloud_bundles(db: &Database) -> Result<Vec<Bundle>, String> {
    let ids = cloud_account_ids(db);
    if ids.is_empty() {
        return Err("请先选择云端分发账号".into());
    }
    ids.iter()
        .map(|id| bundle(db, id))
        .collect::<Result<Vec<_>, _>>()
}

pub fn receive(db: &Database, bundle: &Bundle) -> Result<(), String> {
    let _guard = DISTRIBUTION_LOCK.lock().map_err(|e| e.to_string())?;
    let received = receive_store(db, bundle)?;
    apply_local_unlocked(db, &received)?;
    Ok(())
}

/// 批量接收云端分发的账号：全部入库为 synced_* 账号。
/// force_apply=true（用户手动点"接收并应用到本机"）：本机账号在批次中→刷新它；
/// 否则自动应用批次中第一个官方账号（与按钮文案一致）。
/// force_apply=false（后台 auto-sync）：仅当本机账号在批次中时刷新它，
/// 不打扰用户已手动切换到的其他账号。
pub fn receive_many(db: &Database, bundles: &[Bundle], force_apply: bool) -> Result<usize, String> {
    let _guard = DISTRIBUTION_LOCK.lock().map_err(|e| e.to_string())?;
    let mut received_list = Vec::with_capacity(bundles.len());
    for bundle in bundles {
        received_list.push(receive_store(db, bundle)?);
    }
    let current = setting(db, "codex_local_account");
    if let Some(received) = received_list
        .iter()
        .find(|r| current.as_deref() == Some(r.profile.account_id.as_str()))
    {
        apply_local_unlocked(db, received)?;
    } else if force_apply {
        if let Some(first_official) = received_list.iter().find(|r| r.profile.kind == "official") {
            apply_local_unlocked(db, first_official)?;
        }
    }
    Ok(bundles.len())
}

fn receive_store(db: &Database, bundle: &Bundle) -> Result<Bundle, String> {
    validate_bundle(bundle)?;
    // A namespaced ID preserves device bindings across repeated downloads without overwriting local accounts.
    let mut received = bundle.clone();
    received.profile.account_id = format!(
        "synced_{}",
        bundle.profile.account_id.trim_start_matches("synced_")
    );
    if received.profile.kind == "relay" {
        crate::crypto::store_api_key(
            &format!("codex_relay_{}", received.profile.account_id),
            received.api_key.as_deref().unwrap_or_default(),
        )
        .map_err(|e| e.to_string())?;
    } else {
        auth::store_auth_to_keychain(
            &received.profile.account_id,
            received.auth.as_ref().ok_or("缺少凭据")?,
        )?;
    }
    save(db, &received.profile)?;
    Ok(received)
}

pub fn migrate(db: &Database) -> Result<(), String> {
    if setting(db, "codex_profiles_migrated").as_deref() == Some("1") {
        return Ok(());
    }
    let _guard = DISTRIBUTION_LOCK.lock().map_err(|e| e.to_string())?;
    if setting(db, "codex_profiles_migrated").as_deref() == Some("1") {
        return Ok(());
    }
    // Existing official account IDs remain unchanged. Import the previous singleton relay once.
    let relay = super::relay::detect_local_relay_distribution_config();
    let url =
        setting(db, "codex_relay_base_url").or_else(|| relay.as_ref().map(|p| p.base_url.clone()));
    let secret = crate::crypto::get_api_key("codex_relay_api_key")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| relay.as_ref().and_then(|p| p.bearer_token.clone()));
    let mut local = setting(db, "codex_active_official_account").filter(|id| get(db, id).is_ok());
    if local.is_none() {
        if let Ok(current) = auth::read_local_auth_json() {
            local = list(db)?
                .into_iter()
                .find(|p| {
                    auth::read_auth_from_keychain(&p.account_id).is_ok_and(|a| {
                        !a.tokens.account_id.is_empty()
                            && a.tokens.account_id == current.tokens.account_id
                    })
                })
                .map(|p| p.account_id);
            if local.is_none() && !current.tokens.access_token.is_empty() {
                let mut official = Profile {
                    account_id: uuid::Uuid::new_v4().to_string(),
                    alias: "官方订阅".into(),
                    kind: "official".into(),
                    base_url: String::new(),
                    model: String::new(),
                    reasoning_effort: String::new(),
                };
                if relay.is_none() {
                    if let Some(doc) = auth::auth_json_path()
                        .ok()
                        .and_then(|p| std::fs::read_to_string(p.with_file_name("config.toml")).ok())
                        .and_then(|s| s.parse::<DocumentMut>().ok())
                    {
                        official.model = doc
                            .get("model")
                            .and_then(Item::as_str)
                            .unwrap_or_default()
                            .to_string();
                        official.reasoning_effort = doc
                            .get("model_reasoning_effort")
                            .and_then(Item::as_str)
                            .unwrap_or_default()
                            .to_string();
                    }
                }
                auth::store_auth_to_keychain(&official.account_id, &current)?;
                save(db, &official)?;
                local = Some(official.account_id);
            }
        }
    }
    if let (Some(url), Some(secret)) = (url, secret) {
        let existing = list(db)?.into_iter().find(|p| {
            p.kind == "relay"
                && p.base_url == url
                && crate::crypto::get_api_key(&format!("codex_relay_{}", p.account_id))
                    .is_ok_and(|key| key == secret)
                || auth::read_auth_from_keychain(&p.account_id).is_ok_and(|a| {
                    a.tokens.access_token.is_empty()
                        && super::relay::api_key_from_auth(&a).as_deref() == Some(secret.as_str())
                })
        });
        let p = Profile {
            account_id: existing
                .as_ref()
                .map(|p| p.account_id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            alias: existing
                .map(|p| p.alias)
                .unwrap_or_else(|| "中转账号".into()),
            kind: "relay".into(),
            base_url: crate::sub2api::codex_config::normalize_relay_base_url(&url)?,
            model: setting(db, "codex_relay_model")
                .or_else(|| relay.as_ref().map(|p| p.model.clone()))
                .unwrap_or_else(|| "gpt-5.6-sol".into()),
            reasoning_effort: relay
                .as_ref()
                .and_then(|p| p.reasoning_effort.clone())
                .unwrap_or_default(),
        };
        crate::crypto::store_api_key(&format!("codex_relay_{}", p.account_id), &secret)
            .map_err(|e| e.to_string())?;
        save(db, &p)?;
        if relay.is_some() {
            local = Some(p.account_id);
        }
    }
    if let Some(id) = local {
        set_setting(db, "codex_local_account", &id)?;
        set_setting(db, "codex_cloud_account", &id)?;
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT OR IGNORE INTO codex_devices(host,account_id,auto_sync,status) SELECT substr(key,19),?1,1,'pending' FROM app_settings WHERE key LIKE 'ssh_auto_override_%' AND value='true'",[id]).map_err(|e|e.to_string())?;
    }
    set_setting(db, "codex_profiles_migrated", "1")
}

pub fn is_relay(db: &Database, id: &str) -> bool {
    db.conn
        .lock()
        .ok()
        .and_then(|c| {
            c.query_row(
                "SELECT kind='relay' FROM codex_profiles WHERE account_id=?1",
                [id],
                |r| r.get::<_, bool>(0),
            )
            .optional()
            .ok()
            .flatten()
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, kind: &str) -> Profile {
        Profile {
            account_id: id.into(),
            alias: id.into(),
            kind: kind.into(),
            base_url: if kind == "relay" {
                "https://relay.example/v1".into()
            } else {
                String::new()
            },
            model: "gpt-example".into(),
            reasoning_effort: "high".into(),
        }
    }
    fn fixture(kind: &str) -> Bundle {
        Bundle {
            version: 1,
            profile: profile("account-a", kind),
            auth: if kind == "official" {
                Some(serde_json::from_value(serde_json::json!({"tokens":{"access_token":"test-access","refresh_token":"test-refresh","id_token":"test-id","account_id":"test-account"}})).unwrap())
            } else {
                None
            },
            api_key: if kind == "relay" {
                Some("test-key".into())
            } else {
                None
            },
        }
    }
    fn database() -> Database {
        let db = Database {
            conn: Mutex::new(rusqlite::Connection::open_in_memory().unwrap()),
        };
        db.conn
            .lock()
            .unwrap()
            .execute_batch("PRAGMA foreign_keys=ON")
            .unwrap();
        db.init_tables().unwrap();
        db
    }

    #[test]
    fn official_and_relay_profiles_share_accounts_without_losing_existing_rows() {
        let db = database();
        db.conn.lock().unwrap().execute("INSERT INTO accounts(id,alias,platform,created_at,updated_at) VALUES('old','Old','codex','now','now')",[]).unwrap();
        save(&db, &profile("relay", "relay")).unwrap();
        assert_eq!(list(&db).unwrap().len(), 2);
        assert_eq!(get(&db, "old").unwrap().kind, "official");
        assert!(!is_relay(&db, "old"));
        assert!(is_relay(&db, "relay"));
        db.init_tables().unwrap();
        assert_eq!(list(&db).unwrap().len(), 2);
    }

    #[test]
    fn bound_device_does_not_follow_local_switch_and_account_edits_mark_pending() {
        let db = database();
        save(&db, &profile("a", "official")).unwrap();
        save(&db, &profile("b", "relay")).unwrap();
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO codex_devices(host,account_id,status) VALUES('server','a','verified')",
                [],
            )
            .unwrap();
        set_setting(&db, "codex_local_account", "b").unwrap();
        assert_eq!(devices(&db).unwrap()[0].account_id.as_deref(), Some("a"));
        save(&db, &profile("a", "official")).unwrap();
        assert_eq!(devices(&db).unwrap()[0].status, "pending");
        db.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM accounts WHERE id='a'", [])
            .unwrap();
        assert_eq!(devices(&db).unwrap()[0].account_id, None);
    }

    #[test]
    fn config_merge_handles_comments_and_preserves_remote_tools() {
        let source="profile = 'legacy' # selected\nmodel_provider='old' # old gateway\n[model_providers.old]\nbase_url='https://old.example'\n[profiles.legacy]\nmodel_provider='old'\n[mcp_servers.keep]\ncommand='keep-me'\n";
        let bundle = fixture("relay");
        let merged = merge(source, &bundle).unwrap();
        let doc = merged.parse::<DocumentMut>().unwrap();
        assert_eq!(doc["model_provider"].as_str(), Some("quota_monitor"));
        assert_eq!(
            doc["mcp_servers"]["keep"]["command"].as_str(),
            Some("keep-me")
        );
        assert!(doc.get("profile").is_none());
        assert_eq!(
            doc["model_providers"]["quota_monitor"]["supports_websockets"].as_bool(),
            Some(false)
        );
        assert_eq!(merge(&merged, &bundle).unwrap(), merged);
        let official = merge(&merged, &fixture("official"))
            .unwrap()
            .parse::<DocumentMut>()
            .unwrap();
        assert!(official.get("model_provider").is_none());
        assert_eq!(official["model"].as_str(), Some("gpt-example"));
    }

    #[test]
    fn cloud_account_selection_falls_back_to_legacy_single_account() {
        let db = database();
        assert!(cloud_account_ids(&db).is_empty());
        set_setting(&db, "codex_local_account", "local-a").unwrap();
        assert_eq!(cloud_account_ids(&db), vec!["local-a".to_string()]);
        set_setting(&db, "codex_cloud_account", "cloud-a").unwrap();
        assert_eq!(cloud_account_ids(&db), vec!["cloud-a".to_string()]);
        save(&db, &profile("a", "official")).unwrap();
        save(&db, &profile("b", "relay")).unwrap();
        set_cloud_accounts(&db, &["a".into(), "b".into()]).unwrap();
        assert_eq!(
            cloud_account_ids(&db),
            vec!["a".to_string(), "b".to_string()]
        );
        assert!(set_cloud_accounts(&db, &[]).is_err());
        assert!(set_cloud_accounts(&db, &["missing".into()]).is_err());
        // 损坏的 JSON 视为未设置，回落到旧单账号选择
        set_setting(&db, CLOUD_ACCOUNTS_KEY, "[broken").unwrap();
        assert_eq!(cloud_account_ids(&db), vec!["cloud-a".to_string()]);
    }

    #[test]
    fn invalid_config_or_missing_credentials_never_produce_a_setup() {
        assert!(merge("[bad", &fixture("relay")).is_err());
        let mut b = fixture("relay");
        b.api_key = None;
        assert!(merge("", &b).is_err());
        let mut b = fixture("official");
        b.version = 2;
        assert!(validate_bundle(&b).is_err());
    }

    #[test]
    fn relay_transport_excludes_official_auth_and_cloud_roundtrip_preserves_profile() {
        let mut b = fixture("relay");
        b.auth = fixture("official").auth;
        assert!(!auth_content(&b).unwrap().contains("test-access"));
        let json = serde_json::to_string(&fixture("relay")).unwrap();
        let encrypted = super::super::crypto::encrypt(&json).unwrap();
        let decoded: Bundle =
            serde_json::from_str(&super::super::crypto::decrypt(&encrypted).unwrap()).unwrap();
        assert_eq!(decoded.profile.base_url, "https://relay.example/v1");
        assert_eq!(decoded.api_key.as_deref(), Some("test-key"));
    }

    #[test]
    fn local_setup_backs_up_both_files_and_refuses_invalid_existing_toml() {
        let dir = std::env::temp_dir().join(format!("quota-profile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("auth.json"), "original-auth").unwrap();
        std::fs::write(dir.join("config.toml"), "[invalid").unwrap();
        assert!(apply_local_files(&dir, &fixture("relay")).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("auth.json")).unwrap(),
            "original-auth"
        );
        std::fs::write(dir.join("config.toml"), "model='old'\n").unwrap();
        apply_local_files(&dir, &fixture("relay")).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("auth.json.bak-quota-monitor")).unwrap(),
            "original-auth"
        );
        assert!(std::fs::read_to_string(dir.join("config.toml"))
            .unwrap()
            .contains("quota_monitor"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
