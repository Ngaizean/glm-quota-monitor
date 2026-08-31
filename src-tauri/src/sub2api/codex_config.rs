//! 把 sub2api 接入本机/远程 Codex CLI 的 ~/.codex/config.toml。
//!
//! 幂等 merge 策略（本地与远程共用同一套规则）：
//! - 已有 `[model_providers.sub2api]` 段 → 原位替换段内容；没有 → 追加到文件末尾
//! - 顶层 `model_provider = "..."` → 改为 "sub2api"；缺失 → 插入文件开头
//! - 顶层 `model = "..."` → 改为选定模型；缺失 → 插入文件开头
//! - 顶层键的判断只作用于第一个 TOML 表头之前，避免误改子表里的同名键

/// 生成 sub2api provider 段内容
fn provider_block(base_url: &str, api_key: &str) -> String {
    let base_url = toml_string(base_url);
    let api_key = toml_string(api_key);
    format!(
        "[model_providers.sub2api]\nname = \"Sub2API Gateway\"\nbase_url = {base_url}\nwire_api = \"responses\"\nrequires_openai_auth = false\nexperimental_bearer_token = {api_key}\nsupports_websockets = false\n"
    )
}

/// JSON 与 TOML 的双引号基础字符串采用兼容的转义规则；复用 serde_json
/// 可防止 URL、模型名或密钥中的引号/换行逃逸成新的 TOML 配置项。
fn toml_string(value: &str) -> String {
    serde_json::to_string(value).expect("serializing a string cannot fail")
}

/// 行是否是「key = ...」形式的顶层赋值（"model" 不匹配 "model_provider"）
fn matches_key(line: &str, key: &str) -> bool {
    let t = line.trim_start();
    t.starts_with(&format!("{key} =")) || t.starts_with(&format!("{key}\t=")) || t == key
}

pub fn normalize_relay_base_url(value: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(value.trim())
        .map_err(|_| "中转地址必须是完整的 HTTP(S) URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("中转地址仅支持 HTTP 或 HTTPS".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("中转地址不能包含用户名或密码".to_string());
    }
    if url.host_str().is_none() {
        return Err("中转地址缺少主机名".to_string());
    }
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/');
    let normalized_path = if path.is_empty() {
        "/v1".to_string()
    } else if path.ends_with("/v1") {
        path.to_string()
    } else {
        format!("{path}/v1")
    };
    url.set_path(&normalized_path);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

pub fn merge_official_config(content: &str) -> String {
    let first_table = if content.starts_with('[') {
        0
    } else {
        content
            .find("\n[")
            .map(|index| index + 1)
            .unwrap_or(content.len())
    };
    let (head, tail) = content.split_at(first_table);
    let switching_from_relay = head.lines().any(|line| matches_key(line, "model_provider"));
    let mut lines: Vec<&str> = head
        .lines()
        .filter(|line| {
            !matches_key(line, "model_provider")
                && !(switching_from_relay && matches_key(line, "model"))
        })
        .collect();
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
    let head = replace_top_level(&lines.join("\n"), "cli_auth_credentials_store", "file");
    let mut result = head.trim_end().to_string();
    if !result.is_empty() && !tail.is_empty() {
        result.push_str("\n\n");
    }
    result.push_str(tail.trim_start_matches('\n'));
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

/// 在只含顶层键的文本里替换/插入 `key = "value"`
fn replace_top_level(text: &str, key: &str, value: &str) -> String {
    let target = format!("{key} = {}", toml_string(value));
    let mut lines: Vec<String> = text.lines().map(|l| l.to_string()).collect();
    let mut replaced = false;
    for line in lines.iter_mut() {
        if matches_key(line, key) {
            *line = target.clone();
            replaced = true;
            break;
        }
    }
    if !replaced {
        lines.insert(0, target);
    }
    let mut s = lines.join("\n");
    if !s.ends_with('\n') {
        s.push('\n');
    }
    s
}

/// 纯函数：对 config.toml 文本做幂等 merge，返回新文本。
/// 单测覆盖：无配置全新写入 / 已有段替换 / 顶层键缺失与替换。
pub fn merge_codex_config(content: &str, base_url: &str, api_key: &str, model: &str) -> String {
    let block = provider_block(base_url, api_key);
    let section_header = "[model_providers.sub2api]";

    let out = if content.contains(section_header) {
        // 原位替换：从段头到下一个表头（以 [ 开始的行）或 EOF
        let start = content.find(section_header).expect("checked");
        let rest = &content[start..];
        let end = rest[1..]
            .find("\n[")
            .map(|i| start + 1 + i + 1) // 指向下一表头的 [ 所在行首
            .unwrap_or(content.len());
        let mut s = String::new();
        s.push_str(&content[..start]);
        s.push_str(&block);
        s.push_str(&content[end..]);
        s
    } else {
        format!("{}\n{}", content.trim_end(), block)
    };

    // 顶层键只在第一个表头之前替换/插入（文件以表头开头时顶层区为空）
    let first_table = if out.starts_with('[') {
        0
    } else {
        out.find("\n[").map(|i| i + 1).unwrap_or(out.len())
    };
    let (head, tail) = out.split_at(first_table);

    // 先 model 后 model_provider：两者都缺失时 model_provider 最终插在最前
    let head = replace_top_level(head, "model", model);
    let head = replace_top_level(&head, "model_provider", "sub2api");
    let head = replace_top_level(&head, "cli_auth_credentials_store", "file");

    let mut result = head;
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result.push_str(tail);
    result
}

fn local_config_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法定位用户主目录")?;
    let config_dir = home.join(".codex");
    std::fs::create_dir_all(&config_dir).map_err(|e| format!("创建 ~/.codex 失败: {e}"))?;
    Ok(config_dir.join("config.toml"))
}

fn write_local_config(path: &std::path::Path, content: &str) -> Result<String, String> {
    let config_dir = path.parent().ok_or("无法定位 ~/.codex 目录")?;
    let backup = config_dir.join(format!(
        "config.toml.bak-quota-monitor-{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));
    if path.exists() {
        std::fs::copy(path, &backup).map_err(|e| format!("备份失败: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&backup, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("收紧备份文件权限失败: {e}"))?;
        }
    }
    crate::codex::auth::write_sensitive_file(path, content.as_bytes())
        .map_err(|e| format!("写入 config.toml 失败: {e}"))?;
    Ok(backup.to_string_lossy().to_string())
}

/// 备份并写回本机 ~/.codex/config.toml，返回备份路径
pub fn apply_local_config(base_url: &str, api_key: &str, model: &str) -> Result<String, String> {
    let path = local_config_path()?;
    let original = std::fs::read_to_string(&path).unwrap_or_default();
    let merged = merge_codex_config(&original, base_url, api_key, model);
    write_local_config(&path, &merged)
}

pub fn apply_official_local_config() -> Result<String, String> {
    let path = local_config_path()?;
    let original = std::fs::read_to_string(&path).unwrap_or_default();
    write_local_config(&path, &merge_official_config(&original))
}

/// 探测本机局域网 IP（UDP connect 惯用法，不实际发包）
pub fn probe_lan_ip() -> Option<String> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    let addr = sock.local_addr().ok()?;
    match addr.ip() {
        std::net::IpAddr::V4(ip) if !ip.is_loopback() => Some(ip.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_relay_base_urls() {
        assert_eq!(
            normalize_relay_base_url("https://pixarsubtoapi.stream").unwrap(),
            "https://pixarsubtoapi.stream/v1"
        );
        assert_eq!(
            normalize_relay_base_url("https://pixarsubtoapi.stream/v1/").unwrap(),
            "https://pixarsubtoapi.stream/v1"
        );
        assert!(normalize_relay_base_url("file:///tmp/relay").is_err());
        assert!(normalize_relay_base_url("https://user:pass@example.com").is_err());
    }

    #[test]
    fn switches_back_to_official_without_losing_other_tables() {
        let original = r#"model = "gpt-5.6-sol"
model_provider = "sub2api"

[model_providers.sub2api]
base_url = "https://relay.example/v1"
experimental_bearer_token = "sk-secret"

[mcp_servers.keep]
command = "keep-me"
"#;
        let out = merge_official_config(original);

        assert!(!out
            .lines()
            .any(|line| line.trim_start().starts_with("model_provider =")));
        assert!(!out
            .lines()
            .any(|line| line.trim_start().starts_with("model =")));
        assert!(out.contains("[model_providers.sub2api]"));
        assert!(out.contains("experimental_bearer_token = \"sk-secret\""));
        assert!(out.contains("[mcp_servers.keep]"));
        assert!(out.contains("command = \"keep-me\""));
        assert!(out.contains("cli_auth_credentials_store = \"file\""));
    }

    #[test]
    fn keeps_official_custom_model_when_no_relay_is_active() {
        let out = merge_official_config("model = \"gpt-official\"\n");

        assert!(out.contains("model = \"gpt-official\""));
        assert!(out.contains("cli_auth_credentials_store = \"file\""));
    }

    #[test]
    fn merges_into_empty_config() {
        let out = merge_codex_config("", "http://localhost:8080/v1", "sk-1", "gpt-5.6-sol");
        assert!(out.contains("model_provider = \"sub2api\""));
        assert!(out.contains("model = \"gpt-5.6-sol\""));
        assert!(out.contains("[model_providers.sub2api]"));
        assert!(out.contains("base_url = \"http://localhost:8080/v1\""));
        assert!(out.contains("experimental_bearer_token = \"sk-1\""));
        assert!(out.contains("cli_auth_credentials_store = \"file\""));
    }

    #[test]
    fn replaces_existing_section_and_top_level_keys() {
        let original = "model = \"gpt-5.2\"\nmodel_provider = \"codex_local_access\"\n\n[model_providers.sub2api]\nname = \"old\"\nbase_url = \"http://old:1/v1\"\nexperimental_bearer_token = \"sk-old\"\n\n[model_providers.other]\nname = \"keep\"\n";
        let out = merge_codex_config(
            original,
            "http://192.168.1.5:8080/v1",
            "sk-new",
            "gpt-5.6-sol",
        );
        assert!(out.contains("model_provider = \"sub2api\""));
        assert!(!out.contains("codex_local_access"));
        assert!(!out.contains("sk-old"));
        assert!(out.contains("experimental_bearer_token = \"sk-new\""));
        // 其他 provider 段保留
        assert!(out.contains("[model_providers.other]"));
        assert!(out.contains("name = \"keep\""));
    }

    #[test]
    fn does_not_touch_nested_model_keys() {
        // 子表内的 model_ 前缀键不被顶层替换误伤
        let original = "[profiles.x]\nmodel_provider = \"other\"\n";
        let out = merge_codex_config(original, "http://l:1/v1", "sk", "m");
        // 顶层没有 model_provider → 插入开头；子表里的保持原样
        let head = out.split("[profiles.x]").next().unwrap_or_default();
        assert!(head.contains("model_provider = \"sub2api\""));
        assert!(head.contains("cli_auth_credentials_store = \"file\""));
        assert!(out.contains("[profiles.x]\nmodel_provider = \"other\""));
    }

    #[test]
    fn escapes_values_before_writing_toml() {
        let out = merge_codex_config(
            "",
            "http://localhost:8080/\"\nmodel = \"hijacked",
            "sk-\"\nmodel_provider = \"other",
            "gpt-5.6-sol\"\n[evil]",
        );

        assert!(out.contains(r#"base_url = "http://localhost:8080/\"\nmodel = \"hijacked""#));
        assert!(out.contains(r#"experimental_bearer_token = "sk-\"\nmodel_provider = \"other""#));
        assert!(out.contains(r#"model = "gpt-5.6-sol\"\n[evil]""#));
        assert!(!out.contains("\n[evil]\n"));
    }
}
