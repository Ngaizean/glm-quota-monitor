use super::types::{AuthJson, AuthSummary};
use std::path::PathBuf;

/// 写入含凭据的本地文件，并在 Unix/macOS 上强制限制为仅当前用户可读写。
pub(crate) fn write_sensitive_file(path: &std::path::Path, content: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

        let parent = path
            .parent()
            .ok_or_else(|| "文件路径缺少父目录".to_string())?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "文件名不是有效 UTF-8".to_string())?;
        let temp_path = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temp_path)
            .map_err(|e| format!("创建临时文件失败: {}", e))?;
        let write_result = file
            .write_all(content)
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("写入临时文件失败: {}", e));
        drop(file);
        if let Err(error) = write_result {
            let _ = std::fs::remove_file(&temp_path);
            return Err(error);
        }
        if let Err(error) = std::fs::rename(&temp_path, path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("原子替换文件失败: {}", error));
        }
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("收紧文件权限失败: {}", e))?;
        Ok(())
    }

    #[cfg(not(unix))]
    {
        std::fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
    }
}

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
        if std::fs::copy(&path, &bak).is_ok() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&bak, std::fs::Permissions::from_mode(0o600));
            }
        }
    }

    let content =
        serde_json::to_string_pretty(auth).map_err(|e| format!("序列化 auth.json 失败: {}", e))?;
    write_sensitive_file(&path, content.as_bytes())
        .map_err(|e| format!("写入 auth.json 失败: {}", e))?;
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

/// Windows 凭据管理器每条目 blob 上限 2560 字节，keyring 以 UTF-16 编码存储，
/// 导致单条目实际最多约 1280 个 ASCII 字符（错误信息里的 "2560 chars" 是误导）。
/// Codex 的 access_token 一个 JWT 就有 ~1800 字符，完整 AuthJson 必超限，
/// 因此超长凭据按块拆分到多个 Keychain 条目（`codex_<id>` + `codex_<id>__<i>`），
/// 读取时自动拼接；老格式（单条目全文）无缝兼容。
const CHUNK_PREFIX: &str = "C1|";
/// 单块字节预算（UTF-8），留足前缀与 UTF-16 编码裕量
const CHUNK_SIZE: usize = 700;

fn chunks_of(json: &str) -> Vec<&str> {
    let mut chunks = Vec::new();
    let mut rest = json;
    while !rest.is_empty() {
        let mut end = rest.len().min(CHUNK_SIZE);
        while end > 0 && !rest.is_char_boundary(end) {
            end -= 1;
        }
        chunks.push(&rest[..end]);
        rest = &rest[end..];
    }
    chunks
}

fn chunk_entry_key(key: &str, index: usize) -> String {
    if index == 0 {
        key.to_string()
    } else {
        format!("{key}__{index}")
    }
}

/// 删除旧分块条目（依据主条目里的总块数）
fn delete_chunked_entries(key: &str) {
    let Ok(base) = keyring::Entry::new(crate::crypto::SERVICE_NAME, key) else {
        return;
    };
    let Ok(raw) = base.get_password() else {
        return;
    };
    let Some(meta) = raw.strip_prefix(CHUNK_PREFIX) else {
        return;
    };
    let Some(total) = meta
        .split_once('|')
        .and_then(|(t, _)| t.parse::<usize>().ok())
    else {
        return;
    };
    for i in 1..total {
        let _ = keyring::Entry::new(crate::crypto::SERVICE_NAME, &chunk_entry_key(key, i))
            .and_then(|e| e.delete_password());
    }
}

/// 将 auth.json 序列化为字符串存入 Keychain（分块兼容 Windows 上限）
/// 保留 id_token：codex CLI 校验登录态时会解析它，缺失/为空会报
/// "invalid ID token format" 并要求重新登录（分块机制可容纳其长度）。
pub fn store_auth_to_keychain(account_id: &str, auth: &AuthJson) -> Result<(), String> {
    let key = keychain_key(account_id);
    let json = serde_json::to_string(auth).map_err(|e| format!("序列化失败: {}", e))?;
    if json.is_empty() {
        return Err("空凭据，无法存储".to_string());
    }

    let chunks = chunks_of(&json);
    // 先清理旧条目，避免残留分块在新读取时被错误拼接
    delete_chunked_entries(&key);
    let _ = keyring::Entry::new(crate::crypto::SERVICE_NAME, &key)
        .and_then(|e| e.delete_password());

    for (i, chunk) in chunks.iter().enumerate() {
        let payload = if chunks.len() == 1 {
            (*chunk).to_string()
        } else {
            format!("{CHUNK_PREFIX}{}|{}|{}", chunks.len(), i, chunk)
        };
        keyring::Entry::new(crate::crypto::SERVICE_NAME, &chunk_entry_key(&key, i))
            .map_err(|e| format!("Keychain 错误: {}", e))?
            .set_password(&payload)
            .map_err(|e| format!("存储凭证失败: {}", e))?;
    }
    Ok(())
}

/// 从 Keychain 读取 auth.json（支持分块自动拼接与老格式兼容）
pub fn read_auth_from_keychain(account_id: &str) -> Result<AuthJson, String> {
    let key = keychain_key(account_id);
    let base = keyring::Entry::new(crate::crypto::SERVICE_NAME, &key)
        .map_err(|e| format!("Keychain 错误: {}", e))?;
    let raw = base
        .get_password()
        .map_err(|e| format!("读取凭证失败: {}", e))?;

    let mut out = String::new();
    if let Some(meta) = raw.strip_prefix(CHUNK_PREFIX) {
        let total = meta
            .split_once('|')
            .and_then(|(t, _)| t.parse::<usize>().ok())
            .ok_or_else(|| "分块凭据格式损坏".to_string())?;
        for i in 0..total {
            let entry = keyring::Entry::new(crate::crypto::SERVICE_NAME, &chunk_entry_key(&key, i))
                .map_err(|e| format!("Keychain 错误: {}", e))?;
            let raw = entry
                .get_password()
                .map_err(|e| format!("读取凭证失败: {}", e))?;
            let body = raw
                .strip_prefix(CHUNK_PREFIX)
                .and_then(|m| m.split_once('|'))
                .and_then(|(_, rest)| rest.split_once('|'))
                .map(|(_, body)| body)
                .ok_or_else(|| "分块凭据格式损坏".to_string())?;
            out.push_str(body);
        }
    } else {
        out = raw;
    }

    serde_json::from_str(&out).map_err(|e| format!("解析凭证失败: {}", e))
}

/// 删除 Keychain 中的 Codex 凭证（含分块条目）
pub fn delete_auth_from_keychain(account_id: &str) -> Result<(), String> {
    let key = keychain_key(account_id);
    delete_chunked_entries(&key);
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
pub fn refresh_access_token(http: &reqwest::Client, auth: &AuthJson) -> Result<AuthJson, String> {
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
    let body =
        tauri::async_runtime::block_on(resp.text()).map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        // refresh_token 是轮转的：一旦被其他设备/工具消费过（refresh_token_reused），
        // 本地存档就永久失效，无法自愈，只能重新登录或重新导入。
        let error_code = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("code"))
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_default();
        if error_code == "refresh_token_reused" {
            return Err(format!(
                "刷新失败: refresh_token_reused（Refresh Token 已被其他设备使用，请重新登录或重新导入该账号）"
            ));
        }
        return Err(format!(
            "刷新失败 HTTP {}: {}",
            status,
            crate::api::client::truncate_response(&body, 200)
        ));
    }

    let token_resp: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("解析刷新响应失败: {}", e))?;

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
    if token_resp
        .get("id_token")
        .and_then(|v| v.as_str())
        .is_some()
    {
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

/// 刷新指定账号的存档凭据，不改写当前 `auth.json`。
/// 后台轮询多账号时必须使用此路径，避免刷新非活动账号造成隐式切号。
pub fn refresh_and_store(
    http: &reqwest::Client,
    auth: &AuthJson,
    account_id: &str,
) -> Result<AuthJson, String> {
    let new_auth = refresh_access_token(http, auth)?;
    store_auth_to_keychain(account_id, &new_auth)?;
    Ok(new_auth)
}

/// 刷新某账号成功后调用：若该账号恰好是本机 `auth.json` 的当前档案，则同步写回。
/// refresh_token 是轮转的，本机滞留旧 token 时 CLI 的下一次刷新会把
/// Keychain 新档顶成 reused；同步后三方（本机/Keychain/服务端）保持单一轮转链。
pub fn sync_refreshed_auth_to_local(new_auth: &AuthJson) {
    let matches = read_local_auth_json()
        .map(|local| {
            !local.tokens.account_id.is_empty()
                && local.tokens.account_id == new_auth.tokens.account_id
        })
        .unwrap_or(false);
    if !matches {
        return;
    }
    if let Err(error) = write_local_auth_json(new_auth) {
        eprintln!("同步本机 auth.json 失败: {error}");
    }
}

pub fn refresh_and_store_with_fallback(
    primary: &reqwest::Client,
    fallback: &reqwest::Client,
    auth: &AuthJson,
    account_id: &str,
) -> Result<AuthJson, String> {
    match refresh_and_store(primary, auth, account_id) {
        Err(primary_error) if primary_error.starts_with("刷新请求失败:") => {
            eprintln!("Codex token 代理刷新失败，尝试直连重试: {}", primary_error);
            refresh_and_store(fallback, auth, account_id)
        }
        result => result,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::write_sensitive_file;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn sensitive_file_writer_restricts_existing_file_permissions() {
        let path = std::env::temp_dir().join(format!(
            "glm-quota-monitor-sensitive-{}.json",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        write_sensitive_file(&path, b"new").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        let content = std::fs::read_to_string(&path).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(mode, 0o600);
        assert_eq!(content, "new");
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    fn make_auth(access_len: usize) -> AuthJson {
        crate::codex::types::AuthJson {
            openai_api_key: None,
            last_refresh: Some("2026-01-01T00:00:00Z".into()),
            tokens: crate::codex::types::Tokens {
                access_token: "a".repeat(access_len),
                refresh_token: "r".repeat(211),
                id_token: "i".repeat(1766),
                account_id: "win-chunk-test-account".into(),
            },
        }
    }

    #[test]
    fn chunked_roundtrip_long_and_short() {
        for access_len in [1800usize, 5] {
            let account_id = format!("chunk-test-{access_len}");
            let auth = make_auth(access_len);
            store_auth_to_keychain(&account_id, &auth).unwrap();
            let read = read_auth_from_keychain(&account_id).unwrap();
            assert_eq!(read.tokens.access_token, auth.tokens.access_token);
            assert_eq!(read.tokens.refresh_token, auth.tokens.refresh_token);
            assert_eq!(read.tokens.account_id, auth.tokens.account_id);
            // id_token 完整保留（codex CLI 依赖它校验登录态）
            assert_eq!(read.tokens.id_token, auth.tokens.id_token);
            delete_auth_from_keychain(&account_id).unwrap();
            assert!(read_auth_from_keychain(&account_id).is_err());
        }
    }

    #[test]
    fn legacy_single_entry_still_readable() {
        let account_id = "legacy-read-test";
        let key = keychain_key(account_id);
        // 老数据：单条目、无 C1| 前缀、JSON 本身不超单条上限（id_token 短）
        let mut auth = make_auth(20);
        auth.tokens.id_token = "i".repeat(20);
        let json = serde_json::to_string(&auth).unwrap();
        assert!(json.len() <= 1280, "fixture too large: {}", json.len());
        keyring::Entry::new(crate::crypto::SERVICE_NAME, &key)
            .unwrap()
            .set_password(&json)
            .unwrap();
        // 老格式：无 C1| 前缀 → 原样解析
        let read = read_auth_from_keychain(account_id).unwrap();
        assert_eq!(read.tokens.access_token, "a".repeat(20));
        assert_eq!(read.tokens.id_token, "i".repeat(20));
        delete_auth_from_keychain(account_id).unwrap();
        assert!(read_auth_from_keychain(account_id).is_err());
    }
}
