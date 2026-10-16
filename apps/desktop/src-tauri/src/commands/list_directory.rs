use ai_disk_domain::{DirEntry, DirectoryListing};
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant, UNIX_EPOCH};

const LIST_DIRECTORY_LIMIT: usize = 500;
const DIRECTORY_SIZE_TIMEOUT: Duration = Duration::from_secs(10);

#[tauri::command]
pub async fn list_directory_command(path: String) -> Result<DirectoryListing, String> {
    let path_trimmed = path.trim().to_string();
    let dir_path = Path::new(&path_trimmed);

    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path_trimmed));
    }
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path_trimmed));
    }

    let path_for_list = path_trimmed.clone();
    let result = tauri::async_runtime::spawn_blocking(move || list_directory_sync(&path_for_list))
        .await
        .map_err(|e| {
            log::error!("list_directory worker thread failed: {}", e);
            e.to_string()
        })?
        .map_err(|e| {
            log::error!("list_directory failed, path: {}, error: {}", path_trimmed, e);
            e
        })?;

    Ok(result)
}

fn list_directory_sync(path: &str) -> Result<DirectoryListing, String> {
    let dir_path = Path::new(path);
    let name = dir_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let rd = fs::read_dir(dir_path).map_err(|e| format!("Cannot read directory: {}", e))?;
    let mut entries: Vec<DirEntry> = Vec::new();
    let mut total_count: u64 = 0;

    for entry in rd.flatten() {
        total_count += 1;
        if entries.len() >= LIST_DIRECTORY_LIMIT {
            continue;
        }
        entries.push(build_dir_entry(entry));
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(DirectoryListing {
        path: path.to_string(),
        name,
        items: entries,
        truncated: total_count > LIST_DIRECTORY_LIMIT as u64,
        total_count: Some(total_count),
    })
}

fn build_dir_entry(entry: fs::DirEntry) -> DirEntry {
    let file_name = entry.file_name();
    let name = file_name.to_string_lossy().to_string();
    let path = entry.path().to_string_lossy().to_string();

    let metadata = match entry.metadata() {
        Ok(m) => m,
        Err(_) => {
            return DirEntry {
                name,
                path,
                size: 0,
                is_dir: false,
                modified: None,
                child_count: None,
            };
        }
    };

    let is_dir = metadata.is_dir();
    let size = if is_dir { 0 } else { metadata.len() };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    let child_count = if is_dir {
        Some(
            fs::read_dir(entry.path())
                .map(|rd| rd.count() as u64)
                .unwrap_or(0),
        )
    } else {
        None
    };

    DirEntry {
        name,
        path,
        size,
        is_dir,
        modified,
        child_count,
    }
}

#[tauri::command]
pub async fn get_directory_size_command(path: String) -> Result<DirectorySizeResult, String> {
    let path_trimmed = path.trim().to_string();
    let path_for_calc = path_trimmed.clone();
    let result = tauri::async_runtime::spawn_blocking(move || calc_directory_size_sync(&path_for_calc))
        .await
        .map_err(|e| {
            log::error!("get_directory_size worker thread failed: {}", e);
            e.to_string()
        })?
        .map_err(|e| {
            log::error!(
                "get_directory_size failed, path: {}, error: {}",
                path_trimmed,
                e
            );
            e
        })?;

    Ok(result)
}

#[tauri::command]
pub async fn get_file_info_command(path: String) -> Result<FileInfoResult, String> {
    let path_trimmed = path.trim().to_string();
    if path_trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }

    let path_for_info = path_trimmed.clone();
    let result = tauri::async_runtime::spawn_blocking(move || get_file_info_sync(&path_for_info))
        .await
        .map_err(|e| {
            log::error!("get_file_info worker thread failed: {}", e);
            e.to_string()
        })?
        .map_err(|e| {
            log::error!("get_file_info failed, path: {}, error: {}", path_trimmed, e);
            e
        })?;

    Ok(result)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DirectorySizeResult {
    pub path: String,
    pub total_size: u64,
    pub file_count: u64,
    pub dir_count: u64,
    pub timed_out: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileInfoResult {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: Option<u64>,
    pub is_dir: bool,
    pub extension: Option<String>,
    pub child_count: Option<u64>,
}

fn calc_directory_size_sync(path: &str) -> Result<DirectorySizeResult, String> {
    let dir_path = Path::new(path);
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut result = DirectorySizeResult {
        path: path.to_string(),
        total_size: 0,
        file_count: 0,
        dir_count: 0,
        timed_out: false,
    };
    let started_at = Instant::now();

    walk_directory_size(dir_path, &mut result, started_at);

    Ok(result)
}

fn walk_directory_size(path: &Path, result: &mut DirectorySizeResult, started_at: Instant) {
    if started_at.elapsed() >= DIRECTORY_SIZE_TIMEOUT {
        result.timed_out = true;
        return;
    }

    let Ok(rd) = fs::read_dir(path) else {
        return;
    };

    for entry in rd.flatten() {
        if result.timed_out || started_at.elapsed() >= DIRECTORY_SIZE_TIMEOUT {
            result.timed_out = true;
            return;
        }

        let Ok(meta) = entry.metadata() else {
            continue;
        };

        if meta.is_dir() {
            result.dir_count += 1;
            walk_directory_size(&entry.path(), result, started_at);
        } else {
            result.file_count += 1;
            result.total_size = result.total_size.saturating_add(meta.len());
        }
    }
}

fn get_file_info_sync(path: &str) -> Result<FileInfoResult, String> {
    let file_path = Path::new(path);
    if !file_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let metadata = fs::metadata(file_path).map_err(|e| format!("Cannot read metadata: {}", e))?;
    let is_dir = metadata.is_dir();
    let name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    let extension = file_path.extension().map(|ext| ext.to_string_lossy().to_string());
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    let child_count = if is_dir {
        Some(fs::read_dir(file_path).map(|rd| rd.count() as u64).unwrap_or(0))
    } else {
        None
    };

    Ok(FileInfoResult {
        path: path.to_string(),
        name,
        size: if is_dir { 0 } else { metadata.len() },
        modified,
        is_dir,
        extension,
        child_count,
    })
}
