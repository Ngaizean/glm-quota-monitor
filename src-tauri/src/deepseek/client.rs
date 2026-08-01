use super::types::{BalanceResponse, ModelsResponse};
use serde::de::DeserializeOwned;
use thiserror::Error;

const BALANCE_URL: &str = "https://api.deepseek.com/user/balance";
const MODELS_URL: &str = "https://api.deepseek.com/models";

#[derive(Error, Debug)]
pub enum DeepSeekApiError {
    #[error("HTTP 请求失败: {0}")]
    Request(#[from] reqwest::Error),
    #[error("DeepSeek API 返回错误: HTTP {0}")]
    Http(reqwest::StatusCode),
    /// 401 —— API Key 无效或未授权
    #[error("DeepSeek API Key 无效或未授权")]
    InvalidKey,
    /// 402 —— 余额不足（key 仍有效，区别于 InvalidKey）
    #[error("DeepSeek 余额不足")]
    InsufficientBalance,
    /// 429 —— 请求过于频繁
    #[error("DeepSeek 请求过于频繁（429）")]
    RateLimited,
    #[error("响应解析失败: {0}")]
    Parse(String),
    #[error("无 API Key")]
    NoApiKey,
}

/// DeepSeek 余额/模型查询客户端。
///
/// api.deepseek.com 为国内域名，使用直连 `HTTP_CLIENT`（lib.rs），不走 PROXY_CLIENT。
/// 鉴权：`Authorization: Bearer <API_KEY>`（与 /chat/completions 同一把 key）。
pub struct DeepSeekClient;

impl DeepSeekClient {
    /// 查询账户余额（total / granted / topped_up，可能多币种）
    pub async fn get_balance(
        http: &reqwest::Client,
        api_key: &str,
    ) -> Result<BalanceResponse, DeepSeekApiError> {
        if api_key.is_empty() {
            return Err(DeepSeekApiError::NoApiKey);
        }
        let resp = http
            .get(BALANCE_URL)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Accept", "application/json")
            .send()
            .await?;
        Self::parse(resp).await
    }

    /// 查询可用模型列表（deepseek-v4-flash / deepseek-v4-pro）
    pub async fn get_models(
        http: &reqwest::Client,
        api_key: &str,
    ) -> Result<ModelsResponse, DeepSeekApiError> {
        if api_key.is_empty() {
            return Err(DeepSeekApiError::NoApiKey);
        }
        let resp = http
            .get(MODELS_URL)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Accept", "application/json")
            .send()
            .await?;
        Self::parse(resp).await
    }

    /// 统一处理状态码 + 反序列化。
    /// 401→InvalidKey、402→InsufficientBalance、429→RateLimited、其余非 2xx→Http。
    async fn parse<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T, DeepSeekApiError> {
        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(DeepSeekApiError::InvalidKey);
        }
        if status == reqwest::StatusCode::PAYMENT_REQUIRED {
            return Err(DeepSeekApiError::InsufficientBalance);
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(DeepSeekApiError::RateLimited);
        }
        if !status.is_success() {
            return Err(DeepSeekApiError::Http(status));
        }
        let text = resp.text().await?;
        serde_json::from_str(&text).map_err(|e| {
            DeepSeekApiError::Parse(format!("{} | 原始响应: {}", e, &text[..text.len().min(300)]))
        })
    }
}
