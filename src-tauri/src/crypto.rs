use keyring::Entry;
use thiserror::Error;

const SERVICE_NAME: &str = "glm-quota-monitor";

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Keychain error: {0}")]
    Keychain(String),
}

/// 将 API Key 存入系统 Keychain
pub fn store_api_key(account_id: &str, api_key: &str) -> Result<(), CryptoError> {
    let entry = Entry::new(SERVICE_NAME, account_id)
        .map_err(|e| CryptoError::Keychain(e.to_string()))?;
    entry
        .set_password(api_key)
        .map_err(|e| CryptoError::Keychain(e.to_string()))?;
    Ok(())
}

/// 从系统 Keychain 读取 API Key
pub fn get_api_key(account_id: &str) -> Result<String, CryptoError> {
    let entry = Entry::new(SERVICE_NAME, account_id)
        .map_err(|e| CryptoError::Keychain(e.to_string()))?;
    entry
        .get_password()
        .map_err(|e| CryptoError::Keychain(e.to_string()))
}

/// 从系统 Keychain 删除 API Key
pub fn delete_api_key(account_id: &str) -> Result<(), CryptoError> {
    let entry = Entry::new(SERVICE_NAME, account_id)
        .map_err(|e| CryptoError::Keychain(e.to_string()))?;
    entry
        .delete_password()
        .map_err(|e| CryptoError::Keychain(e.to_string()))?;
    Ok(())
}
