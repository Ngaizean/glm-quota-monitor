use keyring::Entry;
use thiserror::Error;

const SERVICE_NAME: &str = "glm-quota-monitor";

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Credential store error: {0}")]
    CredentialStore(String),
}

/// 将 API Key 存入系统凭据管理器
pub fn store_api_key(account_id: &str, api_key: &str) -> Result<(), CryptoError> {
    let entry = Entry::new(SERVICE_NAME, account_id)
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    entry
        .set_password(api_key)
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    Ok(())
}

/// 从系统凭据管理器读取 API Key
pub fn get_api_key(account_id: &str) -> Result<String, CryptoError> {
    let entry = Entry::new(SERVICE_NAME, account_id)
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    entry
        .get_password()
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))
}

/// 从系统凭据管理器删除 API Key
pub fn delete_api_key(account_id: &str) -> Result<(), CryptoError> {
    let entry = Entry::new(SERVICE_NAME, account_id)
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    entry
        .delete_password()
        .map_err(|e| CryptoError::CredentialStore(e.to_string()))?;
    Ok(())
}

/// 从 Keychain 或数据库明文获取 API Key，自动迁移并清除明文
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
