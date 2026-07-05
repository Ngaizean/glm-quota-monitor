use super::types::UsageResponse;
use thiserror::Error;

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

#[derive(Error, Debug)]
pub enum CodexApiError {
    #[error("HTTP 请求失败: {0}")]
    Request(#[from] reqwest::Error),
    #[error("Codex API 返回错误: HTTP {0}")]
    Http(reqwest::StatusCode),
    /// Token 被吊销（不是过期），需要重新登录 Codex
    #[error("Token 已被吊销，请重新登录 Codex")]
    TokenInvalidated,
    #[error("响应解析失败: {0}")]
    Parse(String),
    #[error("无 access_token，凭证可能已失效")]
    NoAccessToken,
}

/// Codex 额度查询客户端
/// wham/usage 端点用 access_token 作为 Bearer 认证
pub struct CodexClient;

impl CodexClient {
    /// 用 access_token 查询额度
    pub async fn get_usage(
        http: &reqwest::Client,
        access_token: &str,
    ) -> Result<UsageResponse, CodexApiError> {
        if access_token.is_empty() {
            return Err(CodexApiError::NoAccessToken);
        }

        let resp = http
            .get(USAGE_URL)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Accept", "application/json")
            .send()
            .await?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            // 检查是否是 token 被吊销（区别于普通过期）
            let error_code = resp
                .headers()
                .get("x-openai-ide-error-code")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            if error_code == "token_invalidated" {
                return Err(CodexApiError::TokenInvalidated);
            }
            return Err(CodexApiError::Http(status));
        }
        if !status.is_success() {
            return Err(CodexApiError::Http(status));
        }

        let text = resp.text().await?;
        let usage: UsageResponse = serde_json::from_str(&text)
            .map_err(|e| CodexApiError::Parse(format!("{} | 原始响应: {}", e, &text[..text.len().min(300)])))?;

        Ok(usage)
    }
}
