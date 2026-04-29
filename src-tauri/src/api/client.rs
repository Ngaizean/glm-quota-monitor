use super::types::*;
use thiserror::Error;

const BASE_URL: &str = "https://open.bigmodel.cn";

#[derive(Error, Debug)]
pub enum ApiError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("API returned error code {code}: {msg}")]
    Api { code: i32, msg: String },
    #[error("Invalid API key")]
    Unauthorized,
}

pub struct ZhipuClient {
    client: reqwest::Client,
    api_key: String,
}

impl ZhipuClient {
    pub fn with_client(client: &reqwest::Client, api_key: &str) -> Self {
        Self {
            client: client.clone(),
            api_key: api_key.to_string(),
        }
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, ApiError> {
        let url = format!("{}{}", BASE_URL, path);
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ApiError::Unauthorized);
        }

        // 先读取文本，解析失败时给出有意义的错误信息
        let text = resp.text().await?;
        let body: ApiResponse<T> = serde_json::from_str(&text).map_err(|e| {
            let preview = if text.len() > 300 {
                format!("{}...(truncated)", &text[..300])
            } else {
                text.clone()
            };
            ApiError::Api {
                code: -1,
                msg: format!("响应解析失败: {} | 原始响应: {}", e, preview),
            }
        })?;

        if !body.success || body.code != 200 {
            return Err(ApiError::Api {
                code: body.code,
                msg: body.msg.unwrap_or_default(),
            });
        }

        body.data.ok_or_else(|| ApiError::Api {
            code: body.code,
            msg: "No data in response".to_string(),
        })
    }

    /// 查询额度限制
    pub async fn get_quota_limit(&self) -> Result<QuotaData, ApiError> {
        self.get("/api/monitor/usage/quota/limit").await
    }

    /// 查询模型用量
    pub async fn get_model_usage(
        &self,
        start_time: &str,
        end_time: &str,
    ) -> Result<ModelUsageData, ApiError> {
        let url = reqwest::Url::parse_with_params(
            &format!("{}{}", BASE_URL, "/api/monitor/usage/model-usage"),
            &[("startTime", start_time), ("endTime", end_time)],
        )
        .map_err(|e| ApiError::Api {
            code: -1,
            msg: e.to_string(),
        })?;
        let path = url.path();
        let query = url.query().unwrap_or("");
        self.get(&format!("{}?{}", path, query)).await
    }

    /// 获取可用模型列表（OpenAI 兼容格式，不走 ApiResponse 包装）
    pub async fn list_models(&self) -> Result<ModelListResponse, ApiError> {
        let url = format!("{}/api/paas/v4/models", BASE_URL);
        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ApiError::Unauthorized);
        }

        let text = resp.text().await?;
        serde_json::from_str(&text).map_err(|e| ApiError::Api {
            code: -1,
            msg: format!("模型列表解析失败: {}", e),
        })
    }

    /// 空转：使用 Coding Plan 的 Anthropic 兼容接口触发额度计时器
    pub async fn spin_with_model(&self, model: &str) -> Result<(), ApiError> {
        let url = format!("{}/api/anthropic/v1/messages", BASE_URL);
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "hi"}]
            }))
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ApiError::Unauthorized);
        }

        let status = resp.status();
        if status.is_success() {
            return Ok(());
        }

        let text = resp.text().await.unwrap_or_default();
        Err(ApiError::Api {
            code: status.as_u16() as i32,
            msg: if text.is_empty() {
                format!("空转请求失败: HTTP {}", status)
            } else {
                text
            },
        })
    }
}
