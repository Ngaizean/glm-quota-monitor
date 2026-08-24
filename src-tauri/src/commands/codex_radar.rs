//! Codex 雷达 —— codexradar.com 智力效率与重置预测接入
//!
//! IQ 必须跟随网站 `/api/radar-insights` 的 Codex 站“综合智能”口径；
//! 24h 硬重置概率仍来自 `/current.json` 的 prediction。归属要求：数据来自
//! Codex 雷达 codexradar.com。
//!
//! 策略：后台线程定时拉取（数据源响应慢 ~10s），缓存到 app state，
//! 前端 invoke 同步读取缓存，永不阻塞 popover。

use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

const RADAR_INSIGHTS_URL: &str = "https://codexradar.com/api/radar-insights";
const RADAR_STATUS_URL: &str = "https://codexradar.com/current.json";

/// 缓存的雷达摘要（前端渲染所需的最小字段集）
#[derive(Serialize, Clone, Default)]
pub struct CodexRadarData {
    /// Codex 站综合智能 IQ 最高模型的可读名，如 "GPT-5.6 Sol ultra"
    pub best_model: String,
    /// 对应 IQ 分数
    pub best_score: f64,
    /// 24 小时内硬重置概率（0~1）
    pub probability_24h: f64,
    /// 文本级概率档位（low/medium/high/...）
    pub probability_level: String,
    /// 网站智力效率快照的来源时间（ISO 时间）
    pub updated_at: String,
    /// Codex 站“日常开发”当前推荐，按网站顺序保留前两项。
    pub daily_models: Vec<String>,
    /// Codex 站“难题攻坚”当前推荐，按网站顺序保留前两项。
    pub hard_problem_models: Vec<String>,
}

#[derive(Debug, Default, PartialEq)]
struct RadarRecommendations {
    daily_models: Vec<String>,
    hard_problem_models: Vec<String>,
    updated_at: String,
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

fn is_codex_model(model: &str) -> bool {
    model.starts_with("gpt-") || model.starts_with("codex-")
}

/// 按网站 Codex 站“综合智能”卡片口径解析，并选择最高 IQ 点。
/// 模型、effort 和 IQ 始终来自同一个 point，避免把一个档位的名字和另一个档位的
/// 分数拼在一起。
/// 只接受 Codex 可用的 GPT/Codex 模型，防止未限定站点的模型混入主卡。
fn parse_comprehensive_metrics(v: &serde_json::Value) -> Result<CodexRadarData, String> {
    let points = v
        .get("comprehensive_points")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "雷达洞察响应缺少 comprehensive_points".to_string())?;

    let best = points
        .iter()
        .filter_map(|point| {
            let model = point.get("model")?.as_str()?.trim();
            let effort = point.get("effort")?.as_str()?.trim();
            let score = point.get("iq")?.as_f64()?;
            if !is_codex_model(model) || effort.is_empty() || !score.is_finite() {
                return None;
            }
            Some((score, model, effort))
        })
        .max_by(|left, right| left.0.total_cmp(&right.0))
        .ok_or_else(|| "雷达洞察响应没有有效的 Codex 综合智能点".to_string())?;

    let updated_at = v
        .get("source_updated_at")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "雷达洞察响应缺少来源时间".to_string())?;

    Ok(CodexRadarData {
        best_model: pretty_model(best.1, best.2),
        best_score: best.0,
        probability_24h: 0.0,
        probability_level: String::new(),
        updated_at: updated_at.to_string(),
        daily_models: Vec::new(),
        hard_problem_models: Vec::new(),
    })
}

/// 解析网站 Codex 站“站长推荐”。推荐规则由网站维护，应用只同步结果，
/// 避免在本地用最高 IQ 或成本重新推断而与页面产生偏差。
fn parse_recommendations(v: &serde_json::Value) -> Result<RadarRecommendations, String> {
    let groups = v
        .get("recommendations")
        .or_else(|| v.get("station_recommendations"))
        .or_else(|| v.get("station_recs"))
        .and_then(|value| value.as_array())
        .ok_or_else(|| "雷达推荐响应缺少 recommendations".to_string())?;

    let parse_items = |group: &serde_json::Value| {
        group
            .get("items")
            .or_else(|| group.get("models"))
            .or_else(|| group.get("recommendations"))
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let model = item.get("model")?.as_str()?.trim();
                let effort = item.get("effort")?.as_str()?.trim();
                if model.is_empty() || effort.is_empty() || model.starts_with("deepseek") {
                    return None;
                }
                Some(pretty_model(model, effort))
            })
            .take(2)
            .collect::<Vec<_>>()
    };

    let mut result = RadarRecommendations {
        updated_at: v
            .get("source_updated_at")
            .or_else(|| v.get("generated_at"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        ..Default::default()
    };

    for group in groups {
        let key = group
            .get("key")
            .or_else(|| group.get("id"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .replace('_', "-");
        match key.as_str() {
            "daily-development" => result.daily_models = parse_items(group),
            "hard-problems" => result.hard_problem_models = parse_items(group),
            _ => {}
        }
    }

    if result.daily_models.is_empty() && result.hard_problem_models.is_empty() {
        return Err("雷达推荐响应缺少目标分类".to_string());
    }
    Ok(result)
}

fn apply_recommendations(data: &mut CodexRadarData, recommendations: RadarRecommendations) {
    data.daily_models = recommendations.daily_models;
    data.hard_problem_models = recommendations.hard_problem_models;
    if !recommendations.updated_at.is_empty() && recommendations.updated_at > data.updated_at {
        data.updated_at = recommendations.updated_at;
    }
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
    use super::{apply_prediction, parse_comprehensive_metrics, parse_recommendations};

    #[test]
    fn insights_pick_codex_highest_comprehensive_iq_instead_of_other_stations() {
        let value = serde_json::json!({
            "schema": 1,
            "source_updated_at": "2026-08-24T02:18:19+00:00",
            "comprehensive_points": [
                { "model": "gpt-5.6-sol", "effort": "max", "iq": 102.71 },
                { "model": "gpt-5.6-sol", "effort": "ultra", "iq": 103.06 },
                { "model": "kimi-k3", "effort": "max", "iq": 150.0 }
            ]
        });

        let result =
            parse_comprehensive_metrics(&value).expect("Codex comprehensive payload should parse");
        assert_eq!(result.best_model, "GPT-5.6 Sol ultra");
        assert_eq!(result.best_score, 103.06);
    }

    #[test]
    fn comprehensive_metrics_keep_model_effort_and_score_together() {
        let value = serde_json::json!({
            "source_updated_at": "2026-08-09T02:07:09+00:00",
            "comprehensive_points": [
                { "model": "gpt-5.6-sol", "effort": "max", "iq": 103.21 },
                { "model": "gpt-5.6-sol", "effort": "xhigh", "iq": 106.43 },
                { "model": "gpt-5.6-terra", "effort": "ultra", "iq": 98.57 }
            ]
        });

        let result = parse_comprehensive_metrics(&value).expect("metrics payload should parse");
        assert_eq!(result.best_model, "GPT-5.6 Sol xhigh");
        assert_eq!(result.best_score, 106.43);
        assert_eq!(result.updated_at, "2026-08-09T02:07:09+00:00");
    }

    #[test]
    fn comprehensive_metrics_require_codex_points() {
        let value = serde_json::json!({
            "source_updated_at": "2026-08-24T02:18:19+00:00",
            "comprehensive_points": [
                { "model": "kimi-k3", "effort": "max", "iq": 150.0 }
            ]
        });

        assert!(parse_comprehensive_metrics(&value).is_err());
    }

    #[test]
    fn prediction_is_merged_without_changing_the_iq_pair() {
        let metrics = serde_json::json!({
            "source_updated_at": "2026-08-09T02:07:09+00:00",
            "comprehensive_points": [
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

        let mut result =
            parse_comprehensive_metrics(&metrics).expect("metrics payload should parse");
        apply_prediction(&mut result, &prediction);

        assert_eq!(result.best_model, "GPT-5.6 Sol xhigh");
        assert_eq!(result.best_score, 106.43);
        assert_eq!(result.probability_24h, 0.14);
        assert_eq!(result.probability_level, "low");
    }

    #[test]
    fn recommendations_follow_codex_station_categories_and_order() {
        let value = serde_json::json!({
            "schema": 1,
            "source_updated_at": "2026-08-24T02:01:30+00:00",
            "recommendations": [
                {
                    "key": "daily_development",
                    "items": [
                        { "model": "gpt-5.6-sol", "effort": "medium", "iq": 92.02 },
                        { "model": "gpt-5.6-sol", "effort": "high", "iq": 93.34 },
                        { "model": "", "effort": "low", "iq": 99.0 }
                    ]
                },
                {
                    "key": "hard_problems",
                    "items": [
                        { "model": "gpt-5.6-sol", "effort": "ultra", "iq": 103.04 },
                        { "model": "gpt-5.6-sol", "effort": "max", "iq": 102.74 }
                    ]
                },
                {
                    "key": "background_automation",
                    "items": [{ "model": "gpt-5.6-luna", "effort": "high", "iq": 80.0 }]
                }
            ]
        });

        let result = parse_recommendations(&value).expect("recommendations should parse");
        assert_eq!(
            result.daily_models,
            vec!["GPT-5.6 Sol medium", "GPT-5.6 Sol high"]
        );
        assert_eq!(
            result.hard_problem_models,
            vec!["GPT-5.6 Sol ultra", "GPT-5.6 Sol max"]
        );
        assert_eq!(result.updated_at, "2026-08-24T02:01:30+00:00");
    }

    #[test]
    fn recommendations_require_at_least_one_target_category() {
        let value = serde_json::json!({
            "schema": 1,
            "recommendations": [{
                "key": "lobster_tasks",
                "items": [{ "model": "gpt-5.6-luna", "effort": "low" }]
            }]
        });

        assert!(parse_recommendations(&value).is_err());
    }
}

/// 同时拉取 Codex 站综合智能、站长推荐与状态预测。走代理 client。
async fn fetch_radar(force: bool) -> Result<CodexRadarData, String> {
    let client = crate::proxy_http_client();
    let (insights, status) = tokio::join!(
        fetch_json(&client, RADAR_INSIGHTS_URL, force, "雷达洞察"),
        fetch_json(&client, RADAR_STATUS_URL, force, "重置预测"),
    );
    let insights = insights?;
    let mut data = parse_comprehensive_metrics(&insights)?;
    apply_prediction(&mut data, &status?);
    match parse_recommendations(&insights) {
        Ok(recommendations) => apply_recommendations(&mut data, recommendations),
        Err(error) => eprintln!("codex radar recommendations unavailable: {error}"),
    }
    Ok(data)
}

/// 推荐接口短暂不可用时保留上一次成功同步的分类，避免刷新让卡片内容倒退。
fn preserve_cached_recommendations(app: &tauri::AppHandle, data: &mut CodexRadarData) {
    if !data.daily_models.is_empty() && !data.hard_problem_models.is_empty() {
        return;
    }
    let Some(state) = app.try_state::<CodexRadarState>() else {
        return;
    };
    let Ok(cache) = state.0.lock() else {
        return;
    };
    let Some(cached) = cache.as_ref() else {
        return;
    };
    if data.daily_models.is_empty() {
        data.daily_models.clone_from(&cached.daily_models);
    }
    if data.hard_problem_models.is_empty() {
        data.hard_problem_models
            .clone_from(&cached.hard_problem_models);
    }
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
        Ok(mut data) => {
            preserve_cached_recommendations(app, &mut data);
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
        Ok(mut data) => {
            preserve_cached_recommendations(&app, &mut data);
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
