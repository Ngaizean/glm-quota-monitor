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

const REFRESH_URL: &str = "https://auth.openai.com/oauth/token";

/// 用 refresh_token 刷新 access_token
/// 成功后更新 auth.json（本机）+ Keychain + 内存，返回新的 AuthJson
/// 注意：refresh_token 是轮转的，刷新后旧的立即失效
pub fn refresh_access_token(
    http: &reqwest::Client,
    auth: &AuthJson,
) -> Result<AuthJson, String> {
    let refresh_token = &auth.tokens.refresh_token;
    if refresh_token.is_empty() {
        return Err("无 refresh_token".to_string());
    }

    // 从 access_token JWT 提取 client_id
    let client_id = extract_client_id(&auth.tokens.access_token)
        .ok_or_else(|| "无法从 access_token 提取 client_id".to_string())?;

    // POST refresh 请求
    let payload = serde_json::json!({
        "grant_type": "refresh_token",
        "client_id": client_id,
        "refresh_token": refresh_token,
    });

    let resp = tauri::async_runtime::block_on(async {
        http.post(REFRESH_URL)
            .header("Content-Type", "application/json")
            .header("User-Agent", "glm-quota-monitor")
            .json(&payload)
            .send()
            .await
    })
    .map_err(|e| format!("刷新请求失败: {}", e))?;

    let status = resp.status();
    let body = tauri::async_runtime::block_on(resp.text())
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("刷新失败 HTTP {}: {}", status, &body[..body.len().min(200)]));
    }

    let token_resp: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("解析刷新响应失败: {}", e))?;

    // 构建新的 AuthJson（保留 account_id，更新 tokens + last_refresh）
    let mut new_auth = auth.clone();
    let access_token = token_resp
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "刷新响应缺少 access_token".to_string())?;
    new_auth.tokens.access_token = access_token.to_string();
    new_auth.tokens.refresh_token = token_resp
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or(refresh_token) // 某些情况不返回新 refresh_token，保留旧的
        .to_string();
    if token_resp.get("id_token").and_then(|v| v.as_str()).is_some() {
        new_auth.tokens.id_token = token_resp
            .get("id_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
    }
    new_auth.last_refresh = Some(chrono::Utc::now().to_rfc3339());

    Ok(new_auth)
}

/// 从 JWT access_token 提取 client_id
fn extract_client_id(access_token: &str) -> Option<String> {
    use base64::Engine;
    let parts: Vec<&str> = access_token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(parts[1]))
        .ok()?;
    let v: serde_json::Value = serde_json::from_slice(&payload).ok()?;
    v.get("client_id")?.as_str().map(|s| s.to_string())
}

/// 刷新 token 并同步到本机 auth.json + Keychain
/// 返回刷新后的 AuthJson
pub fn refresh_and_sync(
    http: &reqwest::Client,
    auth: &AuthJson,
    account_id: &str,
) -> Result<AuthJson, String> {
    let new_auth = refresh_access_token(http, auth)?;

    // 写回本机 auth.json（Codex CLI 也会读这个文件）
    if let Err(e) = write_local_auth_json(&new_auth) {
        eprintln!("更新本机 auth.json 失败（不影响本次刷新）: {}", e);
    }

    // 更新 Keychain
    if let Err(e) = store_auth_to_keychain(account_id, &new_auth) {
        eprintln!("更新 Keychain 失败（不影响本次刷新）: {}", e);
    }

    Ok(new_auth)
}
