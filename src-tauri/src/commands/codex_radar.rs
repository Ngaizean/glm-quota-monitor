//! Codex 雷达 —— codexradar.com 公开摘要接入
//!
//! 显示站点当前头条模型及其 IQ 分数；前端按 prediction.probability_24h
//! （24h 硬重置概率）做颜色编码。归属要求：数据来自 Codex 雷达 codexradar.com。
//!
//! 策略：后台线程定时拉取（数据源响应慢 ~10s），缓存到 app state，
//! 前端 invoke 同步读取缓存，永不阻塞 popover。

use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

const RADAR_URL: &str = "https://codexradar.com/current.json";

/// 缓存的雷达摘要（前端渲染所需的最小字段集）
#[derive(Serialize, Clone, Default)]
pub struct CodexRadarData {
    /// 站点头条模型的可读名，如 "GPT-5.6 Sol max"
    pub best_model: String,
    /// 对应 IQ 分数
    pub best_score: f64,
    /// 24 小时内硬重置概率（0~1）
    pub probability_24h: f64,
    /// 文本级概率档位（low/medium/high/...）
    pub probability_level: String,
    /// 缓存写入时间（本地 ISO 时间）
    pub updated_at: String,
}

/// 全局缓存 state：后台线程写，command 读
pub struct CodexRadarState(pub std::sync::Mutex<Option<CodexRadarData>>);

/// gpt-5.6-sol + max -> "GPT-5.6 Sol"
/// 规则与 Claude Code 状态栏脚本一致（与 comparisons.label 风格对齐）。
fn pretty_model(model: &str, effort: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    for w in model.split('-') {
        if w.is_empty() {
            continue;
        }
        if w.eq_ignore_ascii_case("gpt") {
            parts.push("GPT".to_string());
        } else if w
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
        {
            parts.push(w.to_string()); // 版本号原样
        } else {
            // 首字母大写
            let mut chars = w.chars();
            if let Some(first) = chars.next() {
                parts.push(format!("{}{}", first.to_ascii_uppercase(), chars.as_str()))
            }
        }
    }
    let name = match parts.len() {
        n if n >= 3 => format!("{}-{} {}", parts[0], parts[1], parts[2..].join(" ")),
        2 => format!("{}-{}", parts[0], parts[1]),
        1 => parts[0].clone(),
        _ => "?".to_string(),
    };
    if !effort.is_empty() {
        format!("{} {}", name, effort)
    } else {
        name
    }
}

/// 从 current.json 解析出「站点头条」模型 + 重置概率。
///
/// 口径说明：网站头部展示的是 `model_iq.latest`（默认档的实时 IQ 分），
/// 而 `model_iq.comparisons.*` 是各推理强度档位的横向对比——不同档位（xhigh/high/…）
/// 的得分可以高于 headline，直接跨 comparisons 取 max 会让 app 显示的分值/模型与网站
/// 头条对不上（例如网站头条 GPT-5.6 Sol 104.9，comparisons 里 xhigh 是 113.0）。
/// 因此这里以 `latest` 为唯一口径（跟随网站最新消息）；仅当 latest 缺失时才回退
/// comparisons 取最高档，保证显示与网站一致。
fn parse_best(v: &serde_json::Value) -> CodexRadarData {
    let mut best_score: f64 = 0.0;
    let mut best_model: String = "?".to_string();

    if let Some(iq) = v.get("model_iq") {
        // 主口径：model_iq.latest（站点头条）
        if let Some(latest) = iq.get("latest") {
            if let Some(score) = latest.get("score").and_then(|s| s.as_f64()) {
                let model = latest.get("model").and_then(|m| m.as_str()).unwrap_or("?");
                let effort = latest
                    .get("reasoning_effort")
                    .and_then(|e| e.as_str())
                    .unwrap_or("");
                best_score = score;
                best_model = pretty_model(model, effort);
            }
        }

        // 兜底：latest 缺失时，从 comparisons.*.latest 取最高分（label 优先）
        if best_model == "?" {
            let mut cands: Vec<(f64, String)> = Vec::new();
            if let Some(comp) = iq.get("comparisons").and_then(|c| c.as_object()) {
                for (_, cv) in comp {
                    let Some(lv) = cv.get("latest") else { continue };
                    let Some(score) = lv.get("score").and_then(|s| s.as_f64()) else {
                        continue;
                    };
                    let name = match cv.get("label").and_then(|l| l.as_str()) {
                        Some(lbl) if !lbl.is_empty() => lbl.to_string(),
                        _ => {
                            let model = lv.get("model").and_then(|m| m.as_str()).unwrap_or("?");
                            let effort = lv
                                .get("reasoning_effort")
                                .and_then(|e| e.as_str())
                                .unwrap_or("");
                            pretty_model(model, effort)
                        }
                    };
                    cands.push((score, name));
                }
            }
            cands.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            if let Some((score, name)) = cands.first() {
                best_score = *score;
                best_model = name.clone();
            }
        }
    }

    let pred = v.get("prediction");
    let p24 = pred
        .and_then(|p| p.get("probability_24h"))
        .and_then(|x| x.as_f64())
        .unwrap_or(0.0);
    let level = pred
        .and_then(|p| p.get("level"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    CodexRadarData {
        best_model,
        best_score,
        probability_24h: p24,
        probability_level: level,
        updated_at: chrono::Local::now().to_rfc3339(),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_best;

    #[test]
    fn headline_latest_wins_over_higher_comparison_score() {
        let value = serde_json::json!({
            "model_iq": {
                "latest": {
                    "score": 104.9,
                    "model": "gpt-5.6-sol",
                    "reasoning_effort": "max"
                },
                "comparisons": {
                    "xhigh": {
                        "label": "Comparison xhigh",
                        "latest": { "score": 113.0 }
                    }
                }
            }
        });

        let result = parse_best(&value);
        assert_eq!(result.best_model, "GPT-5.6 Sol max");
        assert_eq!(result.best_score, 104.9);
    }

    #[test]
    fn comparisons_are_used_when_headline_is_missing() {
        let value = serde_json::json!({
            "model_iq": {
                "comparisons": {
                    "low": { "label": "Low", "latest": { "score": 90.0 } },
                    "high": { "label": "High", "latest": { "score": 110.0 } }
                }
            }
        });

        let result = parse_best(&value);
        assert_eq!(result.best_model, "High");
        assert_eq!(result.best_score, 110.0);
    }
}

/// 拉取一次 codexradar.com/current.json 并解析。走代理 client（境外 Cloudflare 站点）。
async fn fetch_radar() -> Result<CodexRadarData, String> {
    let client = crate::proxy_http_client();
    let resp = client
        .get(RADAR_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(
            reqwest::header::USER_AGENT,
            concat!("glm-quota-monitor/", env!("CARGO_PKG_VERSION")),
        )
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("雷达请求失败: {e}"))?;
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("雷达响应解析失败: {e}"))?;
    Ok(parse_best(&v))
}

/// 把雷达刷新日志追加到 app_data_dir/codex_radar.log（release 无 stderr，便于诊断连通性）
fn log_radar(app: &tauri::AppHandle, msg: &str) {
    use std::io::Write;
    let Ok(base) = app.path().app_data_dir() else {
        return;
    };
    let path = base.join("codex_radar.log");
    let _ = std::fs::create_dir_all(&base);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(
            f,
            "[{}] {}",
            chrono::Utc::now().format("%Y-%m-%d %H:%M:%S"),
            msg
        );
    }
}

/// 后台线程调用：拉取并写入缓存 state，成功后 emit 事件通知前端。
/// 失败仅打日志，不影响已有缓存。
pub fn refresh_once(app: &tauri::AppHandle) {
    match tauri::async_runtime::block_on(fetch_radar()) {
        Ok(data) => {
            log_radar(
                app,
                &format!(
                    "ok: {} score={:.1} p24={:.2} level={}",
                    data.best_model, data.best_score, data.probability_24h, data.probability_level
                ),
            );
            if let Some(state) = app.try_state::<CodexRadarState>() {
                if let Ok(mut g) = state.0.lock() {
                    *g = Some(data);
                }
            }
            let _ = app.emit("codex-radar-updated", ());
        }
        Err(e) => {
            log_radar(app, &format!("FAILED: {e}"));
            eprintln!("codex radar fetch failed: {e}");
        }
    }
}

/// 读取缓存的雷达摘要（前端 invoke）。无缓存返回 None。
#[tauri::command]
pub fn get_codex_radar(state: State<'_, CodexRadarState>) -> Option<CodexRadarData> {
    state.0.lock().ok().and_then(|g| g.clone())
}

/// 手动刷新雷达（前端 invoke）：阻塞 ~10s 拉取并写缓存，返回最新数据。
/// 失败仅 log + 返回 Err，不影响已有缓存。前端需显示足够长的 loading 态。
#[tauri::command]
pub async fn refresh_codex_radar(app: tauri::AppHandle) -> Result<CodexRadarData, String> {
    match fetch_radar().await {
        Ok(data) => {
            log_radar(
                &app,
                &format!(
                    "manual ok: {} score={:.1} p24={:.2} level={}",
                    data.best_model, data.best_score, data.probability_24h, data.probability_level
                ),
            );
            if let Some(s) = app.try_state::<CodexRadarState>() {
                if let Ok(mut g) = s.0.lock() {
                    *g = Some(data.clone());
                }
            }
            let _ = app.emit("codex-radar-updated", ());
            Ok(data)
        }
        Err(e) => {
            log_radar(&app, &format!("manual FAILED: {e}"));
            Err(e)
        }
    }
}
