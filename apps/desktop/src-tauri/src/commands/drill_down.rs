use ai_disk_domain::DirectoryTopNResult;
use ai_disk_scanner::scan_directory_top_n;

#[tauri::command]
pub async fn scan_directory_top_n_command(
    path: String,
    top_n: Option<usize>,
    top_files_n: Option<usize>,
) -> Result<DirectoryTopNResult, String> {
    let path_trimmed = path.trim().to_string();
    log::info!(
        "[DiskRookie] directory top-n scan start, path: {}, top_n: {:?}, top_files_n: {:?}",
        path_trimmed,
        top_n,
        top_files_n
    );

    let path_for_scan = path_trimmed.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        scan_directory_top_n(&path_for_scan, top_n, top_files_n)
    })
    .await
    .map_err(|e| {
        log::error!("directory top-n scan worker thread failed: {}", e);
        e.to_string()
    })?
    .map_err(|e| {
        log::error!(
            "directory top-n scan failed, path: {}, error: {}",
            path_trimmed,
            e
        );
        e.to_string()
    })?;

    log::info!(
        "[DiskRookie] directory top-n scan done, path: {}, file_count: {}, total_size: {}, top_dirs: {}, top_files: {}",
        result.path,
        result.file_count,
        result.total_size,
        result.top_directories.len(),
        result.top_files.len()
    );

    Ok(result)
}
