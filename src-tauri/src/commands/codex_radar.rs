//! Codex 雷达 —— codexradar.com 智力效率与重置预测接入
//!
//! IQ 必须跟随网站 `/api/intelligence-efficiency-metrics` 的实时卡片口径；
//! 24h 硬重置概率仍来自 `/current.json` 的 prediction。归属要求：数据来自
//! Codex 雷达 codexradar.com。
//!
//! 策略：后台线程定时拉取（数据源响应慢 ~10s），缓存到 app state，
//! 前端 invoke 同步读取缓存，永不阻塞 popover。

use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

const RADAR_METRICS_URL: &str = "https://codexradar.com/api/intelligence-efficiency-metrics";
const RADAR_STATUS_URL: &str = "https://codexradar.com/current.json";

/// 缓存的雷达摘要（前端渲染所需的最小字段集）
#[derive(Serialize, Clone, Default)]
pub struct CodexRadarData {
    /// 网站智力效率卡片中 IQ 最高模型的可读名，如 "GPT-5.6 Sol xhigh"
    pub best_model: String,
    /// 对应 IQ 分数
    pub best_score: f64,
    /// 24 小时内硬重置概率（0~1）
    pub probability_24h: f64,
    /// 文本级概率档位（low/medium/high/...）
    pub probability_level: String,
    /// 网站智力效率快照的来源时间（ISO 时间）
    pub updated_at: String,
}

/// 全局缓存 state：后台线程写，command 读
pub struct CodexRadarState(pub std::sync::Mutex<Option<CodexRadarData>>);

/// gpt-5.6-sol + max -> "GPT-5.6 Sol max"
fn pretty_model(model: &str, effort: &str) -> String {
    let known_name = match model {
        "gpt-5.6-sol" => Some("GPT-5.6 Sol"),
        "gpt-5.6-terra" => Some("GPT-5.6 Terra"),
        "gpt-5.6-luna" => Some("GPT-5.6 Luna"),
        "gpt-5.5" => Some("GPT-5.5"),
        "deepseek-v4-flash" => Some("DeepSeek V4 Flash"),
        _ => None,
    };
    if let Some(name) = known_name {
        return if effort.is_empty() {
            name.to_string()
        } else {
            format!("{name} {effort}")
        };
    }

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

/// 按网站 `compactIqSnapshot` 的当前约束解析智力效率卡片，并选择最高 IQ 点。
/// 模型、effort 和 IQ 始终来自同一个 point，避免把一个档位的名字和另一个档位的
/// 分数拼在一起。
fn parse_metrics(v: &serde_json::Value) -> Result<CodexRadarData, String> {
    if v.get("schema").and_then(|value| value.as_u64()) != Some(2)
        || v.get("mode").and_then(|value| value.as_str()) != Some("weighted_latest_3")
    {
        return Err("智力效率接口版本不受支持".to_string());
    }

    let points = v
        .get("points")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "智力效率响应缺少 points".to_string())?;

    let best = points
        .iter()
        .filter_map(|point| {
            let model = point.get("model")?.as_str()?.trim();
            let effort = point.get("effort")?.as_str()?.trim();
            let score = point.get("iq")?.as_f64()?;
            if model.is_empty() || effort.is_empty() || !score.is_finite() {
                return None;
            }
            Some((score, model, effort))
        })
        .max_by(|left, right| left.0.total_cmp(&right.0))
        .ok_or_else(|| "智力效率响应没有有效 IQ 点".to_string())?;

    let updated_at = v
        .get("source_updated_at")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "智力效率响应缺少来源时间".to_string())?;

    Ok(CodexRadarData {
        best_model: pretty_model(best.1, best.2),
        best_score: best.0,
        probability_24h: 0.0,
        probability_level: String::new(),
        updated_at: updated_at.to_string(),
    })
}

/// prediction 属于状态接口的独立数据域，只合并概率，不覆盖 metrics 选出的 IQ 对。
fn apply_prediction(data: &mut CodexRadarData, v: &serde_json::Value) {
    let pred = v.get("prediction");
    data.probability_24h = pred
        .and_then(|p| p.get("probability_24h"))
        .and_then(|x| x.as_f64())
        .unwrap_or(0.0);
    data.probability_level = pred
        .and_then(|p| p.get("level"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
}

async fn fetch_json(
    client: &reqwest::Client,
    url: &str,
    force: bool,
    label: &str,
) -> Result<serde_json::Value, String> {
    let mut request = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(
            reqwest::header::USER_AGENT,
            concat!("glm-quota-monitor/", env!("CARGO_PKG_VERSION")),
        )
        .timeout(Duration::from_secs(20));
    if force {
        request = request
            .query(&[("refresh", "1")])
            .header(reqwest::header::CACHE_CONTROL, "no-cache");
    }

    request
        .send()
        .await
        .map_err(|e| format!("{label}请求失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("{label}返回错误状态: {e}"))?
        .json()
        .await
        .map_err(|e| format!("{label}响应解析失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{apply_prediction, parse_metrics};

    #[test]
    fn metrics_pick_highest_iq_with_matching_model_and_effort() {
        let value = serde_json::json!({
            "schema": 2,
            "mode": "weighted_latest_3",
            "source_updated_at": "2026-08-09T02:07:09+00:00",
            "points": [
                { "model": "gpt-5.6-sol", "effort": "max", "iq": 103.21 },
                { "model": "gpt-5.6-sol", "effort": "xhigh", "iq": 106.43 },
                { "model": "gpt-5.6-terra", "effort": "ultra", "iq": 98.57 }
            ]
        });

        let result = parse_metrics(&value).expect("metrics payload should parse");
        assert_eq!(result.best_model, "GPT-5.6 Sol xhigh");
        assert_eq!(result.best_score, 106.43);
        assert_eq!(result.updated_at, "2026-08-09T02:07:09+00:00");
    }

    #[test]
    fn metrics_reject_unsupported_website_snapshot() {
        let value = serde_json::json!({
            "schema": 1,
            "mode": "legacy",
            "points": [{ "model": "gpt-5.6-sol", "effort": "max", "iq": 150.0 }]
        });

        assert!(parse_metrics(&value).is_err());
    }

    #[test]
    fn prediction_is_merged_without_changing_the_iq_pair() {
        let metrics = serde_json::json!({
            "schema": 2,
            "mode": "weighted_latest_3",
            "source_updated_at": "2026-08-09T02:07:09+00:00",
            "points": [
                { "model": "gpt-5.6-sol", "effort": "xhigh", "iq": 106.43 }
            ]
        });
        let prediction = serde_json::json!({
            "prediction": { "probability_24h": 0.14, "level": "low" },
            "model_iq": {
                "latest": {
                    "model": "gpt-5.6-sol",
                    "reasoning_effort": "max",
                    "score": 103.21
                }
            }
        });

        let mut result = parse_metrics(&metrics).expect("metrics payload should parse");
        apply_prediction(&mut result, &prediction);

        assert_eq!(result.best_model, "GPT-5.6 Sol xhigh");
        assert_eq!(result.best_score, 106.43);
        assert_eq!(result.probability_24h, 0.14);
        assert_eq!(result.probability_level, "low");
    }
}

/// 同时拉取网站智力效率卡片与状态预测。走代理 client（境外 Cloudflare 站点）。
async fn fetch_radar(force: bool) -> Result<CodexRadarData, String> {
    let client = crate::proxy_http_client();
    let (metrics, status) = tokio::join!(
        fetch_json(&client, RADAR_METRICS_URL, force, "智力效率"),
        fetch_json(&client, RADAR_STATUS_URL, force, "重置预测")
    );
    let mut data = parse_metrics(&metrics?)?;
    apply_prediction(&mut data, &status?);
    Ok(data)
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
    match tauri::async_runtime::block_on(fetch_radar(false)) {
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
    match fetch_radar(true).await {
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
