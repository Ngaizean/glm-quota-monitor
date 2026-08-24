//! sub2api REST 客户端。
//!
//! 响应统一包装为 `{"code": 0, "message": "success", "data": ...}`，
//! code != 0 视为业务失败，message 带错误原因。

use serde_json::{json, Value};

use super::{AccountInfo, GroupInfo, ImportStats};

pub struct Sub2ApiClient {
    pub base_url: String,
    http: reqwest::Client,
    token: Option<String>,
}

/// 从响应 JSON 中取出 data 字段，code != 0 时报错
fn unwrap_data(body: &str, context: &str) -> Result<Value, String> {
    let v: Value =
        serde_json::from_str(body).map_err(|e| format!("{context}: 响应不是 JSON ({e})"))?;
    let code = v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
    if code != 0 {
        let msg = v
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("未知错误");
        return Err(format!("{context}: {msg}"));
    }
    Ok(v.get("data").cloned().unwrap_or(Value::Null))
}

impl Sub2ApiClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            // sub2api 在本机/局域网，直连且不读环境代理
            http: reqwest::Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            token: None,
        }
    }

    fn auth_header(&self) -> Result<String, String> {
        match &self.token {
            Some(t) => Ok(format!("Bearer {t}")),
            None => Err("未登录 sub2api".to_string()),
        }
    }

    /// 管理员登录，缓存 access_token
    pub async fn login(&mut self, email: &str, password: &str) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/v1/auth/login", self.base_url))
            .json(&json!({ "email": email, "password": password }))
            .send()
            .await
            .map_err(|e| format!("连接 sub2api 失败: {e}"))?;
        let body = resp.text().await.unwrap_or_default();
        let data = unwrap_data(&body, "登录失败")?;
        let token = data
            .get("access_token")
            .and_then(|t| t.as_str())
            .ok_or("登录响应缺少 access_token")?;
        self.token = Some(token.to_string());
        Ok(())
    }

    /// 健康检查（不需要登录）
    pub async fn health(&self) -> Result<(), String> {
        let resp = self
            .http
            .get(format!("{}/health", self.base_url))
            .send()
            .await
            .map_err(|e| format!("无法连接 {}/health: {e}", self.base_url))?;
        if !resp.status().is_success() {
            return Err(format!("health 返回 {}", resp.status()));
        }
        Ok(())
    }

    /// 导入账号数据（body 为 sub2api 导出格式的 data 对象）
    pub async fn import_accounts(&self, data: &Value) -> Result<ImportStats, String> {
        let resp = self
            .http
            .post(format!("{}/api/v1/admin/accounts/data", self.base_url))
            .header("Authorization", self.auth_header()?)
            .json(&json!({ "data": data, "skip_default_group_bind": false }))
            .send()
            .await
            .map_err(|e| format!("导入请求失败: {e}"))?;
        let body = resp.text().await.unwrap_or_default();
        let data = unwrap_data(&body, "导入失败")?;
        Ok(ImportStats {
            account_created: data
                .get("account_created")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            account_failed: data
                .get("account_failed")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            errors: Vec::new(),
        })
    }

    pub async fn list_groups(&self) -> Result<Vec<GroupInfo>, String> {
        let resp = self
            .http
            .get(format!("{}/api/v1/admin/groups", self.base_url))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| format!("获取分组失败: {e}"))?;
        let body = resp.text().await.unwrap_or_default();
        let data = unwrap_data(&body, "获取分组失败")?;
        let items = data
            .get("items")
            .and_then(|i| i.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(items
            .into_iter()
            .filter_map(|g| {
                Some(GroupInfo {
                    id: g.get("id")?.as_i64()?,
                    name: g.get("name")?.as_str()?.to_string(),
                    platform: g.get("platform")?.as_str()?.to_string(),
                    status: g
                        .get("status")
                        .and_then(|s| s.as_str())
                        .unwrap_or("active")
                        .to_string(),
                })
            })
            .collect())
    }

    /// 创建分组（platform 如 openai；rate_multiplier 必填且 > 0）
    pub async fn create_group(&self, name: &str, platform: &str) -> Result<GroupInfo, String> {
        let resp = self
            .http
            .post(format!("{}/api/v1/admin/groups", self.base_url))
            .header("Authorization", self.auth_header()?)
            .json(&json!({ "name": name, "platform": platform, "rate_multiplier": 1 }))
            .send()
            .await
            .map_err(|e| format!("创建分组失败: {e}"))?;
        let body = resp.text().await.unwrap_or_default();
        let data = unwrap_data(&body, "创建分组失败")?;
        Ok(GroupInfo {
            id: data.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
            name: data
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(name)
                .to_string(),
            platform: platform.to_string(),
            status: "active".to_string(),
        })
    }

    /// 绑定账号到分组（幂等：重复绑定同一分组无副作用）
    pub async fn bind_account_groups(
        &self,
        account_id: i64,
        group_ids: &[i64],
    ) -> Result<(), String> {
        let resp = self
            .http
            .put(format!(
                "{}/api/v1/admin/accounts/{account_id}",
                self.base_url
            ))
            .header("Authorization", self.auth_header()?)
            .json(&json!({ "group_ids": group_ids }))
            .send()
            .await
            .map_err(|e| format!("绑定分组失败: {e}"))?;
        let body = resp.text().await.unwrap_or_default();
        unwrap_data(&body, "绑定分组失败")?;
        Ok(())
    }

    pub async fn list_accounts(&self) -> Result<Vec<AccountInfo>, String> {
        let resp = self
            .http
            .get(format!("{}/api/v1/admin/accounts", self.base_url))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| format!("获取账号列表失败: {e}"))?;
        let body = resp.text().await.unwrap_or_default();
        let data = unwrap_data(&body, "获取账号列表失败")?;
        let items = data
            .get("items")
            .and_then(|i| i.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(items
            .into_iter()
            .filter_map(|a| {
                Some(AccountInfo {
                    id: a.get("id")?.as_i64()?,
                    name: a.get("name")?.as_str()?.to_string(),
                    platform: a.get("platform")?.as_str()?.to_string(),
                    r#type: a
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string(),
                    status: a
                        .get("status")
                        .and_then(|s| s.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                })
            })
            .collect())
    }

    /// 确保 API Key 存在（按名字找，找不到则创建并绑定分组），返回明文 key
    pub async fn ensure_api_key(&self, name: &str, group_id: i64) -> Result<String, String> {
        let resp = self
            .http
            .get(format!("{}/api/v1/keys", self.base_url))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| format!("获取密钥列表失败: {e}"))?;
        let body = resp.text().await.unwrap_or_default();
        let data = unwrap_data(&body, "获取密钥列表失败")?;
        if let Some(items) = data.get("items").and_then(|i| i.as_array()) {
            for item in items {
                let matched = item.get("name").and_then(|n| n.as_str()) == Some(name);
                let active = item.get("status").and_then(|s| s.as_str()) == Some("active");
                if matched && active {
                    if let Some(key) = item.get("key").and_then(|k| k.as_str()) {
                        // 已存在但分组不同 → 更新绑定
                        let current_group =
                            item.get("group_id").and_then(|g| g.as_i64()).unwrap_or(0);
                        if current_group != group_id {
                            let id = item.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                            let _ = self
                                .http
                                .put(format!("{}/api/v1/keys/{id}", self.base_url))
                                .header("Authorization", self.auth_header()?)
                                .json(&json!({ "name": name, "group_id": group_id }))
                                .send()
                                .await;
                        }
                        return Ok(key.to_string());
                    }
                }
            }
        }

        // 创建
        let resp = self
            .http
            .post(format!("{}/api/v1/keys", self.base_url))
            .header("Authorization", self.auth_header()?)
            .json(&json!({ "name": name, "group_id": group_id }))
            .send()
            .await
            .map_err(|e| format!("创建密钥失败: {e}"))?;
        let body = resp.text().await.unwrap_or_default();
        let data = unwrap_data(&body, "创建密钥失败")?;
        data.get("key")
            .and_then(|k| k.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "创建密钥响应缺少 key".to_string())
    }

    /// 给指定用户充值余额，返回充值后余额
    pub async fn topup(&self, user_id: i64, amount: f64) -> Result<f64, String> {
        let resp = self
            .http
            .post(format!(
                "{}/api/v1/admin/users/{user_id}/balance",
                self.base_url
            ))
            .header("Authorization", self.auth_header()?)
            .json(&json!({ "balance": amount, "operation": "add", "notes": "quota-monitor topup" }))
            .send()
            .await
            .map_err(|e| format!("充值失败: {e}"))?;
        let body = resp.text().await.unwrap_or_default();
        let data = unwrap_data(&body, "充值失败")?;
        Ok(data.get("balance").and_then(|b| b.as_f64()).unwrap_or(0.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwrap_data_extracts_payload() {
        let v = unwrap_data(r#"{"code":0,"message":"success","data":{"x":1}}"#, "ctx").unwrap();
        assert_eq!(v["x"], 1);
    }

    #[test]
    fn unwrap_data_reports_business_error() {
        let err = unwrap_data(r#"{"code":401,"message":"token expired"}"#, "登录").unwrap_err();
        assert!(err.contains("token expired"));
    }

    #[test]
    fn unwrap_data_rejects_non_json() {
        assert!(unwrap_data("<html>502</html>", "导入").is_err());
    }
}
