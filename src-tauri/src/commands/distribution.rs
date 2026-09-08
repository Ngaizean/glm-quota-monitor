use crate::{
    codex::profiles::{self, Device, Profile},
    db::Database,
};
use tauri::{Emitter, Manager, State};

#[derive(serde::Serialize)]
pub struct DistributionState {
    accounts: Vec<Profile>,
    devices: Vec<Device>,
    local_account_id: Option<String>,
    cloud_account_id: Option<String>,
    cloud_account_ids: Vec<String>,
}

#[tauri::command]
pub async fn get_distribution_state(app: tauri::AppHandle) -> Result<DistributionState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Database>();
        profiles::migrate(&db)?;
        Ok(DistributionState {
            accounts: profiles::list(&db)?,
            devices: profiles::devices(&db)?,
            local_account_id: profiles::setting(&db, "codex_local_account"),
            cloud_account_id: profiles::setting(&db, "codex_cloud_account"),
            cloud_account_ids: profiles::cloud_account_ids(&db),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn save_codex_profile(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    mut profile: Profile,
    api_key: Option<String>,
) -> Result<(), String> {
    let _guard = profiles::DISTRIBUTION_LOCK
        .lock()
        .map_err(|e| e.to_string())?;
    let new = profile.account_id.is_empty();
    if new {
        if profile.kind != "relay" {
            return Err("官方账号请通过登录或导入添加".into());
        }
        profile.account_id = uuid::Uuid::new_v4().to_string();
    } else if profiles::get(&db, &profile.account_id)?.kind != profile.kind {
        return Err("不能改变账号类型".into());
    }
    if profile.kind == "relay" {
        profile.base_url =
            crate::sub2api::codex_config::normalize_relay_base_url(&profile.base_url)?;
    }
    profile.alias = profile.alias.trim().to_string();
    profile.model = profile.model.trim().to_string();
    profiles::validate(&profile)?;
    let key_id = format!("codex_relay_{}", profile.account_id);
    let previous_key = crate::crypto::get_api_key(&key_id).ok();
    if profile.kind == "relay" {
        let key = api_key
            .filter(|s| !s.trim().is_empty())
            .or_else(|| crate::crypto::get_api_key(&key_id).ok())
            .ok_or("请输入中转密钥")?;
        crate::crypto::store_api_key(&key_id, key.trim()).map_err(|e| e.to_string())?;
    }
    if let Err(error) = profiles::save(&db, &profile) {
        if let Some(previous) = previous_key {
            crate::crypto::store_api_key(&key_id, &previous)
                .map_err(|e| format!("账号保存失败: {error}; 密钥回滚失败: {e}"))?;
        } else if profile.kind == "relay" {
            let _ = crate::crypto::delete_api_key(&key_id);
        }
        return Err(error);
    }
    let _ = app.emit("accounts-changed", ());
    Ok(())
}

#[tauri::command]
pub fn apply_codex_account(
    db: State<'_, Database>,
    account_id: String,
) -> Result<crate::codex::session_repair::RepairReport, String> {
    profiles::apply_local(&db, &profiles::bundle(&db, &account_id)?)
}

#[tauri::command]
pub fn bind_codex_device(db: State<'_, Database>, device: Device) -> Result<(), String> {
    let _guard = profiles::DISTRIBUTION_LOCK
        .lock()
        .map_err(|e| e.to_string())?;
    profiles::bind(&db, &device)
}

#[tauri::command]
pub fn unbind_codex_device(db: State<'_, Database>, host: String) -> Result<(), String> {
    let _guard = profiles::DISTRIBUTION_LOCK
        .lock()
        .map_err(|e| e.to_string())?;
    db.conn
        .lock()
        .map_err(|e| e.to_string())?
        .execute("DELETE FROM codex_devices WHERE host=?1", [host])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn sync_codex_device(
    app: tauri::AppHandle,
    host: String,
    password: Option<String>,
) -> Result<(), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        profiles::push(&app.state::<Database>(), &host, password.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_cloud_account(db: State<'_, Database>, account_id: String) -> Result<(), String> {
    profiles::get(&db, &account_id)?;
    profiles::set_setting(&db, "codex_cloud_account", &account_id)
}

/// 设置云端分发的账号集合（一次发布可携带多个账号，官方订阅与中转站均可）
#[tauri::command]
pub fn set_cloud_accounts(db: State<'_, Database>, account_ids: Vec<String>) -> Result<(), String> {
    profiles::set_cloud_accounts(&db, &account_ids)
}

#[tauri::command]
pub async fn get_codex_account_relay_usage(
    db: State<'_, Database>,
    account_id: String,
) -> Result<crate::codex::relay::RelayUsageView, String> {
    let bundle = profiles::bundle(&db, &account_id)?;
    if bundle.profile.kind != "relay" {
        return Err("此账号不是中转账号".into());
    }
    let usage = crate::codex::relay::fetch_relay_usage(
        &crate::HTTP_CLIENT,
        &crate::proxy_http_client(),
        &bundle.profile.base_url,
        bundle.api_key.as_deref().unwrap_or_default(),
    )
    .await?;
    Ok(crate::codex::relay::relay_usage_to_view(&usage))
}
