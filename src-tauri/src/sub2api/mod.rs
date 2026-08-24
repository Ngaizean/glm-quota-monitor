//! sub2api 网关管理：登录、账号导入、分组绑定、API Key、余额充值。
//!
//! 所有请求直连（sub2api 部署在本机/局域网），不走 PROXY_CLIENT。

pub mod client;
pub mod codex_config;

use serde::Serialize;

pub use client::Sub2ApiClient;

/// 导入接口返回的统计
#[derive(Debug, Clone, Serialize, Default)]
pub struct ImportStats {
    pub account_created: u32,
    pub account_failed: u32,
    /// 导入失败的原因摘要
    pub errors: Vec<String>,
}

/// 分组信息（只取需要的字段）
#[derive(Debug, Clone, Serialize)]
pub struct GroupInfo {
    pub id: i64,
    pub name: String,
    pub platform: String,
    pub status: String,
}

/// 账号信息（列表展示用）
#[derive(Debug, Clone, Serialize)]
pub struct AccountInfo {
    pub id: i64,
    pub name: String,
    pub platform: String,
    pub r#type: String,
    pub status: String,
}

/// 一键部署的整体结果
#[derive(Debug, Clone, Serialize)]
pub struct DeployResult {
    pub import_stats: ImportStats,
    pub group_name: String,
    pub api_key: String,
    /// 导入并绑定分组的账号 ID（sub2api 侧）
    pub bound_account_ids: Vec<i64>,
}
