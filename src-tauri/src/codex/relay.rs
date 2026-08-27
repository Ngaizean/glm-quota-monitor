//! Codex 中转站（relay）额度通路。
//!
//! 官方 ChatGPT 登录走 `chatgpt.com/backend-api/wham/usage`（百分比窗口模型）；
//! 中转站（如 isaclab2api / sub2api 网关）是**钱包余额**模型，暴露
//! `GET {base_url}/v1/usage`（Bearer API Key），返回 balance/remaining/planName
//! 与今日/累计用量。本模块负责：
//!   1. 从 ~/.codex/config.toml 检测当前 model_provider 是否指向非官方端点；
//!   2. 拉取并解析 /v1/usage；
//!   3. 映射为统一 QuotaData（RELAY_BALANCE，绝对余额，同 DeepSeek 本位）。

use crate::api::types::{QuotaData, QuotaLimit};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 中转站余额 limit_type 标识（自由字符串，与 DEEPSEEK_BALANCE 同为绝对余额本位）。
pub const LIMIT_TYPE_RELAY_BALANCE: &str = "RELAY_BALANCE";

// ========== ~/.codex/config.toml 中转模式检测 ==========

/// 当前 Codex 配置指向的中转站信息
#[derive(Debug, Clone)]
pub struct RelayConfig {
    pub provider_name: String,
    pub base_url: String,
}

/// 可安全分发到远程 Codex 的完整中转配置。
#[derive(Debug, Clone)]
pub struct RelayDistributionConfig {
    pub provider_name: String,
    pub base_url: String,
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub wire_api: String,
    pub requires_openai_auth: bool,
}

/// config.toml 路径（与 auth.rs 的 auth_json_path 同源：固定 ~/.codex）
fn codex_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".codex").join("config.toml"))
}

/// 检测本机 Codex 是否配置了中转站：
/// 读 config.toml 顶层 `model_provider`，在 `[model_providers.<name>]` 里找 `base_url`，
/// host 非官方（chatgpt.com / openai.com 系）即视为中转站。
/// 任何一步缺失（文件不存在 / 键缺失 / 官方端点）返回 None（走官方通路）。
pub fn detect_local_relay_config() -> Option<RelayConfig> {
    let content = std::fs::read_to_string(codex_config_path()?).ok()?;
    relay_config_from_content(&content)
}

fn relay_config_from_content(content: &str) -> Option<RelayConfig> {
    let provider = find_top_level_string_key(content, "model_provider")?;
    let section = find_table_section(content, &format!("model_providers.{provider}"))?;
    let base_url = find_string_key_in(&section, "base_url")?;
    if base_url.trim().is_empty() || is_official_base_url(&base_url) {
        return None;
    }
    Some(RelayConfig {
        provider_name: provider,
        base_url,
    })
}

pub fn detect_local_relay_distribution_config() -> Option<RelayDistributionConfig> {
    let content = std::fs::read_to_string(codex_config_path()?).ok()?;
    relay_distribution_config_from_content(&content)
}

fn relay_distribution_config_from_content(content: &str) -> Option<RelayDistributionConfig> {
    let relay = relay_config_from_content(content)?;
    let section = find_table_section(content, &format!("model_providers.{}", relay.provider_name))?;
    Some(RelayDistributionConfig {
        provider_name: relay.provider_name,
        base_url: relay.base_url,
        model: find_top_level_string_key(content, "model")?,
        reasoning_effort: find_top_level_string_key(content, "model_reasoning_effort"),
        wire_api: find_string_key_in(&section, "wire_api")?,
        requires_openai_auth: find_bool_key_in(&section, "requires_openai_auth")?,
    })
}

/// 把当前中转站所需字段合并进远程 config.toml，保留远程其他表和 provider。
pub(crate) fn merge_relay_config(
    existing: &str,
    config: &RelayDistributionConfig,
) -> Result<String, String> {
    validate_distribution_config(config)?;

    let provider_table = format!("model_providers.{}", config.provider_name);
    let mut retained = Vec::new();
    let mut skipping_provider = false;
    for line in existing.lines() {
        if line.trim_start().starts_with('[') {
            skipping_provider = table_name(line).as_deref() == Some(provider_table.as_str());
        }
        if !skipping_provider {
            retained.push(line.to_string());
        }
    }

    let first_table = retained
        .iter()
        .position(|line| line.trim_start().starts_with('['))
        .unwrap_or(retained.len());
    let mut head = retained[..first_table].to_vec();
    set_top_level_string(&mut head, "model_provider", Some(&config.provider_name));
    set_top_level_string(&mut head, "model", Some(&config.model));
    set_top_level_string(
        &mut head,
        "model_reasoning_effort",
        config.reasoning_effort.as_deref(),
    );

    let mut merged = head;
    merged.extend_from_slice(&retained[first_table..]);
    while merged.last().is_some_and(|line| line.trim().is_empty()) {
        merged.pop();
    }
    if !merged.is_empty() {
        merged.push(String::new());
    }
    merged.extend([
        format!("[model_providers.{}]", config.provider_name),
        format!("name = \"{}\"", toml_escape(&config.provider_name)),
        format!("base_url = \"{}\"", toml_escape(&config.base_url)),
        format!("wire_api = \"{}\"", toml_escape(&config.wire_api)),
        format!("requires_openai_auth = {}", config.requires_openai_auth),
    ]);
    Ok(format!("{}\n", merged.join("\n")))
}

fn validate_distribution_config(config: &RelayDistributionConfig) -> Result<(), String> {
    if config.provider_name.is_empty()
        || !config
            .provider_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
    {
        return Err("中转 provider 名称含不安全字符".to_string());
    }
    for (label, value) in [
        ("base_url", config.base_url.as_str()),
        ("model", config.model.as_str()),
        ("wire_api", config.wire_api.as_str()),
    ] {
        if value.is_empty() || value.chars().any(char::is_control) {
            return Err(format!("中转配置 {label} 为空或含控制字符"));
        }
    }
    if config
        .reasoning_effort
        .as_deref()
        .is_some_and(|value| value.is_empty() || value.chars().any(char::is_control))
    {
        return Err("中转配置 model_reasoning_effort 为空或含控制字符".to_string());
    }
    Ok(())
}

fn set_top_level_string(lines: &mut Vec<String>, key: &str, value: Option<&str>) {
    let replacement = value.map(|value| format!("{key} = \"{}\"", toml_escape(value)));
    if let Some(index) = lines.iter().position(|line| {
        line.split_once('=')
            .is_some_and(|(candidate, _)| candidate.trim() == key)
    }) {
        if let Some(replacement) = replacement {
            lines[index] = replacement;
        } else {
            lines.remove(index);
        }
    } else if let Some(replacement) = replacement {
        lines.push(replacement);
    }
}

fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// 从 AuthJson 提取 OPENAI_API_KEY（字段是任意 JSON Value，仅接受字符串且非空）
pub fn api_key_from_auth(auth: &crate::codex::types::AuthJson) -> Option<String> {
    auth.openai_api_key
        .as_ref()
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 官方端点判定：host 是 chatgpt.com / openai.com / api.openai.com（含子域）算官方。
/// 其余（如内网穿透、自建网关）一律按中转站处理。
pub fn is_official_base_url(base_url: &str) -> bool {
    let host = extract_host(base_url);
    ["chatgpt.com", "openai.com", "api.openai.com"]
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

/// 提取 URL 的 host：去 scheme、去 path/query、去 userinfo 与端口，小写。
fn extract_host(url: &str) -> String {
    let rest = url
        .trim()
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url.trim());
    let host_port = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host_port
        .rsplit_once('@')
        .map(|(_, h)| h)
        .unwrap_or(host_port);
    host.split(':').next().unwrap_or("").to_ascii_lowercase()
}

/// 在 TOML 文本中找顶层（首个 `[table]` 之前）的 `key = "value"`。
fn find_top_level_string_key(content: &str, key: &str) -> Option<String> {
    for line in content
        .lines()
        .take_while(|l| !l.trim_start().starts_with('['))
    {
        if let Some(v) = parse_string_assignment(line, key) {
            return Some(v);
        }
    }
    None
}

/// 提取 `[table.name]` 段落的行集合（到下一个 `[` 表头为止）。
fn find_table_section<'a>(content: &'a str, table: &str) -> Option<Vec<&'a str>> {
    let mut lines = content.lines();
    let mut found = false;
    for line in lines.by_ref() {
        let t = line.trim();
        if t.starts_with('[') && table_name(t) == Some(table.to_string()) {
            found = true;
            break;
        }
    }
    if !found {
        return None;
    }
    let body: Vec<&str> = lines
        .take_while(|l| !l.trim_start().starts_with('['))
        .collect();
    (!body.is_empty()).then_some(body)
}

/// 解析表头 `[a.b]` / `[[a]]` 为 `a.b` 形式。
fn table_name(header: &str) -> Option<String> {
    let t = header.trim();
    let inner = t
        .strip_prefix("[[")
        .and_then(|s| s.strip_suffix("]]"))
        .or_else(|| t.strip_prefix('[').and_then(|s| s.strip_suffix(']')))?;
    let name = inner.trim().to_string();
    (!name.is_empty()).then_some(name)
}

/// 在段落行集合中找 `key = "value"`（value 支持基本双引号转义）。
fn find_string_key_in(lines: &[&str], key: &str) -> Option<String> {
    lines.iter().find_map(|l| parse_string_assignment(l, key))
}

fn find_bool_key_in(lines: &[&str], key: &str) -> Option<bool> {
    lines.iter().find_map(|line| {
        let (candidate, value) = line.split_once('=')?;
        if candidate.trim() != key {
            return None;
        }
        match value.trim() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        }
    })
}

fn parse_string_assignment(line: &str, key: &str) -> Option<String> {
    let (k, v) = line.split_once('=')?;
    if k.trim() != key {
        return None;
    }
    let v = v.trim();
    let unquoted = v.strip_prefix('"')?.strip_suffix('"')?;
    Some(unquoted.replace("\\\"", "\"").replace("\\\\", "\\"))
}

// ========== /v1/usage 响应结构与拉取 ==========

/// 中转站 /v1/usage 响应（未知字段忽略；数值兼容整数/浮点）
#[derive(Debug, Default, Deserialize, Serialize, Clone)]
pub struct RelayUsageResponse {
    #[serde(default)]
    pub balance: Option<f64>,
    #[serde(default)]
    pub remaining: Option<f64>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub is_valid: Option<bool>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default, rename = "planName")]
    pub plan_name: Option<String>,
    #[serde(default)]
    pub usage: RelayUsageStats,
}

#[derive(Debug, Default, Deserialize, Serialize, Clone)]
pub struct RelayUsageStats {
    #[serde(default)]
    pub today: RelayUsageBucket,
    #[serde(default)]
    pub total: RelayUsageBucket,
}

#[derive(Debug, Default, Deserialize, Serialize, Clone)]
pub struct RelayUsageBucket {
    #[serde(default)]
    pub cost: Option<f64>,
    #[serde(default, rename = "actual_cost")]
    pub actual_cost: Option<f64>,
    #[serde(default, rename = "total_tokens")]
    pub total_tokens: Option<f64>,
    #[serde(default, rename = "input_tokens")]
    pub input_tokens: Option<f64>,
    #[serde(default, rename = "output_tokens")]
    pub output_tokens: Option<f64>,
    #[serde(default)]
    pub requests: Option<f64>,
}

/// 拉取中转站 /v1/usage。`direct` 优先（中转站多为国内可达端点），
/// 失败再走 `proxy`（网关可能在境外时兜底）。
pub async fn fetch_relay_usage(
    direct: &reqwest::Client,
    proxy: &reqwest::Client,
    base_url: &str,
    api_key: &str,
) -> Result<RelayUsageResponse, String> {
    let url = format!("{}/v1/usage", base_url.trim_end_matches('/'));
    match send_usage_request(direct, &url, api_key).await {
        Ok(resp) => Ok(resp),
        Err(direct_err) => {
            eprintln!(
                "Codex relay /v1/usage 直连失败，尝试代理重试: {}",
                direct_err
            );
            send_usage_request(proxy, &url, api_key)
                .await
                .map_err(|proxy_err| format!("直连: {direct_err}; 代理: {proxy_err}"))
        }
    }
}

async fn send_usage_request(
    http: &reqwest::Client,
    url: &str,
    api_key: &str,
) -> Result<RelayUsageResponse, String> {
    let resp = http
        .get(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    if !status.is_success() {
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(format!("HTTP {}：中转站 API Key 无效", status.as_u16()));
        }
        return Err(format!(
            "HTTP {}：{}",
            status.as_u16(),
            relay_error_preview(&text)
        ));
    }
    serde_json::from_str(&text).map_err(|e| format!("解析 /v1/usage 失败: {}", e))
}

fn relay_error_preview(text: &str) -> String {
    text.chars().take(200).collect()
}

// ========== 映射：RelayUsageResponse → 统一 QuotaData / 前端富视图 ==========

/// 中转站余额 → 统一 QuotaData。
///
/// 与 DeepSeek 同为**绝对货币余额**：产出一条 RELAY_BALANCE QuotaLimit：
///   - `current_value` / `remaining` = remaining（缺失时回退 balance）
///   - `usage` = usage.total.cost（累计已花费）
///   - `percentage` = 0.0（哨兵值「非百分比」，前端忽略，**不合成假百分比**）
///   - `level` = planName（卡片计划徽章直接显示中转站的套餐名）。
pub fn relay_usage_to_quota_data(resp: &RelayUsageResponse) -> QuotaData {
    let balance = resp.remaining.or(resp.balance);
    let remaining = resp.remaining.or(resp.balance);
    let mut quota = QuotaData {
        level: resp
            .plan_name
            .clone()
            .unwrap_or_else(|| "relay".to_string()),
        ..Default::default()
    };
    if let Some(value) = balance {
        quota.limits.push(QuotaLimit {
            limit_type: LIMIT_TYPE_RELAY_BALANCE.to_string(),
            percentage: 0.0,
            next_reset_time: 0,
            unit: None,
            number: None,
            usage: resp.usage.total.cost,
            current_value: Some(value),
            remaining,
            usage_details: None,
        });
    }
    if resp.is_valid == Some(false) {
        quota.error = Some("中转站返回 isValid=false（Key 已失效）".to_string());
    }
    quota
}

/// get_relay_usage 返回的前端富视图（camelCase）
#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RelayUsageView {
    pub is_valid: bool,
    pub plan_name: String,
    pub mode: String,
    pub balance: f64,
    pub remaining: f64,
    pub unit: String,
    pub today: RelayBucketView,
    pub total: RelayBucketView,
    pub fetched_at: String,
}

#[derive(Debug, serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RelayBucketView {
    pub cost: f64,
    pub actual_cost: f64,
    pub total_tokens: f64,
    pub input_tokens: f64,
    pub output_tokens: f64,
    pub requests: f64,
}

pub fn relay_usage_to_view(resp: &RelayUsageResponse) -> RelayUsageView {
    fn bucket(b: &RelayUsageBucket) -> RelayBucketView {
        RelayBucketView {
            cost: b.cost.unwrap_or(0.0),
            actual_cost: b.actual_cost.unwrap_or(0.0),
            total_tokens: b.total_tokens.unwrap_or(0.0),
            input_tokens: b.input_tokens.unwrap_or(0.0),
            output_tokens: b.output_tokens.unwrap_or(0.0),
            requests: b.requests.unwrap_or(0.0),
        }
    }
    RelayUsageView {
        is_valid: resp.is_valid.unwrap_or(true),
        plan_name: resp.plan_name.clone().unwrap_or_default(),
        mode: resp.mode.clone().unwrap_or_default(),
        balance: resp.balance.or(resp.remaining).unwrap_or(0.0),
        remaining: resp.remaining.or(resp.balance).unwrap_or(0.0),
        unit: resp.unit.clone().unwrap_or_else(|| "USD".to_string()),
        today: bucket(&resp.usage.today),
        total: bucket(&resp.usage.total),
        fetched_at: chrono::Local::now().to_rfc3339(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_CONFIG: &str = r#"model_provider = "isaclab2api"
model = "gpt-5.5"
model_reasoning_effort = "high"

[model_providers.isaclab2api]
name = "isaclab2api"
base_url = "https://relay.example"
wire_api = "responses"
requires_openai_auth = true

[mcp_servers]

[mcp_servers.computer-use]
type = "stdio"
command = "./Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient"
"#;

    #[test]
    fn detects_relay_provider_from_config() {
        // 从文本直接验证解析规则（不读盘）
        let provider = find_top_level_string_key(SAMPLE_CONFIG, "model_provider").unwrap();
        assert_eq!(provider, "isaclab2api");
        let section = find_table_section(SAMPLE_CONFIG, "model_providers.isaclab2api").unwrap();
        assert_eq!(
            find_string_key_in(&section, "base_url").unwrap(),
            "https://relay.example"
        );
        // name 键不受 requires_openai_auth 等布尔键干扰
        assert_eq!(find_string_key_in(&section, "name").unwrap(), "isaclab2api");
    }

    #[test]
    fn parses_relay_distribution_fields() {
        let config =
            relay_distribution_config_from_content(SAMPLE_CONFIG).expect("应识别可分发的中转配置");
        assert_eq!(config.provider_name, "isaclab2api");
        assert_eq!(config.model, "gpt-5.5");
        assert_eq!(config.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(config.wire_api, "responses");
        assert!(config.requires_openai_auth);
    }

    #[test]
    fn merges_relay_provider_without_overwriting_remote_tables() {
        let config = relay_distribution_config_from_content(SAMPLE_CONFIG).unwrap();
        let existing = r#"model = "old"
model_provider = "official"

[model_providers.other]
name = "Keep"
base_url = "https://other.example/v1"

[mcp_servers.remote-tool]
command = "remote-only"
"#;
        let merged = merge_relay_config(existing, &config).unwrap();

        assert!(merged.contains("model_provider = \"isaclab2api\""));
        assert!(merged.contains("model = \"gpt-5.5\""));
        assert!(merged.contains("model_reasoning_effort = \"high\""));
        assert!(merged.contains("[model_providers.isaclab2api]"));
        assert!(merged.contains("base_url = \"https://relay.example\""));
        assert!(merged.contains("requires_openai_auth = true"));
        assert!(merged.contains("[model_providers.other]"));
        assert!(merged.contains("[mcp_servers.remote-tool]"));
        assert!(!merged.contains("experimental_bearer_token"));
    }

    #[test]
    fn replaces_existing_relay_provider_and_removes_stale_reasoning_effort() {
        let mut config = relay_distribution_config_from_content(SAMPLE_CONFIG).unwrap();
        config.reasoning_effort = None;
        let existing = r#"model = "old"
model_provider = "isaclab2api"
model_reasoning_effort = "low"

[model_providers.isaclab2api]
base_url = "https://old.example"

[profiles.remote]
model = "remote-profile"
"#;
        let merged = merge_relay_config(existing, &config).unwrap();

        assert_eq!(merged.matches("[model_providers.isaclab2api]").count(), 1);
        assert!(!merged.contains("https://old.example"));
        assert!(!merged.contains("model_reasoning_effort ="));
        assert!(merged.contains("[profiles.remote]"));
        assert!(merged.contains("model = \"remote-profile\""));
    }

    #[test]
    fn rejects_unsafe_relay_distribution_values() {
        let mut config = relay_distribution_config_from_content(SAMPLE_CONFIG).unwrap();
        config.provider_name = "bad]\n[evil".to_string();
        assert!(merge_relay_config("", &config).is_err());

        let mut config = relay_distribution_config_from_content(SAMPLE_CONFIG).unwrap();
        config.base_url = "https://safe.example/\"\nmodel = \"hijacked".to_string();
        assert!(merge_relay_config("", &config).is_err());
    }

    #[test]
    fn detects_minimal_relay_config_without_distribution_fields() {
        let config = relay_config_from_content(
            r#"model_provider = "minimal"

[model_providers.minimal]
base_url = "https://relay.example"
"#,
        )
        .expect("额度监测只依赖 provider 与 base_url");

        assert_eq!(config.provider_name, "minimal");
        assert_eq!(config.base_url, "https://relay.example");
    }

    #[test]
    fn relay_error_preview_preserves_utf8_boundaries() {
        let preview = relay_error_preview(&"错".repeat(250));
        assert_eq!(preview.chars().count(), 200);
    }

    #[test]
    fn table_body_stops_at_next_header() {
        let section = find_table_section(SAMPLE_CONFIG, "model_providers.isaclab2api").unwrap();
        // computer-use 段的 command 不应被误读进 provider 段
        assert!(find_string_key_in(&section, "command").is_none());
    }

    #[test]
    fn official_hosts_are_recognized() {
        assert!(is_official_base_url("https://chatgpt.com/backend-api"));
        assert!(is_official_base_url("https://api.openai.com/v1"));
        assert!(is_official_base_url("https://openai.com"));
        assert!(!is_official_base_url("https://relay.example"));
        assert!(!is_official_base_url("http://localhost:8080/v1"));
        // 相似后缀不误判
        assert!(!is_official_base_url("https://openai.com.evil.example"));
    }

    #[test]
    fn extracts_host_from_various_urls() {
        assert_eq!(
            extract_host("https://a.example.com:8443/v1"),
            "a.example.com"
        );
        assert_eq!(extract_host("http://user:pass@h.example/"), "h.example");
        assert_eq!(extract_host("a.example.com"), "a.example.com");
    }

    #[test]
    fn parses_relay_usage_json() {
        let sample = r#"{
            "balance": 480, "remaining": 480, "unit": "USD",
            "isValid": true, "mode": "unrestricted", "planName": "钱包余额",
            "usage": {
                "rpm": 0, "tpm": 0, "average_duration_ms": 0,
                "today": {"cost": 1.5, "actual_cost": 1.2, "total_tokens": 100, "input_tokens": 60, "output_tokens": 40, "requests": 3},
                "total": {"cost": 20, "actual_cost": 18, "total_tokens": 1000, "input_tokens": 600, "output_tokens": 400, "requests": 30}
            }
        }"#;
        let resp: RelayUsageResponse = serde_json::from_str(sample).unwrap();
        assert_eq!(resp.plan_name.as_deref(), Some("钱包余额"));
        assert_eq!(resp.usage.today.requests, Some(3.0));

        let quota = relay_usage_to_quota_data(&resp);
        assert_eq!(quota.level, "钱包余额");
        let limit = &quota.limits[0];
        assert_eq!(limit.limit_type, LIMIT_TYPE_RELAY_BALANCE);
        assert_eq!(limit.current_value, Some(480.0));
        assert_eq!(limit.usage, Some(20.0));
        assert_eq!(limit.percentage, 0.0);
        assert!(quota.error.is_none());

        let view = relay_usage_to_view(&resp);
        assert_eq!(view.today.cost, 1.5);
        assert_eq!(view.total.total_tokens, 1000.0);
        assert_eq!(view.unit, "USD");
    }

    #[test]
    fn invalid_key_maps_to_error() {
        let resp = RelayUsageResponse {
            is_valid: Some(false),
            ..Default::default()
        };
        let quota = relay_usage_to_quota_data(&resp);
        assert!(quota.error.is_some());
        // 无余额字段时不产出空 limit
        assert!(quota.limits.is_empty());
    }

    #[test]
    fn api_key_from_auth_accepts_only_nonempty_string() {
        let auth = crate::codex::types::AuthJson {
            openai_api_key: Some(serde_json::json!("sk-test")),
            ..Default::default()
        };
        assert_eq!(api_key_from_auth(&auth).as_deref(), Some("sk-test"));
        let null_auth = crate::codex::types::AuthJson {
            openai_api_key: Some(serde_json::Value::Null),
            ..Default::default()
        };
        assert!(api_key_from_auth(&null_auth).is_none());
    }
}
