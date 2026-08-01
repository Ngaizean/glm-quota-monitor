use keyring::Entry;

/// Keychain 中 DeepSeek API Key 的存储 key。
///
/// 加 `deepseek_` 前缀（镜像 Codex 的 `codex_{id}` 约定），与 GLM 裸 `{id}` 区分，
/// 使得 keychain 条目自描述、删除时可按平台精确清理。
pub fn keychain_key(account_id: &str) -> String {
    format!("deepseek_{}", account_id)
}

/// 将 API Key 存入系统 Keychain（复用 crypto::SERVICE_NAME）。
pub fn store_api_key(account_id: &str, api_key: &str) -> Result<(), String> {
    let key = keychain_key(account_id);
    Entry::new(crate::crypto::SERVICE_NAME, &key)
        .map_err(|e| format!("Keychain 错误: {}", e))?
        .set_password(api_key)
        .map_err(|e| format!("存储 API Key 失败: {}", e))
}

/// 从系统 Keychain 读取 API Key。
pub fn get_api_key(account_id: &str) -> Result<String, String> {
    let key = keychain_key(account_id);
    Entry::new(crate::crypto::SERVICE_NAME, &key)
        .map_err(|e| format!("Keychain 错误: {}", e))?
        .get_password()
        .map_err(|e| format!("读取 API Key 失败: {}", e))
}

/// 删除系统 Keychain 中的 API Key。
pub fn delete_api_key(account_id: &str) -> Result<(), String> {
    let key = keychain_key(account_id);
    Entry::new(crate::crypto::SERVICE_NAME, &key)
        .map_err(|e| format!("Keychain 错误: {}", e))?
        .delete_password()
        .map_err(|e| format!("删除 API Key 失败: {}", e))
}
