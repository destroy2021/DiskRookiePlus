//! 在系统文件管理器中打开路径：Windows 为资源管理器，macOS 为 Finder。

use std::path::Path;
use std::process::Command;

#[tauri::command]
pub async fn open_in_file_manager(path: String, is_file: Option<bool>) -> Result<(), String> {
    log::info!("打开文件管理器请求, path: {}, is_file: {:?}", path, is_file);
    let path_buf = Path::new(&path);
    if !path_buf.exists() {
        log::error!("打开文件管理器失败，路径不存在: {}", path);
        return Err(format!("路径不存在: {}", path));
    }
    let is_file = is_file.unwrap_or_else(|| path_buf.is_file());

    #[cfg(windows)]
    {
        let path_abs = path_buf.canonicalize().map_err(|e| {
            log::error!("打开文件管理器失败，路径解析失败: {}, error: {}", path, e);
            format!("无法解析路径: {}", e)
        })?;
        let path_str = path_abs.to_string_lossy();
        if is_file {
            // 打开资源管理器并选中该文件（格式: /select,"path"）
            let arg = format!("/select,{}", path_str);
            Command::new("explorer").arg(arg).spawn().map_err(|e| {
                log::error!("打开资源管理器失败: {}", e);
                format!("无法打开资源管理器: {}", e)
            })?;
        } else {
            // 打开该文件夹
            Command::new("explorer")
                .arg(path_str.as_ref())
                .spawn()
                .map_err(|e| {
                    log::error!("打开资源管理器失败: {}", e);
                    format!("无法打开资源管理器: {}", e)
                })?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        let path_abs = path_buf.canonicalize().map_err(|e| {
            log::error!("打开 Finder 失败，路径解析失败: {}, error: {}", path, e);
            format!("无法解析路径: {}", e)
        })?;
        let path_str = path_abs.to_string_lossy();
        if is_file {
            // 在 Finder 中显示并选中该文件
            Command::new("open")
                .args(["-R", path_str.as_ref()])
                .spawn()
                .map_err(|e| {
                    log::error!("打开 Finder 失败: {}", e);
                    format!("无法打开 Finder: {}", e)
                })?;
        } else {
            Command::new("open")
                .arg(path_str.as_ref())
                .spawn()
                .map_err(|e| {
                    log::error!("打开 Finder 失败: {}", e);
                    format!("无法打开 Finder: {}", e)
                })?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let path_abs = path_buf.canonicalize().map_err(|e| {
            log::error!("打开文件管理器失败，路径解析失败: {}, error: {}", path, e);
            format!("无法解析路径: {}", e)
        })?;
        let path_str = path_abs.to_string_lossy();
        let dir = if is_file {
            path_abs
                .parent()
                .ok_or_else(|| {
                    log::error!("打开文件管理器失败，无法获取父目录: {}", path);
                    "无法获取父目录".to_string()
                })?
                .to_string_lossy()
        } else {
            path_str
        };
        Command::new("xdg-open")
            .arg(dir.as_ref())
            .spawn()
            .map_err(|e| {
                log::error!("打开 Linux 文件管理器失败: {}", e);
                format!("无法打开文件管理器: {}", e)
            })?;
    }

    log::info!("打开文件管理器成功, path: {}", path);
    Ok(())
}
