//! SSH 远程覆盖 —— 将本机 Codex 鉴权及当前中转配置同步到远程服务器
//!
//! 实现方式：shell 调用系统 ssh / scp，连接目标解析自 ~/.ssh/config 的 Host 别名。
//! 密码认证依赖 sshpass（macOS: /opt/homebrew/bin/sshpass），密码通过 SSHPASS
//! 环境变量传递，避免出现在命令行参数里（ps 可见）。
//!
//! 定时覆盖调度见 lib.rs 的 run_ssh_auto_override 线程：仅对「免密」或「已存储密码」
//! 的主机自动同步，非免密且无密码的主机一律跳过（由用户手动弹框输入密码）。

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// 扫描到的 SSH 主机（来自 ~/.ssh/config）
#[derive(Debug, Clone, Serialize)]
pub struct SshHost {
    /// config 中的 Host 别名（连接目标）
    pub alias: String,
    /// 解析出的主机名 / IP（缺省等于 alias）
    pub hostname: String,
    /// 登录用户名（缺省取当前系统用户）
    pub user: String,
    /// 端口
    pub port: u16,
    /// 显式配置的 IdentityFile（可能为 None）
    pub identity_file: Option<String>,
    /// 本地是否已有可用私钥（推测可能免密，供 UI 提示）
    pub has_local_key: bool,
}

fn ssh_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".ssh")
        .join("config")
}

/// 展开 ~ 前缀（IdentityFile 常用）
fn expand_tilde(p: &str) -> String {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    p.to_string()
}

/// 扫描 ~/.ssh/config，列出可用主机。
/// 通配块（Host * 等）不单独列出，仅作为默认值继承给后续具体主机。
pub fn scan_ssh_hosts() -> Vec<SshHost> {
    let content = std::fs::read_to_string(ssh_config_path()).unwrap_or_default();
    parse_ssh_config(&content)
}

#[derive(Default)]
struct SshConfigBlock {
    patterns: Vec<String>,
    hostname: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity: Option<String>,
}

/// 按 OpenSSH 的“首个已获得值生效”规则解析配置。
/// 先保留所有 Host 块，再针对每个具体别名按文件顺序合并，因此写在具体块之后的
/// `Host *` 仍可补齐默认值，模式块也只会作用于真正匹配的别名。
fn parse_ssh_config(content: &str) -> Vec<SshHost> {
    let mut blocks = Vec::new();
    // 第一个 Host 之前的指令属于全局配置。
    let mut current = SshConfigBlock {
        patterns: vec!["*".to_string()],
        ..Default::default()
    };

    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = match line.split_once(char::is_whitespace) {
            Some((key, value)) => (key.to_ascii_lowercase(), value.trim()),
            None => (line.to_ascii_lowercase(), ""),
        };

        if key == "host" {
            blocks.push(current);
            current = SshConfigBlock {
                patterns: value.split_whitespace().map(str::to_string).collect(),
                ..Default::default()
            };
            continue;
        }

        match key.as_str() {
            "hostname" if current.hostname.is_none() => {
                current.hostname = Some(value.to_string());
            }
            "user" if current.user.is_none() => {
                current.user = Some(value.to_string());
            }
            "port" if current.port.is_none() => {
                current.port = value.parse::<u16>().ok();
            }
            "identityfile" if current.identity.is_none() => {
                current.identity = Some(expand_tilde(value));
            }
            _ => {}
        }
    }
    blocks.push(current);

    let mut aliases = Vec::new();
    for block in &blocks {
        for pattern in &block.patterns {
            let is_concrete =
                !pattern.starts_with('!') && !pattern.contains('*') && !pattern.contains('?');
            if is_concrete && validate_ssh_alias(pattern).is_ok() && !aliases.contains(pattern) {
                aliases.push(pattern.clone());
            }
        }
    }

    let current_user = std::env::var("USER").unwrap_or_default();
    aliases
        .into_iter()
        .map(|alias| {
            let mut hostname = None;
            let mut user = None;
            let mut port = None;
            let mut identity = None;

            for block in &blocks {
                if !host_patterns_match(&block.patterns, &alias) {
                    continue;
                }
                if hostname.is_none() {
                    hostname = block.hostname.clone();
                }
                if user.is_none() {
                    user = block.user.clone();
                }
                if port.is_none() {
                    port = block.port;
                }
                if identity.is_none() {
                    identity = block.identity.clone();
                }
            }

            make_host(&alias, hostname, user, port, identity, &current_user)
        })
        .collect()
}

fn host_patterns_match(patterns: &[String], alias: &str) -> bool {
    let mut matched = false;
    for pattern in patterns {
        if let Some(negative) = pattern.strip_prefix('!') {
            if glob_matches(negative, alias) {
                return false;
            }
        } else if glob_matches(pattern, alias) {
            matched = true;
        }
    }
    matched
}

fn glob_matches(pattern: &str, value: &str) -> bool {
    let value: Vec<char> = value.chars().collect();
    let mut previous = vec![false; value.len() + 1];
    previous[0] = true;

    for token in pattern.chars() {
        let mut current = vec![false; value.len() + 1];
        if token == '*' {
            current[0] = previous[0];
            for index in 1..=value.len() {
                current[index] = previous[index] || current[index - 1];
            }
        } else {
            for index in 1..=value.len() {
                current[index] = previous[index - 1] && (token == '?' || token == value[index - 1]);
            }
        }
        previous = current;
    }

    previous[value.len()]
}

fn make_host(
    alias: &str,
    hostname: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
    current_user: &str,
) -> SshHost {
    let hostname = hostname.unwrap_or_else(|| alias.to_string());
    let user = user.unwrap_or_else(|| current_user.to_string());
    let port = port.unwrap_or(22);
    let has_local_key = identity_file
        .as_ref()
        .map(|p| Path::new(p).exists())
        .unwrap_or_else(has_default_key);

    SshHost {
        alias: alias.to_string(),
        hostname,
        user,
        port,
        identity_file,
        has_local_key,
    }
}

/// 是否存在默认私钥（id_ed25519 / id_ecdsa / id_rsa）
fn has_default_key() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    ["id_ed25519", "id_ecdsa", "id_rsa"]
        .iter()
        .any(|k| home.join(".ssh").join(k).exists())
}

/// SSH 目标来自配置文件，但 Tauri command 仍属于输入边界；拒绝会被 OpenSSH
/// 当成选项的前导 `-`，以及空白/控制字符，避免目标参数注入或歧义。
pub(crate) fn validate_ssh_alias(alias: &str) -> Result<(), String> {
    if alias.is_empty()
        || alias.starts_with('-')
        || alias.trim() != alias
        || alias.chars().any(char::is_control)
        || !alias
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '@'))
    {
        return Err("无效的 SSH 主机别名（仅支持字母、数字、点、下划线、连字符和 @）".to_string());
    }
    Ok(())
}

/// 定位 sshpass（brew 安装路径优先，其次 which）
fn find_sshpass() -> Result<PathBuf, String> {
    for c in [
        PathBuf::from("/opt/homebrew/bin/sshpass"),
        PathBuf::from("/usr/local/bin/sshpass"),
        PathBuf::from("/usr/bin/sshpass"),
    ] {
        if c.exists() {
            return Ok(c);
        }
    }
    if let Ok(out) = Command::new("which").arg("sshpass").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Ok(PathBuf::from(s));
            }
        }
    }
    Err("未找到 sshpass（brew install sshpass）。免密主机无需安装。".to_string())
}

/// 构造 ssh / sshpass -e <program> 基础命令。
/// password = Some(pw) 时用 sshpass，密码走 SSHPASS 环境变量。
fn base_cmd(program: &str, password: Option<&str>) -> Result<Command, String> {
    if let Some(pw) = password {
        let sshpass = find_sshpass()?;
        let mut c = Command::new(sshpass);
        c.arg("-e").arg(program);
        c.env("SSHPASS", pw);
        Ok(c)
    } else {
        Ok(Command::new(program))
    }
}

/// 执行远程命令，返回 stdout（成功时）。
/// 免密模式（password=None）强制 BatchMode，避免挂起等待交互输入。
fn run_ssh(alias: &str, password: Option<&str>, remote_cmd: &str) -> Result<String, String> {
    validate_ssh_alias(alias)?;
    let mut cmd = base_cmd("ssh", password)?;
    cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
    cmd.arg("-o").arg("ConnectTimeout=10");
    cmd.arg("-o").arg("NumberOfPasswordPrompts=1");
    if password.is_none() {
        cmd.arg("-o").arg("BatchMode=yes");
    }
    cmd.arg("--").arg(alias);
    cmd.arg(remote_cmd);
    let out = cmd.output().map_err(|e| format!("ssh 执行失败: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "ssh 命令失败".to_string()
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn run_ssh_with_stdin(
    alias: &str,
    password: Option<&str>,
    remote_cmd: &str,
    input: &[u8],
) -> Result<String, String> {
    validate_ssh_alias(alias)?;
    let mut cmd = base_cmd("ssh", password)?;
    cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
    cmd.arg("-o").arg("ConnectTimeout=10");
    cmd.arg("-o").arg("NumberOfPasswordPrompts=1");
    if password.is_none() {
        cmd.arg("-o").arg("BatchMode=yes");
    }
    cmd.arg("--").arg(alias).arg(remote_cmd);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("ssh 执行失败: {e}"))?;
    let stdin_result = child
        .stdin
        .take()
        .ok_or_else(|| "无法打开远程命令标准输入".to_string())
        .and_then(|mut stdin| {
            use std::io::Write;
            stdin
                .write_all(input)
                .map_err(|e| format!("向远程命令传入配置失败: {e}"))
        });
    let output = child
        .wait_with_output()
        .map_err(|e| format!("ssh 等待失败: {e}"))?;
    stdin_result?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            "ssh 命令失败".to_string()
        } else {
            error
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// 检查主机是否可免密（key-based）登录，无交互、超时 5s。
pub fn is_passwordless(alias: &str) -> bool {
    if validate_ssh_alias(alias).is_err() {
        return false;
    }
    let out = Command::new("ssh")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=5")
        .arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("--")
        .arg(alias)
        .arg("echo ok")
        .stdin(Stdio::null())
        .output();
    match out {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

/// 将本机 ~/.codex/auth.json 推送到远程 ~/.codex/auth.json（先建目录再覆盖）。
/// password = Some(p) 时用密码登录；None 时按免密处理。
pub fn push_auth_json(alias: &str, password: Option<&str>) -> Result<(), String> {
    let local = super::auth::auth_json_path()?;
    if !local.exists() {
        return Err("本机 ~/.codex/auth.json 不存在".to_string());
    }

    // 1. 确保远程 ~/.codex 目录存在
    run_ssh(alias, password, "mkdir -p ~/.codex && echo ok")?;

    // 2. 先上传到远端临时文件，校验成功后再原子替换，避免并发读取到半文件。
    let remote_temp = format!("~/.codex/.auth.json.{}.tmp", uuid::Uuid::new_v4().simple());
    let mut cmd = base_cmd("scp", password)?;
    cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
    cmd.arg("-o").arg("ConnectTimeout=10");
    cmd.arg("-o").arg("NumberOfPasswordPrompts=1");
    if password.is_none() {
        cmd.arg("-o").arg("BatchMode=yes");
    }
    cmd.arg("--");
    cmd.arg(local.as_os_str());
    cmd.arg(format!("{alias}:{remote_temp}"));
    let out = cmd.output().map_err(|e| format!("scp 执行失败: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "scp 上传失败".to_string()
        } else {
            format!("scp 上传失败: {err}")
        });
    }
    run_ssh(
        alias,
        password,
        &format!("chmod 600 {remote_temp} && mv -f {remote_temp} ~/.codex/auth.json"),
    )?;
    Ok(())
}

fn write_remote_config(alias: &str, password: Option<&str>, merged: &str) -> Result<(), String> {
    let temp_name = format!(".config.toml.{}.tmp", uuid::Uuid::new_v4().simple());
    let remote_cmd = format!(
        "set -eu; mkdir -p ~/.codex; umask 077; tmp=~/.codex/{temp_name}; cat > \"$tmp\"; chmod 600 \"$tmp\"; if [ -f ~/.codex/config.toml ]; then cp -p ~/.codex/config.toml ~/.codex/config.toml.bak-quota-monitor; chmod 600 ~/.codex/config.toml.bak-quota-monitor; fi; mv -f \"$tmp\" ~/.codex/config.toml"
    );
    run_ssh_with_stdin(alias, password, &remote_cmd, merged.as_bytes())?;
    Ok(())
}

fn write_remote_relay_config(
    alias: &str,
    password: Option<&str>,
    config: &super::relay::RelayDistributionConfig,
) -> Result<(), String> {
    let existing = run_ssh(
        alias,
        password,
        "cat ~/.codex/config.toml 2>/dev/null || true",
    )?;
    let merged = super::relay::merge_relay_config(&existing, config)?;
    write_remote_config(alias, password, &merged)
}

fn write_remote_official_config(alias: &str, password: Option<&str>) -> Result<(), String> {
    let existing = run_ssh(
        alias,
        password,
        "cat ~/.codex/config.toml 2>/dev/null || true",
    )?;
    let merged = crate::sub2api::codex_config::merge_official_config(&existing);
    write_remote_config(alias, password, &merged)
}

/// 同步鉴权文件；本机使用非官方 provider 时，再合并其运行所需配置。
pub fn push_codex_setup(alias: &str, password: Option<&str>) -> Result<(), String> {
    let relay_config = super::relay::detect_local_relay_distribution_config();
    if let Some(config) = &relay_config {
        // 连接前完成字段校验，避免 auth.json 已覆盖后才因非法配置失败。
        super::relay::merge_relay_config("", config)?;
    }
    if let Some(config) = relay_config {
        // requires_openai_auth=false 的中转档案只依赖 provider 内的 bearer token。
        // 本机若另有官方 auth 则一并同步，但不把它作为中转分发的前置条件。
        if super::auth::auth_json_path()?.exists() {
            push_auth_json(alias, password)?;
        }
        write_remote_relay_config(alias, password, &config)?;
    } else {
        push_auth_json(alias, password)?;
        // 只推 auth.json 不足以切回官方：远端可能仍选中了旧中转 provider。
        write_remote_official_config(alias, password)?;
    }
    Ok(())
}

// ========== Keychain 密码存储 ==========

/// Keychain 中 SSH 密码的存储 key
pub fn ssh_password_key(alias: &str) -> String {
    format!("ssh_pwd_{alias}")
}

pub fn store_ssh_password(alias: &str, password: &str) -> Result<(), String> {
    validate_ssh_alias(alias)?;
    let key = ssh_password_key(alias);
    keyring::Entry::new(crate::crypto::SERVICE_NAME, &key)
        .map_err(|e| format!("Keychain 错误: {e}"))?
        .set_password(password)
        .map_err(|e| format!("存储密码失败: {e}"))
}

pub fn read_ssh_password(alias: &str) -> Option<String> {
    validate_ssh_alias(alias).ok()?;
    let key = ssh_password_key(alias);
    keyring::Entry::new(crate::crypto::SERVICE_NAME, &key)
        .ok()?
        .get_password()
        .ok()
}

pub fn has_ssh_password(alias: &str) -> bool {
    read_ssh_password(alias).is_some()
}

pub fn delete_ssh_password(alias: &str) -> Result<(), String> {
    validate_ssh_alias(alias)?;
    let key = ssh_password_key(alias);
    keyring::Entry::new(crate::crypto::SERVICE_NAME, &key)
        .map_err(|e| format!("Keychain 错误: {e}"))?
        .delete_password()
        .map_err(|e| format!("删除密码失败: {e}"))
}

// ========== 远程 Claude Code 切换 ==========
//
// 把本机「Claude Code 切换 GLM/DeepSeek」能力通过 SSH 复用到远程主机：
// 远程不读本机 settings.json（避免污染），而是用本机已存的账号凭证重新生成 env 块。
// 远程 JSON 改写用 python3（跨平台、原子性好、字段级 patch），api_key/model 通过 stdin
// 传递，不出现在 ps 可见的命令行里（与现有 sshpass 安全原则一致）。

/// 远程 Claude Code 的当前状态（UI 回显用）
#[derive(Debug, Clone, Serialize)]
pub struct RemoteCcState {
    /// claude CLI 是否存在于远程 PATH（command -v claude 命中）
    pub installed: bool,
    /// 远程 ~/.claude/settings.json 的 env.ANTHROPIC_BASE_URL（未配置则 None）
    pub base_url: Option<String>,
    /// 远程 env.ANTHROPIC_MODEL
    pub model: Option<String>,
    /// 由 base_url 推断的平台标识：glm / deepseek / unknown
    pub platform: String,
}

/// 由 base_url 推断平台：含 deepseek.com → deepseek，含 bigmodel → glm，其余 unknown
fn classify_platform(base_url: &str) -> String {
    if base_url.contains("deepseek.com") {
        "deepseek".to_string()
    } else if base_url.contains("bigmodel") {
        "glm".to_string()
    } else {
        "unknown".to_string()
    }
}

/// 检测远程是否安装 Claude Code CLI。
/// command -v 是 POSIX 标准，比 which 更通用；命中时输出二进制路径。
pub fn remote_has_claude_code(alias: &str, password: Option<&str>) -> Result<bool, String> {
    let out = run_ssh(alias, password, "command -v claude 2>/dev/null || true")?;
    Ok(!out.is_empty())
}

/// 读取远程 ~/.claude/settings.json，返回 env 中的 ANTHROPIC_BASE_URL / ANTHROPIC_MODEL。
/// 文件不存在或解析失败时 installed 仍可独立判断（由调用方先调 remote_has_claude_code）。
/// 这里统一返回 RemoteCcState，installed 字段留 false，由调用方覆写。
pub fn read_remote_cc_settings(
    alias: &str,
    password: Option<&str>,
) -> Result<RemoteCcState, String> {
    // 用 python3 读取并输出 JSON 行（base_url\x1fmodel），比 cat 整文件再本地解析更稳：
    // 远程 settings.json 可能含其他敏感/大字段，只取需要的两个。
    let script = "python3 -c 'import json,os\np=os.path.expanduser(\"~/.claude/settings.json\")\ntry:\n d=json.load(open(p))\nexcept Exception:\n print(\"\"); raise SystemExit\ne=d.get(\"env\",{}) or {}\nprint(e.get(\"ANTHROPIC_BASE_URL\",\"\")+\"\\x1f\"+e.get(\"ANTHROPIC_MODEL\",\"\"))' 2>/dev/null || true";
    let out = run_ssh(alias, password, script)?;
    let line = out.lines().next().unwrap_or("");
    let (base_url, model) = match line.split_once('\x1f') {
        Some((b, m)) => (b.to_string(), m.to_string()),
        None => (String::new(), String::new()),
    };
    let base_url_opt = if base_url.is_empty() {
        None
    } else {
        Some(base_url.clone())
    };
    let platform = base_url_opt
        .as_deref()
        .map(classify_platform)
        .unwrap_or_else(|| "unknown".to_string());
    let model_opt = if model.is_empty() { None } else { Some(model) };
    Ok(RemoteCcState {
        installed: false, // 调用方覆写
        base_url: base_url_opt,
        model: model_opt,
        platform,
    })
}

/// 远程改写 ~/.claude/settings.json 的 env 块：写入 5 个 ANTHROPIC_* 字段。
///
/// 实现要点（踩坑后修正）：
/// - 脚本走 `python3 -c '...'`（命令行参数），参数走 ssh stdin（一行 JSON）。
///   不能用 heredoc + stdin 参数：heredoc 占用 stdin 传脚本体，readline 读到的是 EOF。
/// - api_key 只走 ssh 加密通道 + 远程 python stdin，不出现在远程 ps 列表（与 sshpass 安全原则一致）。
pub fn write_remote_cc_env(
    alias: &str,
    password: Option<&str>,
    api_key: &str,
    model: &str,
    base_url: &str,
) -> Result<(), String> {
    validate_ssh_alias(alias)?;
    // python3 -c 脚本：从 stdin 读一行 JSON，解析出 base_url/api_key/model，原子改写 env 块。
    // 用单引号包裹脚本体避免 shell 插值；脚本内的 python 字符串用双引号。
    let script = "python3 -c 'import json,os,sys\np=os.path.expanduser(\"~/.claude/settings.json\")\nos.makedirs(os.path.dirname(p),exist_ok=True)\nif os.path.exists(p):\n with open(p) as f: d=json.load(f)\nelse:\n d={}\nif not isinstance(d.get(\"env\"),dict):\n d[\"env\"]={}\nv=json.loads(sys.stdin.readline())\ne=d[\"env\"]\ne[\"ANTHROPIC_BASE_URL\"]=v[\"base_url\"]\ne[\"ANTHROPIC_AUTH_TOKEN\"]=v[\"api_key\"]\nm=v[\"model\"]\ne[\"ANTHROPIC_MODEL\"]=m\ne[\"ANTHROPIC_DEFAULT_HAIKU_MODEL\"]=m\ne[\"ANTHROPIC_DEFAULT_SONNET_MODEL\"]=m\ne[\"ANTHROPIC_DEFAULT_OPUS_MODEL\"]=m\ntmp=p+\".glm-quota-monitor.\"+str(os.getpid())+\".tmp\"\nwith open(tmp,\"w\") as f:\n json.dump(d,f,indent=2); f.flush(); os.fsync(f.fileno())\nos.chmod(tmp,0o600)\nos.replace(tmp,p)'";

    // 参数序列化成一行 JSON（readline 读一行）。key 走 stdin，不进 ssh 命令行。
    let payload = serde_json::json!({
        "base_url": base_url,
        "api_key": api_key,
        "model": model,
    })
    .to_string();

    let mut cmd = base_cmd("ssh", password)?;
    cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
    cmd.arg("-o").arg("ConnectTimeout=10");
    cmd.arg("-o").arg("NumberOfPasswordPrompts=1");
    if password.is_none() {
        cmd.arg("-o").arg("BatchMode=yes");
    }
    cmd.arg("--").arg(alias);
    cmd.arg(script);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("ssh 执行失败: {e}"))?;
    let stdin_result = if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin
            .write_all(payload.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .map_err(|e| format!("向远程命令传入配置失败: {e}"))
    } else {
        Err("无法打开远程命令标准输入".to_string())
    };
    let out = child
        .wait_with_output()
        .map_err(|e| format!("ssh 等待失败: {e}"))?;
    stdin_result?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        // python3 不存在时 stderr 通常含 "python3: not found" → 提示用户安装
        return Err(if err.is_empty() {
            "远程改写 settings.json 失败（可能是远程未安装 python3）".to_string()
        } else {
            format!("远程改写失败: {err}")
        });
    }
    Ok(())
}

/// 远程清除 ~/.claude/settings.json 中 5 个 ANTHROPIC_* 字段（解绑 Claude Code 端点）。
/// 不删除 settings.json 本身，只清 env 里的相关 key，保留用户其他配置。
/// 无参数，走 `python3 -c`（与 write_remote_cc_env 风格统一）。
pub fn unbind_remote_cc_env(alias: &str, password: Option<&str>) -> Result<(), String> {
    let script = "python3 -c 'import json,os\np=os.path.expanduser(\"~/.claude/settings.json\")\nif not os.path.exists(p):\n raise SystemExit\nwith open(p) as f: d=json.load(f)\nenv=d.get(\"env\") or {}\nchanged=False\nfor k in [\"ANTHROPIC_BASE_URL\",\"ANTHROPIC_AUTH_TOKEN\",\"ANTHROPIC_MODEL\",\"ANTHROPIC_DEFAULT_HAIKU_MODEL\",\"ANTHROPIC_DEFAULT_SONNET_MODEL\",\"ANTHROPIC_DEFAULT_OPUS_MODEL\"]:\n if k in env:\n  del env[k]; changed=True\nd[\"env\"]=env\nif changed:\n tmp=p+\".glm-quota-monitor.\"+str(os.getpid())+\".tmp\"\n with open(tmp,\"w\") as f:\n  json.dump(d,f,indent=2); f.flush(); os.fsync(f.fileno())\n os.chmod(tmp,0o600)\n os.replace(tmp,p)'";
    let out = run_ssh_full(alias, password, script)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "远程解绑失败（可能是未安装 python3）".to_string()
        } else {
            format!("远程解绑失败: {err}")
        });
    }
    Ok(())
}

/// 远程把 sub2api 接入 ~/.codex/config.toml（幂等 merge）。
/// 与 write_remote_cc_env 相同的 stdin-JSON 模式：api_key 不进远程命令行/ps。
/// merge 规则与本地 sub2api::codex_config::merge_codex_config 一致：
/// 已有 [model_providers.sub2api] 段则原位替换，否则追加；顶层 model/model_provider
/// 只在第一个表头之前替换或插入；写前备份为 config.toml.bak-quota-monitor。
pub fn write_remote_codex_config(
    alias: &str,
    password: Option<&str>,
    base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<(), String> {
    for (label, value) in [
        ("base_url", base_url),
        ("api_key", api_key),
        ("model", model),
    ] {
        validate_remote_config_value(label, value)?;
    }
    write_remote_codex_config_unchecked(alias, password, base_url, api_key, model)
}

fn validate_remote_config_value(label: &str, value: &str) -> Result<(), String> {
    if value
        .chars()
        .any(|character| character == '"' || character == '\\' || character.is_control())
    {
        return Err(format!("{label} 含远程配置不支持的字符"));
    }
    Ok(())
}

fn write_remote_codex_config_unchecked(
    alias: &str,
    password: Option<&str>,
    base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<(), String> {
    validate_ssh_alias(alias)?;
    let script = "python3 -c 'import json,os,sys,re,shutil\nv=json.loads(sys.stdin.readline())\np=os.path.expanduser(\"~/.codex/config.toml\")\nos.makedirs(os.path.dirname(p),exist_ok=True)\ncontent=open(p).read() if os.path.exists(p) else \"\"\nif os.path.exists(p): shutil.copy2(p,p+\".bak-quota-monitor\")\nblock=\"[model_providers.sub2api]\\n\"+\"name = \\\"Sub2API Gateway\\\"\\n\"+\"base_url = \\\"\"+v[\"base_url\"]+\"\\\"\\n\"+\"wire_api = \\\"responses\\\"\\n\"+\"requires_openai_auth = false\\n\"+\"experimental_bearer_token = \\\"\"+v[\"api_key\"]+\"\\\"\\n\"+\"supports_websockets = false\\n\"\nhdr=\"[model_providers.sub2api]\"\nif hdr in content:\n i=content.find(hdr)\n j=content.find(\"\\n[\",i+1)\n j=len(content) if j<0 else j+1\n content=content[:i]+block+content[j:]\nelse:\n content=content.rstrip()+\"\\n\\n\"+block if content.strip() else block\nnl=content.find(\"\\n[\")\nnl=len(content) if nl<0 else nl\nhead,tail=content[:nl],content[nl:]\ndef rep(t,k,val):\n pref=k+\" =\"\n lines=t.split(\"\\n\")\n for n,l in enumerate(lines):\n  if l.strip().startswith(pref) and not (k==\"model\" and l.strip().startswith(\"model_\")):\n   lines[n]=pref+\" \\\"\"+val+\"\\\"\"\n   return \"\\n\".join(lines)\n lines.insert(0,pref+\" \\\"\"+val+\"\\\"\")\n return \"\\n\".join(lines)\nhead=rep(head,\"model\",v[\"model\"])\nhead=rep(head,\"model_provider\",\"sub2api\")\nif head and not head.endswith(\"\\n\"): head+=\"\\n\"\ncontent=head+tail\ntmp=p+\".glm-quota-monitor.\"+str(os.getpid())+\".tmp\"\nwith open(tmp,\"w\") as f: f.write(content); f.flush(); os.fsync(f.fileno())\nos.chmod(tmp,0o600)\nos.replace(tmp,p)'";

    let payload = serde_json::json!({
        "base_url": base_url,
        "api_key": api_key,
        "model": model,
    })
    .to_string();

    let mut cmd = base_cmd("ssh", password)?;
    cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
    cmd.arg("-o").arg("ConnectTimeout=10");
    cmd.arg("-o").arg("NumberOfPasswordPrompts=1");
    if password.is_none() {
        cmd.arg("-o").arg("BatchMode=yes");
    }
    cmd.arg("--").arg(alias);
    cmd.arg(script);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("ssh 执行失败: {e}"))?;
    let stdin_result = if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin
            .write_all(payload.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .map_err(|e| format!("向远程命令传入配置失败: {e}"))
    } else {
        Err("无法打开远程命令标准输入".to_string())
    };
    let out = child
        .wait_with_output()
        .map_err(|e| format!("ssh 等待失败: {e}"))?;
    stdin_result?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "远程写入 config.toml 失败（可能是远程未安装 python3 或没有 codex）".to_string()
        } else {
            format!("远程写入 config.toml 失败: {err}")
        });
    }
    Ok(())
}

/// run_ssh 的完整输出版本（保留 status/stdout/stderr），unbind 需要判断退出码而非只看 stdout。
fn run_ssh_full(
    alias: &str,
    password: Option<&str>,
    remote_cmd: &str,
) -> Result<std::process::Output, String> {
    validate_ssh_alias(alias)?;
    let mut cmd = base_cmd("ssh", password)?;
    cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
    cmd.arg("-o").arg("ConnectTimeout=10");
    cmd.arg("-o").arg("NumberOfPasswordPrompts=1");
    if password.is_none() {
        cmd.arg("-o").arg("BatchMode=yes");
    }
    cmd.arg("--").arg(alias);
    cmd.arg(remote_cmd);
    cmd.output().map_err(|e| format!("ssh 执行失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{parse_ssh_config, validate_remote_config_value, validate_ssh_alias};

    #[test]
    fn remote_codex_config_rejects_toml_escape_characters() {
        assert!(validate_remote_config_value("model", "gpt-5.6-sol").is_ok());
        assert!(validate_remote_config_value("model", "gpt\n[evil]").is_err());
        assert!(validate_remote_config_value("api_key", "sk-\"quoted").is_err());
        assert!(validate_remote_config_value("base_url", r"http://host\path").is_err());
    }

    #[test]
    fn rejects_ssh_aliases_that_can_be_parsed_as_options() {
        assert!(validate_ssh_alias("-oProxyCommand=malicious").is_err());
        assert!(validate_ssh_alias("").is_err());
        assert!(validate_ssh_alias("box\nother").is_err());
        assert!(validate_ssh_alias(" box ").is_err());
        assert!(validate_ssh_alias("box:~/other").is_err());
        assert!(validate_ssh_alias("box;touch-pwned").is_err());
        assert!(validate_ssh_alias("build-box").is_ok());
        assert!(validate_ssh_alias("deploy@build-box").is_ok());
    }

    #[test]
    fn inherits_global_defaults_declared_after_specific_host() {
        let hosts = parse_ssh_config(
            r#"
Host build-box
    HostName 10.0.0.8
Host *
    User deploy
    Port 2200
"#,
        );

        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "build-box");
        assert_eq!(hosts[0].hostname, "10.0.0.8");
        assert_eq!(hosts[0].user, "deploy");
        assert_eq!(hosts[0].port, 2200);
    }

    #[test]
    fn applies_wildcard_defaults_only_to_matching_aliases() {
        let hosts = parse_ssh_config(
            r#"
Host *.corp
    User corp-user
Host *
    User fallback-user
Host api.corp plain-box
"#,
        );

        let corp = hosts.iter().find(|host| host.alias == "api.corp").unwrap();
        let plain = hosts.iter().find(|host| host.alias == "plain-box").unwrap();
        assert_eq!(corp.user, "corp-user");
        assert_eq!(plain.user, "fallback-user");
    }

    #[test]
    fn negated_pattern_excludes_alias_from_wildcard_block() {
        let hosts = parse_ssh_config(
            r#"
Host *.corp !bastion.corp
    User service
Host bastion.corp api.corp
"#,
        );

        let bastion = hosts
            .iter()
            .find(|host| host.alias == "bastion.corp")
            .unwrap();
        let api = hosts.iter().find(|host| host.alias == "api.corp").unwrap();
        assert_ne!(bastion.user, "service");
        assert_eq!(api.user, "service");
    }
}
