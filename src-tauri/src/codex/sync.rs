use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};

/// 从 Gist raw URL 拉取加密内容
/// 私密 Gist 的 raw URL 匿名可访问（"未列出"特性），内容已 AES 加密
pub async fn fetch_from_gist(http: &reqwest::Client, raw_url: &str) -> Result<String, String> {
    let resp = http
        .get(raw_url)
        .header(USER_AGENT, "glm-quota-monitor")
        .send()
        .await
        .map_err(|e| format!("拉取 Gist 失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Gist 返回 HTTP {}", resp.status()));
    }

    let text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    Ok(text.trim().to_string())
}

/// Gist API 响应中单个文件的结构
#[derive(Debug, Deserialize, Serialize)]
struct GistFile {
    filename: String,
    #[serde(rename = "raw_url")]
    raw_url: Option<String>,
    content: Option<String>,
}

/// Gist API 响应结构
#[derive(Debug, Deserialize)]
struct Gist {
    id: String,
    files: std::collections::HashMap<String, GistFile>,
}

/// 从 Gist ID 解析出第一个文件的 raw_url
/// 需要 GitHub token（私密 gist REST API 需要认证）
pub async fn resolve_gist_raw_url(
    http: &reqwest::Client,
    gist_url_or_id: &str,
    github_token: &str,
) -> Result<String, String> {
    let gist_id = extract_gist_id(gist_url_or_id)?;
    let url = format!("https://api.github.com/gists/{}", gist_id);

    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("glm-quota-monitor"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.github+json"));
    // Token 可选：gist 是 unlisted，匿名也能访问单个 gist；
    // 有 token 时携带（提升 GitHub API 速率限制），为空时匿名请求
    if !github_token.is_empty() {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", github_token))
                .map_err(|_| "无效的 GitHub Token".to_string())?,
        );
    }

    let resp = http
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("查询 Gist 失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Gist API 返回 HTTP {}：请检查 Token 是否有 gist 权限",
            resp.status()
        ));
    }

    let gist: Gist = resp
        .json()
        .await
        .map_err(|e| format!("解析 Gist 响应失败: {}", e))?;

    let file = gist
        .files
        .into_values()
        .next()
        .ok_or("Gist 中没有文件")?;

    file.raw_url.ok_or("Gist 文件缺少 raw_url".to_string())
}

const ACCEPT: &str = "accept";

/// 从各种格式提取 Gist ID
/// 支持：
///   - "abc123"（纯 ID）
///   - "https://gist.github.com/user/abc123"
///   - "https://gist.githubusercontent.com/user/abc123/raw/file"
fn extract_gist_id(input: &str) -> Result<String, String> {
    let input = input.trim();
    if !input.contains('/') {
        return Ok(input.to_string());
    }
    // 从 URL 中提取：最后一段路径去掉 query/fragment
    let path_part = input.split('?').next().unwrap_or(input);
    let segments: Vec<&str> = path_part.split('/').filter(|s| !s.is_empty()).collect();
    // gist URL 格式：.../{gist_id}[/...]，gist ID 通常是倒数第二或最后一段
    for seg in segments.iter().rev() {
        // Gist ID 通常 20-32 位十六进制/字母数字
        if seg.len() >= 20
            && seg
                .chars()
                .all(|c| c.is_ascii_alphanumeric())
        {
            return Ok(seg.to_string());
        }
    }
    // 回退：取最后一段
    segments
        .last()
        .map(|s| s.to_string())
        .ok_or_else(|| "无法从 URL 提取 Gist ID".to_string())
}

/// 上传加密内容到 Gist（需要 GitHub Token + Gist ID）
/// 通过 PATCH 更新已有 Gist 的文件内容
pub async fn push_to_gist(
    http: &reqwest::Client,
    gist_url_or_id: &str,
    github_token: &str,
    encrypted_content: &str,
) -> Result<(), String> {
    let gist_id = extract_gist_id(gist_url_or_id)?;
    let url = format!("https://api.github.com/gists/{}", gist_id);

    // 先查询现有 Gist 获取文件名
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", github_token))
            .map_err(|_| "无效的 GitHub Token".to_string())?,
    );
    headers.insert(USER_AGENT, HeaderValue::from_static("glm-quota-monitor"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.github+json"));

    let get_resp = http
        .get(&url)
        .headers(headers.clone())
        .send()
        .await
        .map_err(|e| format!("查询 Gist 失败: {}", e))?;

    if !get_resp.status().is_success() {
        return Err(format!("查询 Gist 失败: HTTP {}", get_resp.status()));
    }

    let gist: Gist = get_resp
        .json()
        .await
        .map_err(|e| format!("解析 Gist 失败: {}", e))?;

    let filename = gist
        .files
        .keys()
        .next()
        .cloned()
        .ok_or("Gist 中没有文件")?;

    // PATCH 更新文件内容
    #[derive(Serialize)]
    struct UpdatePayload {
        files: std::collections::HashMap<String, FileUpdate>,
    }
    #[derive(Serialize)]
    struct FileUpdate {
        content: String,
    }

    let mut files = std::collections::HashMap::new();
    files.insert(
        filename,
        FileUpdate {
            content: encrypted_content.to_string(),
        },
    );
    let payload = UpdatePayload { files };

    let resp = http
        .patch(&url)
        .headers(headers)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("更新 Gist 失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("更新 Gist 失败: HTTP {} | {}", status, body));
    }

    Ok(())
}
