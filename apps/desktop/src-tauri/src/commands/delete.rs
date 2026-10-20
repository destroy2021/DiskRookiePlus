use std::path::Path;

use ai_disk_executor::canonicalize_for_write;

#[tauri::command]
pub async fn delete_item(path: String) -> Result<String, String> {
    let path_buf = Path::new(&path);

    if !path_buf.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    // 安全检查：canonicalize + 黑名单校验统一在 executor
    // （FORBIDDEN_PATHS / CLEAN_SAFE_EXCEPTIONS 单一定义，消除双份维护）
    let canonical = canonicalize_for_write(&path).map_err(|e| e.to_string())?;

    // 执行删除（黑名单已过，删除走 canonical 路径与原行为一致）
    if path_buf.is_dir() {
        std::fs::remove_dir_all(&canonical).map_err(|e| format!("删除目录失败: {}", e))?;
        Ok(format!("已删除目录: {}", path))
    } else {
        std::fs::remove_file(&canonical).map_err(|e| format!("删除文件失败: {}", e))?;
        Ok(format!("已删除文件: {}", path))
    }
}
