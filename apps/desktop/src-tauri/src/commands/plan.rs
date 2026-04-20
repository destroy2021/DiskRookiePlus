use ai_disk_domain::CleanupPlan;

#[tauri::command]
pub async fn get_cleanup_plan(scan_result: String) -> Result<CleanupPlan, String> {
    log::info!("开始生成清理计划");
    ai_disk_engine::plan_cleanup(&scan_result)
        .await
        .map_err(|e| {
            log::error!("生成清理计划失败: {}", e);
            e
        })
}
