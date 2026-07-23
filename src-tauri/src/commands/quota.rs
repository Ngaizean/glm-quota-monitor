use crate::api::client::ZhipuClient;
use crate::api::types::QuotaData;
use crate::crypto;
use crate::db::{self, Database};
use crate::fetch_today_tokens;
use tauri::State;

#[tauri::command]
pub fn get_quota(db: State<'_, Database>, account_id: String) -> Result<QuotaData, String> {
    let api_key = crypto::get_api_key(&account_id)
        .map_err(|e| format!("API Key 读取失败: {}", e))?;

    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    let quota = tauri::async_runtime::block_on(client.get_quota_limit())
        .map_err(|e| e.to_string())?;

    // 获取真实的今日 token 用量与调用数（修复此前硬编码 0.0 导致趋势图被污染的 bug）
    let (today_tokens, today_calls) = fetch_today_tokens(&client);

    let conn = db.conn.lock().map_err(|e| format!("数据库锁定: {}", e))?;
    db::record_quota_snapshot(&conn, &account_id, &quota, today_tokens, today_calls)
        .map_err(|e| e.to_string())?;

    Ok(quota)
}
