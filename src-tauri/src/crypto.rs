use keyring::Entry;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use thiserror::Error;

const SERVICE_NAME: &str = "glm-quota-monitor";

static CACHE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Credential store error: {0}")]
    CredentialStore(String),
}

pub fn store_api_key(account_id: &str, api_key: &str) -> Result<(), CryptoError> {
    let entry = Entry::new(SERVICE_NAME, account_id)
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    entry
        .set_password(api_key)
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(account_id.to_string(), api_key.to_string());
    }
    Ok(())
}

pub fn get_api_key(account_id: &str) -> Result<String, CryptoError> {
    if let Ok(cache) = CACHE.lock() {
        if let Some(key) = cache.get(account_id) {
            return Ok(key.clone());
        }
    }
    let entry = Entry::new(SERVICE_NAME, account_id)
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    let key = entry
        .get_password()
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(account_id.to_string(), key.clone());
    }
    Ok(key)
}

pub fn delete_api_key(account_id: &str) -> Result<(), CryptoError> {
    let entry = Entry::new(SERVICE_NAME, account_id)
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    entry
        .delete_password()
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    if let Ok(mut cache) = CACHE.lock() {
        cache.remove(account_id);
    }
    Ok(())
}

/// 从系统凭据管理器或数据库明文获取 API Key，自动迁移并清除明文
pub fn resolve_api_key(account_id: &str, db_key: &str, clear_db_fn: &dyn Fn()) -> Option<String> {
    if let Ok(key) = get_api_key(account_id) {
        return Some(key);
    }
    if !db_key.is_empty() {
        let _ = store_api_key(account_id, db_key);
        clear_db_fn();
        return Some(db_key.to_string());
    }
    None
}
