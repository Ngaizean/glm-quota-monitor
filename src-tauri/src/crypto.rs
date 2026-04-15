use keyring::Entry;
use thiserror::Error;

const SERVICE_NAME: &str = "glm-quota-monitor";

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Credential store error: {0}")]
    CredentialStore(String),
}

/// 将 API Key 存入系统凭据管理器（macOS Keychain / Windows Credential Manager）
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
