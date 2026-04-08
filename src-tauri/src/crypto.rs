use thiserror::Error;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Keyring error: {0}")]
    Keyring(String),
}

const KEYRING_SERVICE: &str = "glm-quota-monitor";

/// 存储 API Key 到系统 Keychain
pub fn store_api_key(account_id: &str, api_key: &str) -> Result<(), CryptoError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account_id)
        .map_err(|e| CryptoError::Keyring(e.to_string()))?;
    entry
        .set_password(api_key)
        .map_err(|e| CryptoError::Keyring(e.to_string()))
}

/// 从系统 Keychain 读取 API Key
pub fn get_api_key(account_id: &str) -> Result<String, CryptoError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account_id)
        .map_err(|e| CryptoError::Keyring(e.to_string()))?;
    entry
        .get_password()
        .map_err(|e| CryptoError::Keyring(e.to_string()))
}

/// 从系统 Keychain 删除 API Key
pub fn delete_api_key(account_id: &str) -> Result<(), CryptoError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account_id)
        .map_err(|e| CryptoError::Keyring(e.to_string()))?;
    entry
        .delete_credential()
        .map_err(|e| CryptoError::Keyring(e.to_string()))
}
