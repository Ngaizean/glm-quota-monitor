use thiserror::Error;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Storage error: {0}")]
    Storage(String),
}

/// 存储 API Key（直接明文存数据库，由 macOS 文件权限保护）
pub fn store_api_key(_account_id: &str, _api_key: &str) -> Result<(), CryptoError> {
    // 不再使用 Keychain，直接在 commands 层存入数据库
    Ok(())
}

/// 从数据库读取 API Key（在 commands 层直接查询）
pub fn get_api_key(_account_id: &str) -> Result<String, CryptoError> {
    // 由 commands 层直接从数据库读取
    Ok(String::new())
}

/// 删除 API Key（数据库层处理）
pub fn delete_api_key(_account_id: &str) -> Result<(), CryptoError> {
    Ok(())
}
