//! 会话修复：账号切换后，把旧会话 rollout 文件里记录的 model_provider 改写为当前账号的 provider。
//!
//! Codex resume 旧会话时读取 `~/.codex/sessions/**/rollout-*.jsonl` 首行 session_meta
//! 的 `payload.model_provider`；官方订阅会话记录内置 id `openai`，中转站会话记录中转
//! provider id。账号切换后该 id 与 config.toml 不匹配，旧对话便无法继续——这正是
//! 「官方订阅切到中转站后旧对话打不开」的根源。修复只重写首行这一个字段，其余字节不动。

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Default, Serialize)]
pub struct RepairReport {
    pub scanned: usize,
    pub repaired: usize,
    pub skipped_errors: usize,
    pub backup_dir: Option<String>,
}

/// 账号类型对应的 rollout provider id：官方订阅用 Codex 内置 openai，
/// 中转站与 profiles::merge 写入 config 的 provider id 保持一致。
pub fn target_provider(kind: &str) -> &'static str {
    if kind == "relay" {
        "quota_monitor"
    } else {
        "openai"
    }
}

/// 扫描 codex_home 下的 sessions（及 archived_sessions）目录，
/// 把 session_meta 中与目标不一致的 model_provider 改写为目标值。
/// 修改前整文件备份到 codex_home/session_repair_backup/{时间戳}/，保留相对路径。
pub fn repair_sessions(codex_home: &Path, target: &str) -> Result<RepairReport, String> {
    let mut report = RepairReport::default();
    let mut pending: Vec<std::path::PathBuf> = Vec::new();
    for dir_name in ["sessions", "archived_sessions"] {
        let root = codex_home.join(dir_name);
        if root.is_dir() {
            collect_rollouts(&root, &mut pending)?;
        }
    }
    if pending.is_empty() {
        return Ok(report);
    }
    let backup_root = codex_home.join("session_repair_backup");
    let backup_dir = backup_root.join(chrono::Local::now().format("%Y%m%d-%H%M%S").to_string());
    for path in &pending {
        report.scanned += 1;
        // 绝大多数会话无需修复：只读首行判断，命中时才读全文重写，
        // 避免为扫描元数据而整文件读入大量长会话。
        let Some(first_line) = read_first_line(path) else {
            report.skipped_errors += 1;
            continue;
        };
        let Some(new_first) = replace_provider_in_line(&first_line, target) else {
            continue;
        };
        let Ok(content) = std::fs::read(path) else {
            report.skipped_errors += 1;
            continue;
        };
        let mut updated = new_first.into_bytes();
        updated.extend_from_slice(&content[first_line.len()..]);
        if let Ok(rel) = path.strip_prefix(codex_home) {
            let backup = backup_dir.join(rel);
            if backup_parent(&backup, &content).is_err() {
                report.skipped_errors += 1;
                continue;
            }
        }
        if write_atomic(path, &updated).is_err() {
            report.skipped_errors += 1;
        } else {
            report.repaired += 1;
        }
    }
    if report.repaired > 0 {
        report.backup_dir = Some(backup_dir.to_string_lossy().to_string());
    }
    Ok(report)
}

fn backup_parent(backup: &Path, content: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = backup.parent() {
        std::fs::create_dir_all(parent)?;
    }
    write_sensitive(backup, content)
}

fn write_sensitive(path: &Path, data: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?
            .write_all(data)?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, data)
    }
}

fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_file_name(format!(
        ".{}.repair-{}.tmp",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("file"),
        uuid::Uuid::new_v4().simple()
    ));
    write_sensitive(&tmp, data)?;
    std::fs::rename(&tmp, path)
}

fn collect_rollouts(root: &Path, out: &mut Vec<std::path::PathBuf>) -> Result<(), String> {
    let entries = std::fs::read_dir(root).map_err(|e| format!("读取 {} 失败: {e}", root.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rollouts(&path, out)?;
        } else if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
    Ok(())
}

fn read_first_line(path: &Path) -> Option<String> {
    use std::io::{BufRead, BufReader};
    let file = std::fs::File::open(path).ok()?;
    let mut line = String::new();
    BufReader::new(file).read_line(&mut line).ok()?;
    // 首行必须是合法 UTF-8 的 JSON；坏文件跳过
    String::from_utf8(line.into_bytes()).ok()
}

/// 首行 session_meta 的 model_provider 与目标一致（或首行不是可识别的 session_meta）时返回 None；
/// 否则返回仅替换了该字段值的首行。字节级替换避免重新序列化整个 JSON。
fn replace_provider_in_line(first: &str, target: &str) -> Option<String> {
    let marker = "\"model_provider\":\"";
    let key_pos = first.find(marker)? + marker.len();
    let value_end = first[key_pos..].find('"')? + key_pos;
    let current = &first[key_pos..value_end];
    if current == target || current.is_empty() {
        return None;
    }
    let mut updated = String::with_capacity(first.len() + target.len());
    updated.push_str(&first[..key_pos]);
    updated.push_str(target);
    updated.push_str(&first[value_end..]);
    Some(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta_line(provider: &str) -> String {
        format!(
            "{{\"timestamp\":\"2026-09-08T09:08:46.950Z\",\"type\":\"session_meta\",\"payload\":{{\"id\":\"s1\",\"model_provider\":\"{provider}\",\"base_instructions\":{{\"text\":\"hi\"}}}}}}\n{{\"type\":\"response_item\",\"payload\":{{\"k\":\"v\"}}}}\n"
        )
    }

    fn write_rollout(dir: &Path, rel: &str, provider: &str) -> std::path::PathBuf {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, meta_line(provider)).unwrap();
        path
    }

    #[test]
    fn repairs_mismatched_provider_and_backs_up_originals() {
        let home = std::env::temp_dir().join(format!("qr-{}", uuid::Uuid::new_v4()));
        let old = write_rollout(&home, "sessions/2026/09/01/a.jsonl", "openai");
        let already = write_rollout(&home, "sessions/2026/09/02/b.jsonl", "quota_monitor");
        let archived = write_rollout(&home, "archived_sessions/c.jsonl", "openai");

        let report = repair_sessions(&home, "quota_monitor").unwrap();
        assert_eq!(report.scanned, 3);
        assert_eq!(report.repaired, 2);
        assert_eq!(report.skipped_errors, 0);
        assert!(report.backup_dir.is_some());

        let fixed = std::fs::read_to_string(&old).unwrap();
        assert!(fixed.contains("\"model_provider\":\"quota_monitor\""));
        assert!(fixed.contains("\"type\":\"response_item\""));
        let backup: Vec<_> = walk_backup(&home.join("session_repair_backup"));
        assert_eq!(backup.len(), 2);
        assert!(std::fs::read_to_string(&backup[0])
            .unwrap()
            .contains("\"model_provider\":\"openai\""));
        assert_eq!(
            std::fs::read_to_string(&already).unwrap(),
            meta_line("quota_monitor")
        );
        assert!(std::fs::read_to_string(&archived)
            .unwrap()
            .contains("quota_monitor"));
        std::fs::remove_dir_all(&home).unwrap();
    }

    fn walk_backup(root: &Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(root).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(walk_backup(&path));
            } else {
                out.push(path);
            }
        }
        out.sort();
        out
    }

    #[test]
    fn leaves_legacy_meta_without_provider_and_skips_broken_files() {
        let home = std::env::temp_dir().join(format!("qr-{}", uuid::Uuid::new_v4()));
        let legacy_path = home.join("sessions/d.jsonl");
        std::fs::create_dir_all(legacy_path.parent().unwrap()).unwrap();
        std::fs::write(
            &legacy_path,
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"old\"}}\n",
        )
        .unwrap();
        let broken = home.join("sessions/e.jsonl");
        std::fs::write(&broken, [0x6e, 0x6f, 0x74, 0xff, 0x20]).unwrap();

        let report = repair_sessions(&home, "openai").unwrap();
        assert_eq!(report.scanned, 2);
        assert_eq!(report.repaired, 0);
        assert_eq!(report.skipped_errors, 1);
        assert!(report.backup_dir.is_none());
        assert_eq!(
            std::fs::read_to_string(&legacy_path).unwrap(),
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"old\"}}\n"
        );
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn empty_sessions_dir_reports_nothing() {
        let home = std::env::temp_dir().join(format!("qr-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(home.join("sessions")).unwrap();
        let report = repair_sessions(&home, "openai").unwrap();
        assert_eq!(report.scanned, 0);
        std::fs::remove_dir_all(&home).unwrap();
    }
}
