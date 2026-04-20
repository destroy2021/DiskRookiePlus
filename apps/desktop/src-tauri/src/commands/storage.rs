use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct StorageResult {
    success: bool,
    message: String,
}

/// 获取存储根目录 (.disk-rookie)
fn get_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    let home_dir = app.path().home_dir().map_err(|e| {
        log::error!("无法获取用户目录: {}", e);
        format!("无法获取用户目录: {}", e)
    })?;

    let storage_root = home_dir.join(".disk-rookie");

    // 确保目录存在
    if !storage_root.exists() {
        fs::create_dir_all(&storage_root).map_err(|e| {
            log::error!(
                "创建存储目录失败, path: {}, error: {}",
                storage_root.display(),
                e
            );
            format!("创建存储目录失败: {}", e)
        })?;
    }

    Ok(storage_root)
}

/// 读取文件
#[tauri::command]
pub async fn read_storage_file(app: AppHandle, filename: String) -> Result<String, String> {
    log::info!("读取存储文件: {}", filename);
    let storage_root = get_storage_root(&app)?;
    let file_path = storage_root.join(&filename);

    if !file_path.exists() {
        return Ok(String::new());
    }

    fs::read_to_string(&file_path).map_err(|e| {
        log::error!("读取存储文件失败, file: {}, error: {}", filename, e);
        format!("读取文件失败 {}: {}", filename, e)
    })
}

/// 写入文件
#[tauri::command]
pub async fn write_storage_file(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<StorageResult, String> {
    log::info!("写入存储文件: {}", filename);
    let storage_root = get_storage_root(&app)?;
    let file_path = storage_root.join(&filename);

    // 确保父目录存在
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| {
                log::error!("创建父目录失败, path: {}, error: {}", parent.display(), e);
                format!("创建目录失败: {}", e)
            })?;
        }
    }

    fs::write(&file_path, content).map_err(|e| {
        log::error!("写入存储文件失败, file: {}, error: {}", filename, e);
        format!("写入文件失败 {}: {}", filename, e)
    })?;

    Ok(StorageResult {
        success: true,
        message: format!("文件已保存: {}", filename),
    })
}

/// 删除文件
#[tauri::command]
pub async fn delete_storage_file(
    app: AppHandle,
    filename: String,
) -> Result<StorageResult, String> {
    log::info!("删除存储文件: {}", filename);
    let storage_root = get_storage_root(&app)?;
    let file_path = storage_root.join(&filename);

    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| {
            log::error!("删除存储文件失败, file: {}, error: {}", filename, e);
            format!("删除文件失败 {}: {}", filename, e)
        })?;
    }

    Ok(StorageResult {
        success: true,
        message: format!("文件已删除: {}", filename),
    })
}

/// 列出目录中的文件
#[tauri::command]
pub async fn list_storage_files(
    app: AppHandle,
    subdir: Option<String>,
) -> Result<Vec<String>, String> {
    let storage_root = get_storage_root(&app)?;
    let target_dir = if let Some(sub) = subdir {
        storage_root.join(sub)
    } else {
        storage_root
    };

    if !target_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&target_dir).map_err(|e| {
        log::error!(
            "读取存储目录失败, path: {}, error: {}",
            target_dir.display(),
            e
        );
        format!("读取目录失败: {}", e)
    })?;

    let mut files = Vec::new();
    for entry in entries.flatten() {
        if let Some(filename) = entry.file_name().to_str() {
            files.push(filename.to_string());
        }
    }

    files.sort();
    Ok(files)
}

/// 获取存储根目录路径
#[tauri::command]
pub async fn get_storage_path(app: AppHandle) -> Result<String, String> {
    let storage_root = get_storage_root(&app)?;
    storage_root.to_str().map(|s| s.to_string()).ok_or_else(|| {
        log::error!("存储路径转换字符串失败, path: {}", storage_root.display());
        "无法转换路径".to_string()
    })
}
