//! 从粘贴的 JSON 文本导入 Codex 账号。
//!
//! 支持三种格式（自动识别）：
//! 1. sub2api 导出格式：`{"accounts": [{"name", "platform", "credentials": {access_token, refresh_token, id_token, ...}}]}`
//! 2. ~/.codex/auth.json 格式：`{"OPENAI_API_KEY", "tokens": {access_token, id_token, refresh_token, account_id}}`
//! 3. 裸 JWT access_token 字符串

use serde::Serialize;

use super::types::AuthJson;

/// 解析出的待导入账号（token 只在后端流转，预览结构不含明文）
#[derive(Debug, Clone, Serialize)]
pub struct ParsedCodexAccount {
    /// 建议别名（优先 email，其次 JSON 内 name，最后 account_id 前缀）
    pub suggested_alias: String,
    pub email: Option<String>,
    /// 从 access_token JWT 解出的套餐类型（如 plus / k12）
    pub plan_type: Option<String>,
    /// chatgpt_workspace/账号 ID（JWT 内 chatgpt_account_id）
    pub account_id: String,
    pub has_refresh_token: bool,
    /// 标准 AuthJson，可直接走 Keychain 存取与刷新链
    pub auth: AuthJson,
    /// 来源格式："sub2api" / "authjson" / "bare"（前端据此决定是否自动开启 sub2api 功能）
    pub format: &'static str,
}

/// 解析 JWT payload（不验签，仅读取声明）
fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    use base64::Engine;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(parts[1]))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn jwt_str(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

/// 从 sub2api credentials 对象提取 token 三件套
fn tokens_from_credentials(cred: &serde_json::Value) -> (String, String, String) {
    let get = |k: &str| {
        cred.get(k)
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string()
    };
    (get("access_token"), get("refresh_token"), get("id_token"))
}

/// 由 access_token JWT 组装完整的 ParsedCodexAccount
fn build_from_tokens(
    access_token: String,
    refresh_token: String,
    id_token: String,
    fallback_alias: Option<&str>,
    format: &'static str,
) -> Result<ParsedCodexAccount, String> {
    if access_token.is_empty() {
        return Err("缺少 access_token".to_string());
    }
    if decode_jwt_payload(&access_token).is_none() {
        return Err("access_token 不是有效的 JWT".to_string());
    }

    let claims = decode_jwt_payload(&access_token).unwrap_or_default();
    let auth_namespace = claims
        .get("https://api.openai.com/auth")
        .cloned()
        .unwrap_or_default();

    // email 在 https://api.openai.com/profile 命名空间下
    let email = claims
        .get("https://api.openai.com/profile")
        .and_then(|p| p.get("email"))
        .and_then(|e| e.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    let account_id = jwt_str(&auth_namespace, "chatgpt_account_id")
        .or_else(|| jwt_str(&claims, "sub"))
        .unwrap_or_default();

    let plan_type = jwt_str(&auth_namespace, "chatgpt_plan_type").filter(|s| !s.is_empty());

    let suggested_alias = fallback_alias
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| email.clone())
        .unwrap_or_else(|| {
            let tail = account_id.split('-').next_back().unwrap_or("codex");
            format!("codex-{}", &tail[..tail.len().min(8)])
        });

    Ok(ParsedCodexAccount {
        suggested_alias,
        email,
        plan_type,
        account_id: account_id.clone(),
        has_refresh_token: !refresh_token.is_empty(),
        auth: AuthJson {
            openai_api_key: None,
            last_refresh: None,
            tokens: super::types::Tokens {
                access_token,
                id_token,
                refresh_token,
                account_id,
            },
        },
        format,
    })
}

/// 解析粘贴的 JSON 文本，识别格式并提取全部 Codex 账号。
pub fn parse_codex_accounts_json(text: &str) -> Result<Vec<ParsedCodexAccount>, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("内容为空".to_string());
    }

    // 格式 3：裸 JWT
    if !trimmed.starts_with('{') && !trimmed.starts_with('[') {
        return Ok(vec![build_from_tokens(
            trimmed.to_string(),
            String::new(),
            String::new(),
            None,
            "bare",
        )?]);
    }

    let root: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("JSON 解析失败: {e}"))?;

    // 格式 1：sub2api 导出（accounts 数组）
    if let Some(accounts) = root.get("accounts").and_then(|a| a.as_array()) {
        let mut out = Vec::new();
        for (idx, acc) in accounts.iter().enumerate() {
            if acc
                .get("platform")
                .and_then(|p| p.as_str())
                .map(|p| p != "openai")
                .unwrap_or(false)
            {
                continue; // 只导入 openai 平台账号
            }
            let cred = acc
                .get("credentials")
                .ok_or_else(|| format!("accounts[{idx}] 缺少 credentials"))?;
            let (at, rt, it) = tokens_from_credentials(cred);
            let name = acc.get("name").and_then(|n| n.as_str());
            out.push(build_from_tokens(at, rt, it, name, "sub2api")?);
        }
        if out.is_empty() {
            return Err("未在 accounts 中找到 openai 平台账号".to_string());
        }
        return Ok(out);
    }

    // 格式 2：auth.json（tokens 对象）
    if let Some(tokens) = root.get("tokens") {
        let (at, rt, it) = tokens_from_credentials(tokens);
        return Ok(vec![build_from_tokens(at, rt, it, None, "authjson")?]);
    }

    // 扁平单对象（cliProxyAPI 风格：顶层直接放 access_token）
    if root.get("access_token").is_some() {
        let (at, rt, it) = tokens_from_credentials(&root);
        return Ok(vec![build_from_tokens(at, rt, it, None, "authjson")?]);
    }

    Err("无法识别的 JSON 格式：需要 sub2api 导出、auth.json 或裸 access_token".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_JWT: &str = "eyJhbGciOiJSUzI1NiJ9.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYTIyNWRiZDEtMmQ4OSIsImNoYXRncHRfcGxhbl90eXBlIjoiazEyIn0sImV4cCI6MTc4ODA3ODY0Nn0.sig";

    #[test]
    fn parses_sub2api_export() {
        let json = format!(
            r#"{{
                "type": "sub2api-data",
                "version": 1,
                "proxies": [],
                "accounts": [
                    {{
                        "name": "k12-test",
                        "platform": "openai",
                        "type": "oauth",
                        "credentials": {{
                            "access_token": "{SAMPLE_JWT}",
                            "refresh_token": "rt-1",
                            "id_token": "id-1",
                            "chatgpt_account_id": "a225dbd1-2d89",
                            "email": "a@b.com",
                            "expires_at": 1788078646
                        }},
                        "concurrency": 10,
                        "priority": 1
                    }},
                    {{
                        "name": "skip-me",
                        "platform": "gemini",
                        "credentials": {{}}
                    }}
                ]
            }}"#
        );
        let out = parse_codex_accounts_json(&json).expect("应解析成功");
        assert_eq!(out.len(), 1, "非 openai 平台应被跳过");
        assert_eq!(out[0].suggested_alias, "k12-test");
        assert_eq!(out[0].plan_type.as_deref(), Some("k12"));
        assert_eq!(out[0].account_id, "a225dbd1-2d89");
        assert!(out[0].has_refresh_token);
        assert_eq!(out[0].auth.tokens.refresh_token, "rt-1");
        assert_eq!(out[0].format, "sub2api");
    }

    #[test]
    fn parses_auth_json_format() {
        let json = format!(
            r#"{{"OPENAI_API_KEY": null, "last_refresh": "2026-08-20",
                "tokens": {{"access_token": "{SAMPLE_JWT}", "id_token": "", "refresh_token": "rt-2", "account_id": "ignored"}}}}"#
        );
        let out = parse_codex_accounts_json(&json).expect("应解析成功");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].plan_type.as_deref(), Some("k12"));
        // JWT 内的 chatgpt_account_id 优先于 auth.json 顶层 account_id
        assert_eq!(out[0].account_id, "a225dbd1-2d89");
        assert_eq!(out[0].format, "authjson");
    }

    #[test]
    fn parses_bare_jwt() {
        let out = parse_codex_accounts_json(SAMPLE_JWT).expect("应解析成功");
        assert_eq!(out.len(), 1);
        assert!(!out[0].has_refresh_token);
        assert_eq!(out[0].format, "bare");
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_codex_accounts_json("hello").is_err());
        assert!(parse_codex_accounts_json("{}").is_err());
        assert!(parse_codex_accounts_json("not a jwt").is_err());
    }
}
