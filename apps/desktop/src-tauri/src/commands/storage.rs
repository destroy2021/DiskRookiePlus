use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct StorageResult {
    success: bool,
    message: String,
}

/// 获取存储根目录 (.disk-rookie)
fn get_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| format!("无法获取用户目录: {}", e))?;

    let storage_root = home_dir.join(".disk-rookie");

    // 确保目录存在
    if !storage_root.exists() {
        fs::create_dir_all(&storage_root).map_err(|e| format!("创建存储目录失败: {}", e))?;
    }

    Ok(storage_root)
}

/// 读取文件
#[tauri::command]
pub async fn read_storage_file(app: AppHandle, filename: String) -> Result<String, String> {
    let storage_root = get_storage_root(&app)?;
    let file_path = storage_root.join(&filename);

    if !file_path.exists() {
        return Ok(String::new());
    }

    fs::read_to_string(&file_path).map_err(|e| format!("读取文件失败 {}: {}", filename, e))
}

/// 写入文件
#[tauri::command]
pub async fn write_storage_file(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<StorageResult, String> {
    let storage_root = get_storage_root(&app)?;
    let file_path = storage_root.join(&filename);

    // 确保父目录存在
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }

    fs::write(&file_path, content).map_err(|e| format!("写入文件失败 {}: {}", filename, e))?;

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
    let storage_root = get_storage_root(&app)?;
    let file_path = storage_root.join(&filename);

    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| format!("删除文件失败 {}: {}", filename, e))?;
    }

    Ok(StorageResult {
        success: true,
        message: format!("文件已删除: {}", filename),
    })
}

/// 以 gzip 压缩写入文本文件（快照等大 JSON 用，重复键名压缩率通常 10 倍以上）
#[tauri::command]
pub async fn write_storage_file_gzip(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<u64, String> {
    let file_path = get_storage_root(&app)?.join(&filename);

    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }

    let file =
        fs::File::create(&file_path).map_err(|e| format!("创建文件失败 {}: {}", filename, e))?;
    let mut encoder = GzEncoder::new(file, Compression::new(6));
    encoder
        .write_all(content.as_bytes())
        .map_err(|e| format!("压缩写入失败 {}: {}", filename, e))?;
    encoder
        .finish()
        .map_err(|e| format!("压缩完成失败 {}: {}", filename, e))?;
    let written = fs::metadata(&file_path)
        .map(|m| m.len())
        .map_err(|e| format!("读取文件大小失败 {}: {}", filename, e))?;
    Ok(written)
}

/// 读取 gzip 压缩的文本文件；文件不存在时返回空串
#[tauri::command]
pub async fn read_storage_file_gzip(app: AppHandle, filename: String) -> Result<String, String> {
    let file_path = get_storage_root(&app)?.join(&filename);

    if !file_path.exists() {
        return Ok(String::new());
    }

    let file =
        fs::File::open(&file_path).map_err(|e| format!("打开文件失败 {}: {}", filename, e))?;
    let mut decoder = GzDecoder::new(file);
    let mut out = String::new();
    decoder
        .read_to_string(&mut out)
        .map_err(|e| format!("解压读取失败 {}: {}", filename, e))?;
    Ok(out)
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

    let entries = fs::read_dir(&target_dir).map_err(|e| format!("读取目录失败: {}", e))?;

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
    storage_root
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "无法转换路径".to_string())
}
