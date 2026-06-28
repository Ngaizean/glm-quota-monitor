use super::types::{AuthJson, AuthSummary};
use std::path::PathBuf;

/// 返回 ~/.codex/auth.json 路径
pub fn auth_json_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取 home 目录")?;
    Ok(home.join(".codex").join("auth.json"))
}

/// 读取本机 ~/.codex/auth.json
pub fn read_local_auth_json() -> Result<AuthJson, String> {
    let path = auth_json_path()?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取 auth.json 失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 auth.json 失败: {}", e))
}

/// 覆盖写入 ~/.codex/auth.json（同步场景使用，先备份）
pub fn write_local_auth_json(auth: &AuthJson) -> Result<(), String> {
    let path = auth_json_path()?;
    let parent = path.parent().ok_or("无法获取 .codex 目录")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建 .codex 目录失败: {}", e))?;

    // 备份现有文件
    if path.exists() {
        let bak = path.with_extension("json.bak");
        let _ = std::fs::copy(&path, &bak);
    }

    let content =
        serde_json::to_string_pretty(auth).map_err(|e| format!("序列化 auth.json 失败: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("写入 auth.json 失败: {}", e))?;
    Ok(())
}

/// 读取本机 auth.json 摘要（脱敏，不含 token 明文）
pub fn read_local_auth_summary() -> AuthSummary {
    match read_local_auth_json() {
        Ok(auth) => AuthSummary {
            exists: true,
            account_id: auth.tokens.account_id.clone(),
            last_refresh: auth.last_refresh.clone(),
            access_token_exp: auth.access_token_exp_iso(),
            plan_type: None,
        },
        Err(_) => AuthSummary {
            exists: false,
            account_id: String::new(),
            last_refresh: None,
            access_token_exp: None,
            plan_type: None,
        },
    }
}

/// Keychain 中 Codex 凭证的存储 key
pub fn keychain_key(account_id: &str) -> String {
    format!("codex_{}", account_id)
}

/// 将 auth.json 序列化为字符串存入 Keychain（复用现有 keyring 机制）
pub fn store_auth_to_keychain(account_id: &str, auth: &AuthJson) -> Result<(), String> {
    let key = keychain_key(account_id);
    let json = serde_json::to_string(auth).map_err(|e| format!("序列化失败: {}", e))?;
    keyring::Entry::new(crate::crypto::SERVICE_NAME, &key)
        .map_err(|e| format!("Keychain 错误: {}", e))?
        .set_password(&json)
        .map_err(|e| format!("存储凭证失败: {}", e))?;
    Ok(())
}

/// 从 Keychain 读取 auth.json
pub fn read_auth_from_keychain(account_id: &str) -> Result<AuthJson, String> {
    let key = keychain_key(account_id);
    let json = keyring::Entry::new(crate::crypto::SERVICE_NAME, &key)
        .map_err(|e| format!("Keychain 错误: {}", e))?
        .get_password()
        .map_err(|e| format!("读取凭证失败: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("解析凭证失败: {}", e))
}

/// 删除 Keychain 中的 Codex 凭证
pub fn delete_auth_from_keychain(account_id: &str) -> Result<(), String> {
    let key = keychain_key(account_id);
    keyring::Entry::new(crate::crypto::SERVICE_NAME, &key)
        .map_err(|e| format!("Keychain 错误: {}", e))?
        .delete_password()
        .map_err(|e| format!("删除凭证失败: {}", e))?;
    Ok(())
}
