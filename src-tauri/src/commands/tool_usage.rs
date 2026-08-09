use crate::api::client::ZhipuClient;
use crate::api::types::ToolUsageData;
use crate::crypto;

#[tauri::command]
pub async fn get_tool_usage(account_id: String) -> Result<ToolUsageData, String> {
    let api_key =
        crypto::get_api_key(&account_id).map_err(|e| format!("API Key 读取失败: {}", e))?;

    let client = ZhipuClient::with_client(&crate::HTTP_CLIENT, &api_key);
    let now = chrono::Local::now();
    let start = (now - chrono::Duration::hours(24))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let end = now.format("%Y-%m-%d %H:%M:%S").to_string();

    client
        .get_tool_usage(&start, &end)
        .await
        .map_err(|e| e.to_string())
}
