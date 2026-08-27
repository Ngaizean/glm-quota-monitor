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

fn build_usage_request(
    http: &reqwest::Client,
    access_token: &str,
    account_id: &str,
) -> reqwest::RequestBuilder {
    let request = http
        .get(USAGE_URL)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json");
    if account_id.trim().is_empty() {
        request
    } else {
        request.header("ChatGPT-Account-Id", account_id.trim())
    }
}

impl CodexClient {
    /// 用 access_token 查询额度
    pub async fn get_usage(
        http: &reqwest::Client,
        access_token: &str,
        account_id: &str,
    ) -> Result<UsageResponse, CodexApiError> {
        if access_token.is_empty() {
            return Err(CodexApiError::NoAccessToken);
        }

        let resp = build_usage_request(http, access_token, account_id)
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
        let usage: UsageResponse = serde_json::from_str(&text).map_err(|e| {
            CodexApiError::Parse(format!(
                "{} | 原始响应: {}",
                e,
                &text[..text.len().min(300)]
            ))
        })?;

        Ok(usage)
    }

    /// 优先使用代理 client，网络层失败时回退到直连。
    pub async fn get_usage_with_fallback(
        primary: &reqwest::Client,
        fallback: &reqwest::Client,
        access_token: &str,
        account_id: &str,
    ) -> Result<UsageResponse, CodexApiError> {
        match Self::get_usage(primary, access_token, account_id).await {
            Err(CodexApiError::Request(primary_error)) => {
                eprintln!("Codex usage 代理请求失败，尝试直连重试: {}", primary_error);
                Self::get_usage(fallback, access_token, account_id).await
            }
            result => result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_usage_request_carries_chatgpt_account_id() {
        let client = reqwest::Client::new();
        let request = build_usage_request(&client, "access-token", "account-123")
            .build()
            .unwrap();

        assert_eq!(
            request
                .headers()
                .get("ChatGPT-Account-Id")
                .and_then(|value| value.to_str().ok()),
            Some("account-123")
        );
    }
}
