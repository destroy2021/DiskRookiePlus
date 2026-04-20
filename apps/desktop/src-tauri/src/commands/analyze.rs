#[tauri::command]
pub async fn analyze_disk(path: String) -> Result<String, String> {
    log::info!("收到 AI 分析请求, path: {}", path);
    Ok(r#"{"status":"ok","message":"分析功能待实现"}"#.to_string())
}
