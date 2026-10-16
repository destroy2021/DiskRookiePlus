use std::fs;
use std::path::Path;

#[tauri::command]
pub async fn delete_item(path: String) -> Result<String, String> {
    log::info!("删除请求: {}", path);
    let path_buf = Path::new(&path);

    if !path_buf.exists() {
        log::error!("删除失败，路径不存在: {}", path);
        return Err(format!("路径不存在: {}", path));
    }

    // 安全检查：禁止删除系统关键目录
    let forbidden_paths = if cfg!(windows) {
        vec![
            "C:\\Windows",
            "C:\\Program Files",
            "C:\\Program Files (x86)",
            "C:\\System Volume Information",
        ]
    } else {
        vec![
            "/System", "/Library", "/bin", "/sbin", "/usr", "/etc", "/var",
        ]
    };

    let canonical = fs::canonicalize(path_buf).map_err(|e| {
        log::error!("删除失败，无法解析路径: {}, error: {}", path, e);
        format!("无法解析路径: {}", e)
    })?;

    let canonical_str = canonical.to_string_lossy().to_string();

    for forbidden in forbidden_paths {
        if canonical_str.starts_with(forbidden) {
            log::warn!("拦截删除系统目录: {}", forbidden);
            return Err(format!("禁止删除系统目录: {}", forbidden));
        }
    }

    // 执行删除
    if path_buf.is_dir() {
        fs::remove_dir_all(path_buf).map_err(|e| {
            log::error!("删除目录失败: {}, error: {}", path, e);
            format!("删除目录失败: {}", e)
        })?;
        log::info!("删除目录成功: {}", path);
        Ok(format!("已删除目录: {}", path))
    } else {
        fs::remove_file(path_buf).map_err(|e| {
            log::error!("删除文件失败: {}, error: {}", path, e);
            format!("删除文件失败: {}", e)
        })?;
        log::info!("删除文件成功: {}", path);
        Ok(format!("已删除文件: {}", path))
    }
}

#[tauri::command]
pub async fn trash_item(path: String) -> Result<String, String> {
    log::info!("移到回收站请求: {}", path);
    let path_buf = Path::new(&path);

    if !path_buf.exists() {
        log::error!("移到回收站失败，路径不存在: {}", path);
        return Err(format!("路径不存在: {}", path));
    }

    // 安全检查：禁止操作系统关键目录
    let forbidden_paths = if cfg!(windows) {
        vec![
            "C:\\Windows",
            "C:\\Program Files",
            "C:\\Program Files (x86)",
            "C:\\System Volume Information",
        ]
    } else {
        vec![
            "/System", "/Library", "/bin", "/sbin", "/usr", "/etc", "/var",
        ]
    };

    let canonical = fs::canonicalize(path_buf).map_err(|e| {
        log::error!("移到回收站失败，无法解析路径: {}, error: {}", path, e);
        format!("无法解析路径: {}", e)
    })?;

    let canonical_str = canonical.to_string_lossy().to_string();

    for forbidden in forbidden_paths {
        if canonical_str.starts_with(forbidden) {
            log::warn!("拦截移到回收站系统目录: {}", forbidden);
            return Err(format!("禁止操作系统目录: {}", forbidden));
        }
    }

    trash::delete(path_buf).map_err(|e| {
        log::error!("移到回收站失败: {}, error: {}", path, e);
        format!("移到回收站失败: {}", e)
    })?;
    log::info!("移到回收站成功: {}", path);
    Ok(format!("已移到回收站: {}", path))
}
