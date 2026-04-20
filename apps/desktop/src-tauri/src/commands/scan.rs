use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use ai_disk_domain::ScanResult;
use ai_disk_scanner::{scan_path_with_progress_and_cancel, CancelFlagArc};
use tauri::{async_runtime, Emitter, State, Window};

#[derive(Default)]
pub struct ScanCancelRegistry {
    flags: Mutex<HashMap<String, CancelFlagArc>>,
}

impl ScanCancelRegistry {
    fn register_for_window(&self, window_key: &str) -> CancelFlagArc {
        let mut guard = self
            .flags
            .lock()
            .expect("scan cancel registry mutex poisoned");
        let flag = Arc::new(AtomicBool::new(false));
        guard.insert(window_key.to_string(), flag.clone());
        flag
    }

    fn cancel_window_scan(&self, window_key: &str) -> bool {
        let guard = self
            .flags
            .lock()
            .expect("scan cancel registry mutex poisoned");
        if let Some(flag) = guard.get(window_key) {
            flag.store(true, Ordering::Relaxed);
            return true;
        }
        false
    }

    fn clear_if_same(&self, window_key: &str, expected: &CancelFlagArc) {
        let mut guard = self
            .flags
            .lock()
            .expect("scan cancel registry mutex poisoned");
        let should_remove = guard
            .get(window_key)
            .map(|flag| Arc::ptr_eq(flag, expected))
            .unwrap_or(false);
        if should_remove {
            guard.remove(window_key);
        }
    }
}

#[tauri::command]
pub async fn scan_path_command(
    window: Window,
    path: String,
    shallow_dirs: Option<bool>,
    use_mft: Option<bool>,
    cancel_registry: State<'_, ScanCancelRegistry>,
) -> Result<ScanResult, String> {
    let path_trimmed = path.trim().to_string();
    let use_shallow = shallow_dirs.unwrap_or(true);
    let use_mft = use_mft.unwrap_or(true);
    let window_key = window.label().to_string();
    let cancel_flag = cancel_registry.register_for_window(&window_key);

    let thread_count = std::thread::available_parallelism()
        .map(|p| p.get())
        .unwrap_or(1);
    if use_mft {
        log::info!(
            "[DiskRookie] scan start (MFT requested), path: {}, threads: {}",
            path_trimmed,
            thread_count
        );
    } else {
        log::info!(
            "[DiskRookie] scan start (normal walk), path: {}",
            path_trimmed
        );
    }

    let path_clone = path_trimmed.clone();
    let window_progress = window.clone();
    let progress = Arc::new(Box::new(move |count: u64, path_str: &str| {
        let _ = window_progress.emit("scan-progress", (count, path_str.to_string()));
    }) as Box<dyn Fn(u64, &str) + Send + Sync>);
    let window_emit = window.clone();
    let cancel_flag_for_scan = cancel_flag.clone();

    let scan_join_result = async_runtime::spawn_blocking(move || {
        scan_path_with_progress_and_cancel(
            &path_clone,
            Some(&progress),
            use_shallow,
            use_mft,
            Some(&cancel_flag_for_scan),
        )
    })
    .await;

    cancel_registry.clear_if_same(&window_key, &cancel_flag);

    let (result, used_mft) = scan_join_result
        .map_err(|e| {
            log::error!("scan worker thread failed: {}", e);
            e.to_string()
        })?
        .map_err(|e| {
            log::error!("scan failed, path: {}, error: {}", path_trimmed, e);
            e.to_string()
        })?;

    if result.interrupted {
        log::info!(
            "[DiskRookie] scan interrupted, path: {}, file_count: {}, total_size: {}",
            path_trimmed,
            result.file_count,
            result.total_size
        );
    } else if used_mft {
        log::info!(
            "[DiskRookie] scan done (MFT used), path: {}, file_count: {}, total_size: {}",
            path_trimmed,
            result.file_count,
            result.total_size
        );
    } else {
        log::info!(
            "[DiskRookie] scan done (normal walk), path: {}, file_count: {}, total_size: {}",
            path_trimmed,
            result.file_count,
            result.total_size
        );
    }
    let _ = window_emit.emit("scan-mft-status", (path_trimmed.clone(), used_mft));
    Ok(result)
}

#[tauri::command]
pub fn cancel_scan_command(
    window: Window,
    cancel_registry: State<'_, ScanCancelRegistry>,
) -> Result<bool, String> {
    let window_key = window.label().to_string();
    let accepted = cancel_registry.cancel_window_scan(&window_key);
    if accepted {
        log::info!(
            "[DiskRookie] scan cancel requested for window {}",
            window_key
        );
    } else {
        log::warn!(
            "[DiskRookie] scan cancel requested but no active scan found for window {}",
            window_key
        );
    }
    Ok(accepted)
}
