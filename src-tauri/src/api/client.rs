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
    pub fn new(api_key: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
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

        let body: ApiResponse<T> = resp.json().await?;

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
        let path = format!(
            "/api/monitor/usage/model-usage?startTime={}&endTime={}",
            start_time, end_time
        );
        self.get(&path).await
    }

    /// 查询工具用量
    pub async fn get_tool_usage(
        &self,
        start_time: &str,
        end_time: &str,
    ) -> Result<ToolUsageData, ApiError> {
        let path = format!(
            "/api/monitor/usage/tool-usage?startTime={}&endTime={}",
            start_time, end_time
        );
        self.get(&path).await
    }
}
