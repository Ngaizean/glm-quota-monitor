use std::process::Command;
use thiserror::Error;

const SERVICE_NAME: &str = "glm-quota-monitor";

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Keychain error: {0}")]
    Keychain(String),
}

/// 存储 API Key 到 macOS Keychain（通过 security 命令）
pub fn store_api_key(account_id: &str, api_key: &str) -> Result<(), CryptoError> {
    // 先尝试删除已有的（避免重复添加报错）
    let _ = delete_api_key(account_id);

    let output = Command::new("security")
        .args([
            "add-generic-password",
            "-s", SERVICE_NAME,
            "-a", account_id,
            "-w", api_key,
        ])
        .output()
        .map_err(|e| CryptoError::Keychain(e.to_string()))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(CryptoError::Keychain(err.to_string()));
    }

    Ok(())
}

/// 从 macOS Keychain 读取 API Key
pub fn get_api_key(account_id: &str) -> Result<String, CryptoError> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-s", SERVICE_NAME,
            "-a", account_id,
            "-w",
        ])
        .output()
        .map_err(|e| CryptoError::Keychain(e.to_string()))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(CryptoError::Keychain(err.to_string()));
    }

    let password = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(password)
}

/// 从 macOS Keychain 删除 API Key
pub fn delete_api_key(account_id: &str) -> Result<(), CryptoError> {
    let output = Command::new("security")
        .args([
            "delete-generic-password",
            "-s", SERVICE_NAME,
            "-a", account_id,
        ])
        .output()
        .map_err(|e| CryptoError::Keychain(e.to_string()))?;

    if !output.status.success() {
        // 删除时找不到条目不算错误
        let err = String::from_utf8_lossy(&output.stderr);
        if !err.contains("The specified item could not be found") {
            return Err(CryptoError::Keychain(err.to_string()));
        }
    }

    Ok(())
}
