use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, UNIX_EPOCH};

use ai_disk_common::DiskAnalyzerError;
use ai_disk_domain::{ExtensionStat, FileNode, ScanResult, SummaryEntry};
use rayon::prelude::*;
use std::collections::HashMap;

const MAX_DEPTH: usize = 10;
const MAX_CHILDREN_PER_DIR: usize = 500;
const TOP_DIRECTORIES_DEFAULT_N: usize = 100;
const ROOT_CHILDREN_DEFAULT_N: usize = 100;
const EXTENSION_STATS_DEFAULT_N: usize = 50;

/// Windows: 文件或目录损坏且无法读取，遇到时跳过该路径继续扫描
#[cfg(windows)]
fn is_corruption_io_error(e: &std::io::Error) -> bool {
    match e.raw_os_error() {
        Some(1392) => true, // ERROR_FILE_CORRUPT
        Some(1393) => true, // ERROR_DISK_CORRUPT
        _ => false,
    }
}

#[cfg(not(windows))]
fn is_corruption_io_error(_e: &std::io::Error) -> bool {
    false
}

/// 遇到这些目录名时只统计总大小，不递归子项（常见包管理器/缓存目录）
pub(crate) const SHALLOW_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    ".github",
    ".venv",
    "venv",
    "__pycache__",
    "target",
    "vendor",
    ".npm",
    ".yarn",
    ".pnpm",
    "bower_components",
    "jspm_packages",
];

pub(crate) type ProgressCb = Box<dyn Fn(u64, &str) + Send + Sync>;

/// 可共享的进度回调，用于 MFT 加载时在后台线程中上报进度。
pub(crate) type ProgressCbArc = std::sync::Arc<ProgressCb>;
pub type CancelFlagArc = Arc<AtomicBool>;

fn is_cancel_requested(cancel_flag: Option<&CancelFlagArc>) -> bool {
    cancel_flag
        .map(|flag| flag.load(Ordering::Relaxed))
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_expected_mft_fallback(err: &DiskAnalyzerError) -> bool {
    match err {
        DiskAnalyzerError::PermissionDenied(_) => true,
        DiskAnalyzerError::InvalidPath(msg) => {
            msg.to_ascii_lowercase().contains("empty mft result")
        }
        _ => false,
    }
}

/// 仅统计目录总大小，不构建子树（用于 shallow 目录）
fn dir_size_only(
    path: &Path,
    counter: &AtomicU64,
    progress: Option<&ProgressCb>,
    cancel_flag: Option<&CancelFlagArc>,
) -> Result<(u64, bool), DiskAnalyzerError> {
    if is_cancel_requested(cancel_flag) {
        return Ok((0, true));
    }

    let mut total: u64 = 0;
    let mut interrupted = false;
    let entries = match std::fs::read_dir(path) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return Ok((0, false));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok((0, false));
        }
        Err(e) if is_corruption_io_error(&e) => {
            return Ok((0, false));
        }
        Err(e) => return Err(DiskAnalyzerError::Io(e)),
    };

    for entry in entries.filter_map(|e| e.ok()) {
        if is_cancel_requested(cancel_flag) {
            interrupted = true;
            break;
        }
        let child_path = entry.path();
        if child_path.is_dir() {
            if let Ok((size, child_interrupted)) =
                dir_size_only(&child_path, counter, progress, cancel_flag)
            {
                total = total.saturating_add(size);
                if child_interrupted {
                    interrupted = true;
                    break;
                }
            }
        } else {
            total = total.saturating_add(entry.metadata().map(|m| m.len()).unwrap_or(0));
        }
    }

    counter.fetch_add(1, Ordering::Relaxed);
    if let Some(ref cb) = progress {
        let path_display = path.display().to_string();
        cb(counter.load(Ordering::Relaxed), &path_display);
    }

    Ok((total, interrupted))
}

fn build_tree(
    path: &Path,
    name: &str,
    depth: usize,
    counter: &AtomicU64,
    progress: Option<&ProgressCb>,
    shallow_dirs: bool,
    cancel_flag: Option<&CancelFlagArc>,
) -> Result<(Option<FileNode>, u64, bool), DiskAnalyzerError> {
    if is_cancel_requested(cancel_flag) {
        return Ok((None, 0, true));
    }

    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err(DiskAnalyzerError::PermissionDenied(
                path.display().to_string(),
            ));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(DiskAnalyzerError::PermissionDenied(format!(
                "{} [missing]",
                path.display()
            )));
        }
        Err(e) if is_corruption_io_error(&e) => {
            return Ok((
                Some(FileNode {
                    path: path.display().to_string(),
                    name: format!("{} [corrupt]", name),
                    size: 0,
                    is_dir: false,
                    modified: None,
                    children: vec![],
                }),
                0u64,
                false,
            ));
        }
        Err(e) => return Err(DiskAnalyzerError::Io(e)),
    };

    let is_dir = metadata.is_dir();
    let mut size = if is_dir { 0u64 } else { metadata.len() };
    let mut file_count = if is_dir { 0u64 } else { 1u64 };
    let mut children = Vec::new();
    let mut interrupted = false;

    if is_dir && depth < MAX_DEPTH {
        let entries = match std::fs::read_dir(path) {
            Ok(iter) => iter,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(DiskAnalyzerError::PermissionDenied(
                    path.display().to_string(),
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(DiskAnalyzerError::PermissionDenied(format!(
                    "{} [missing]",
                    path.display()
                )));
            }
            Err(e) if is_corruption_io_error(&e) => {
                return Ok((
                    Some(FileNode {
                        path: path.display().to_string(),
                        name: name.to_string(),
                        size: 0,
                        is_dir: true,
                        modified: metadata
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs()),
                        children: vec![],
                    }),
                    0u64,
                    false,
                ));
            }
            Err(e) => return Err(DiskAnalyzerError::Io(e)),
        };

        let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        entries.sort_by(|a, b| {
            let a_is_dir = a.path().is_dir();
            let b_is_dir = b.path().is_dir();
            match (a_is_dir, b_is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a
                    .file_name()
                    .cmp(&b.file_name())
                    .then_with(|| a.path().as_os_str().cmp(b.path().as_os_str())),
            }
        });

        let entries: Vec<_> = entries.into_iter().take(MAX_CHILDREN_PER_DIR).collect();
        let cancel_for_iter = cancel_flag.cloned();

        let results: Vec<_> = entries
            .par_iter()
            .map(|entry| {
                if is_cancel_requested(cancel_for_iter.as_ref()) {
                    return Ok((None, 0u64, true));
                }

                let child_path = entry.path();
                let child_name = entry.file_name().to_string_lossy().to_string();
                let is_shallow_dir = child_path.is_dir()
                    && shallow_dirs
                    && SHALLOW_DIR_NAMES
                        .iter()
                        .any(|&s| s.eq_ignore_ascii_case(&child_name));
                let entry_modified = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());

                if is_shallow_dir {
                    match dir_size_only(&child_path, counter, progress, cancel_for_iter.as_ref()) {
                        Ok((child_size, child_interrupted)) => {
                            if child_interrupted {
                                return Ok((None, 0u64, true));
                            }
                            Ok((
                                Some(FileNode {
                                    path: child_path.display().to_string(),
                                    name: child_name.clone(),
                                    size: child_size,
                                    is_dir: true,
                                    modified: entry_modified,
                                    children: vec![],
                                }),
                                1u64,
                                false,
                            ))
                        }
                        Err(DiskAnalyzerError::PermissionDenied(_)) => Ok((
                            Some(FileNode {
                                path: child_path.display().to_string(),
                                name: format!("{} [denied]", child_name),
                                size: 0,
                                is_dir: true,
                                modified: None,
                                children: vec![],
                            }),
                            0u64,
                            false,
                        )),
                        Err(DiskAnalyzerError::Io(ref e)) if is_corruption_io_error(e) => Ok((
                            Some(FileNode {
                                path: child_path.display().to_string(),
                                name: format!("{} [corrupt]", child_name),
                                size: 0,
                                is_dir: true,
                                modified: None,
                                children: vec![],
                            }),
                            0u64,
                            false,
                        )),
                        Err(e) => Err(e),
                    }
                } else {
                    match build_tree(
                        &child_path,
                        &child_name,
                        depth + 1,
                        counter,
                        progress,
                        shallow_dirs,
                        cancel_for_iter.as_ref(),
                    ) {
                        Ok((node, cnt, child_interrupted)) => Ok((node, cnt, child_interrupted)),
                        Err(DiskAnalyzerError::PermissionDenied(_)) => Ok((
                            Some(FileNode {
                                path: child_path.display().to_string(),
                                name: format!("{} [denied]", child_name),
                                size: 0,
                                is_dir: child_path.is_dir(),
                                modified: None,
                                children: vec![],
                            }),
                            0u64,
                            false,
                        )),
                        Err(DiskAnalyzerError::Io(ref e)) if is_corruption_io_error(e) => Ok((
                            Some(FileNode {
                                path: child_path.display().to_string(),
                                name: format!("{} [corrupt]", child_name),
                                size: 0,
                                is_dir: child_path.is_dir(),
                                modified: None,
                                children: vec![],
                            }),
                            0u64,
                            false,
                        )),
                        Err(e) => Err(e),
                    }
                }
            })
            .collect();

        for r in results {
            let (node, cnt, child_interrupted) = r?;
            if child_interrupted {
                interrupted = true;
            }
            if let Some(node) = node {
                size = size.saturating_add(node.size);
                file_count = file_count.saturating_add(cnt);
                children.push(node);
            }
        }

        if is_cancel_requested(cancel_flag) {
            interrupted = true;
        }

        counter.fetch_add(file_count, Ordering::Relaxed);
        if let Some(ref cb) = progress {
            let total_so_far = counter.load(Ordering::Relaxed);
            let path_display = path.display().to_string();
            cb(total_so_far, &path_display);
        }
    }

    if is_cancel_requested(cancel_flag) {
        interrupted = true;
    }

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok((
        Some(FileNode {
            path: path.display().to_string(),
            name: name.to_string(),
            size,
            is_dir,
            modified,
            children,
        }),
        file_count,
        interrupted,
    ))
}

fn normalize_ext(path: &str) -> String {
    match std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::trim)
    {
        Some(ext) if !ext.is_empty() => format!(".{}", ext.to_ascii_lowercase()),
        _ => "[no_ext]".to_string(),
    }
}

pub(crate) fn build_scan_summaries(
    root: &FileNode,
) -> (Vec<SummaryEntry>, Vec<SummaryEntry>, Vec<ExtensionStat>) {
    let mut top_directories = Vec::new();
    let mut ext_stats: HashMap<String, (u64, u64)> = HashMap::new();
    let mut dir_counts: HashMap<String, (u64, u64)> = HashMap::new();

    fn walk(
        node: &FileNode,
        is_root: bool,
        top_directories: &mut Vec<SummaryEntry>,
        dir_counts: &mut HashMap<String, (u64, u64)>,
        ext_stats: &mut HashMap<String, (u64, u64)>,
    ) -> (u64, u64) {
        if !node.is_dir {
            let ext = normalize_ext(&node.path);
            let stat = ext_stats.entry(ext).or_insert((0, 0));
            stat.0 = stat.0.saturating_add(node.size);
            stat.1 = stat.1.saturating_add(1);
            return (1, 0);
        }

        let mut file_count = 0u64;
        let mut dir_count = 0u64;
        for child in &node.children {
            let (f, d) = walk(child, false, top_directories, dir_counts, ext_stats);
            file_count = file_count.saturating_add(f);
            dir_count = dir_count.saturating_add(d);
            if child.is_dir {
                dir_count = dir_count.saturating_add(1);
            }
        }
        dir_counts.insert(node.path.clone(), (file_count, dir_count));
        if !is_root {
            top_directories.push(SummaryEntry {
                path: node.path.clone(),
                name: node.name.clone(),
                size: node.size,
                file_count: Some(file_count),
                dir_count: Some(dir_count),
                is_dir: true,
            });
        }
        (file_count, dir_count)
    }

    walk(
        root,
        true,
        &mut top_directories,
        &mut dir_counts,
        &mut ext_stats,
    );

    top_directories.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.path.cmp(&b.path)));
    top_directories.truncate(TOP_DIRECTORIES_DEFAULT_N);

    let mut root_children: Vec<SummaryEntry> = root
        .children
        .iter()
        .map(|child| {
            let (file_count, dir_count) = dir_counts.get(&child.path).copied().unwrap_or((0, 0));
            SummaryEntry {
                path: child.path.clone(),
                name: child.name.clone(),
                size: child.size,
                file_count: child.is_dir.then_some(file_count),
                dir_count: child.is_dir.then_some(dir_count),
                is_dir: child.is_dir,
            }
        })
        .collect();
    root_children.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.path.cmp(&b.path)));
    root_children.truncate(ROOT_CHILDREN_DEFAULT_N);

    let mut extension_stats: Vec<ExtensionStat> = ext_stats
        .into_iter()
        .map(|(ext, (size, count))| ExtensionStat { ext, size, count })
        .collect();
    extension_stats.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| b.count.cmp(&a.count)));
    extension_stats.truncate(EXTENSION_STATS_DEFAULT_N);

    (top_directories, root_children, extension_stats)
}

/// 规范化路径（支持正斜杠、去除首尾空白）
pub(crate) fn normalize_path(path: &str) -> std::path::PathBuf {
    let s = path.trim();
    #[cfg(windows)]
    let s = s.replace('/', "\\");
    std::path::PathBuf::from(s)
}

/// 通过操作系统 API 获取该路径所在卷的总容量与剩余空间（仅 Windows 有效）。
fn get_volume_space_for_result_path(path: &std::path::Path) -> (Option<u64>, Option<u64>) {
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        match crate::mft_scan::get_volume_space_bytes(&s) {
            Some((t, f)) => (Some(t), Some(f)),
            None => (None, None),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        (None, None)
    }
}

/// 判断本次扫描是否会使用 MFT（在真正开始扫描前可调用，用于提前打日志）。
/// 条件：use_mft 为 true、路径存在、为 Windows 卷根（如 C:\）。
pub fn scan_will_use_mft(path: &str, use_mft: bool) -> bool {
    if !use_mft {
        return false;
    }
    let path_buf = normalize_path(path);
    if !path_buf.exists() {
        return false;
    }
    let canonical = match std::fs::canonicalize(&path_buf) {
        Ok(p) => p,
        Err(_) => return false,
    };
    #[cfg(windows)]
    return crate::mft_scan::is_windows_volume_root(&canonical);
    #[cfg(not(windows))]
    {
        let _ = canonical;
        false
    }
}

/// 执行磁盘扫描（支持进度回调；shallow_dirs 为 true 时对 node_modules/.git 等只计大小不递归）。
/// 当 use_mft 为 true 且路径为 Windows 磁盘卷根（如 C:\）时，优先使用 MFT 加速扫描。
/// 返回 `(ScanResult, used_mft)`，其中 `used_mft` 表示本次是否成功使用了 MFT。
fn append_scan_warning(base: Option<String>, message: &str) -> Option<String> {
    match base {
        Some(mut existing) => {
            if !existing.is_empty() {
                existing.push_str(" | ");
            }
            existing.push_str(message);
            Some(existing)
        }
        None => Some(message.to_string()),
    }
}

pub fn scan_path_with_progress_and_cancel(
    path: &str,
    progress: Option<&ProgressCbArc>,
    shallow_dirs: bool,
    use_mft: bool,
    cancel_flag: Option<&CancelFlagArc>,
) -> Result<(ScanResult, bool), DiskAnalyzerError> {
    let start = Instant::now();
    let path_buf = normalize_path(path);

    if !path_buf.exists() {
        return Err(DiskAnalyzerError::InvalidPath(format!(
            "路径不存在: {}",
            path
        )));
    }

    let path_buf = std::fs::canonicalize(&path_buf)
        .map_err(|e| DiskAnalyzerError::InvalidPath(format!("无法解析路径: {}", e)))?;

    #[allow(unused_mut, unused_assignments)]
    let mut mft_fallback_reason: Option<String> = None;
    let _ = use_mft; // used only on windows
    #[cfg(windows)]
    if use_mft && cancel_flag.is_none() && crate::mft_scan::is_windows_volume_root(&path_buf) {
        stderr_ln!(
            "[scan] path is volume root, attempting MFT full scan: {}",
            path_buf.display()
        );
        match crate::mft_scan::scan_volume_mft(path, progress.cloned(), shallow_dirs) {
            Ok(result) => return Ok((result, true)),
            Err(e) => {
                let msg: String = e.to_string();
                if is_expected_mft_fallback(&e) {
                    stderr_ln!(
                        "[scan] MFT unavailable (expected fallback), reason: {}. falling back to normal walk.",
                        msg
                    );
                } else {
                    stderr_ln!(
                        "[scan] MFT scan unavailable, falling back to normal walk. reason: {}",
                        msg
                    );
                    mft_fallback_reason = Some(msg);
                }
            }
        }
    }

    stderr_ln!("[scan] using normal directory walk: {}", path_buf.display());
    let name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string();

    let counter = AtomicU64::new(0);
    let (root, file_count, interrupted) = build_tree(
        &path_buf,
        &name,
        0,
        &counter,
        progress.map(std::sync::Arc::as_ref),
        shallow_dirs,
        cancel_flag,
    )?;
    let root = root.unwrap_or_else(|| FileNode {
        path: path_buf.display().to_string(),
        name: name.clone(),
        size: 0,
        is_dir: path_buf.is_dir(),
        modified: None,
        children: vec![],
    });
    let scan_time_ms = start.elapsed().as_millis() as u64;
    let total_size = root.size;
    let (top_directories, root_children, extension_stats) = build_scan_summaries(&root);

    let (volume_total_bytes, volume_free_bytes) = get_volume_space_for_result_path(&path_buf);
    let warning = if interrupted {
        append_scan_warning(
            mft_fallback_reason,
            "scan interrupted by user; partial result keeps only validated scanned entries",
        )
    } else {
        mft_fallback_reason
    };

    Ok((
        ScanResult {
            root,
            scan_time_ms,
            file_count,
            total_size,
            scan_warning: warning,
            interrupted,
            volume_total_bytes,
            volume_free_bytes,
            top_files: None,
            top_directories,
            root_children,
            extension_stats,
        },
        false,
    ))
}

pub fn scan_path_with_progress(
    path: &str,
    progress: Option<&ProgressCbArc>,
    shallow_dirs: bool,
    use_mft: bool,
) -> Result<(ScanResult, bool), DiskAnalyzerError> {
    scan_path_with_progress_and_cancel(path, progress, shallow_dirs, use_mft, None)
}

/// 执行磁盘扫描（无进度；默认开启 shallow_dirs；默认开启 MFT 加速卷根）
pub fn scan_path(path: &str) -> Result<ScanResult, DiskAnalyzerError> {
    scan_path_with_progress(path, None::<&ProgressCbArc>, true, true).map(|(r, _)| r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;

    fn create_test_dir() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().expect("create temp dir");
        let path = dir.path().to_string_lossy().to_string();
        let sub = dir.path().join("subdir");
        fs::create_dir_all(&sub).unwrap();
        File::create(sub.join("a.txt"))
            .unwrap()
            .write_all(b"hello")
            .unwrap();
        File::create(dir.path().join("b.txt"))
            .unwrap()
            .write_all(b"world")
            .unwrap();
        (dir, path)
    }

    #[test]
    fn test_normalize_path() {
        let pb = normalize_path("  /a/b/c  ");
        #[cfg(windows)]
        assert!(pb.to_string_lossy().contains('\\') || pb.to_string_lossy().contains('/'));
        #[cfg(not(windows))]
        assert!(pb.to_string_lossy().contains('/'));
    }

    #[test]
    fn test_scan_invalid_path() {
        let err = scan_path("/nonexistent/path/12345").unwrap_err();
        assert!(matches!(err, DiskAnalyzerError::InvalidPath(_)));
    }

    #[test]
    fn test_scan_nonexistent_path() {
        #[cfg(windows)]
        let bad_path = "C:\\nonexistent_xyz_12345_folder";
        #[cfg(not(windows))]
        let bad_path = "/nonexistent_xyz_12345_folder";
        let err = scan_path(bad_path).unwrap_err();
        assert!(matches!(err, DiskAnalyzerError::InvalidPath(_)));
    }

    #[test]
    fn test_scan_temp_dir() {
        let (_guard, path) = create_test_dir();
        let result = scan_path(&path).unwrap();
        assert!(result.file_count >= 2);
        assert!(result.total_size >= 10);

        assert!(!result.root.children.is_empty());
        assert!(!result.top_directories.is_empty());
        assert!(!result.root_children.is_empty());
        assert!(!result.extension_stats.is_empty());
    }

    #[test]
    #[cfg(windows)]
    fn test_scan_academic_path() {
        let path = "C:\\Users\\K\\Academic";
        if std::path::Path::new(path).exists() {
            let result = scan_path(path).unwrap();
            assert!(result.root.name == "Academic" || !result.root.path.is_empty());
        }
    }

    #[test]
    #[cfg(windows)]
    fn test_expected_mft_fallback_cases() {
        assert!(is_expected_mft_fallback(
            &DiskAnalyzerError::PermissionDenied("admin".to_string())
        ));
        assert!(is_expected_mft_fallback(&DiskAnalyzerError::InvalidPath(
            "empty MFT result".to_string()
        )));
        assert!(!is_expected_mft_fallback(&DiskAnalyzerError::InvalidPath(
            "x".to_string()
        )));
    }

    #[test]
    fn test_scan_summary_fields_sorted_and_limited() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let root = dir.path();
        fs::create_dir_all(root.join("large")).unwrap();
        fs::create_dir_all(root.join("small")).unwrap();
        fs::create_dir_all(root.join("empty")).unwrap();
        File::create(root.join("large").join("a.log"))
            .unwrap()
            .write_all(&vec![1u8; 16])
            .unwrap();
        File::create(root.join("large").join("b.log"))
            .unwrap()
            .write_all(&vec![2u8; 8])
            .unwrap();
        File::create(root.join("small").join("c.txt"))
            .unwrap()
            .write_all(&vec![3u8; 4])
            .unwrap();
        File::create(root.join("README"))
            .unwrap()
            .write_all(&vec![4u8; 2])
            .unwrap();

        let result = scan_path(root.to_string_lossy().as_ref()).unwrap();
        assert!(!result.top_directories.is_empty());
        assert!(!result.root_children.is_empty());
        assert!(!result.extension_stats.is_empty());
        assert!(result.top_directories.len() <= TOP_DIRECTORIES_DEFAULT_N);
        assert!(result.root_children.len() <= ROOT_CHILDREN_DEFAULT_N);
        assert!(result.extension_stats.len() <= EXTENSION_STATS_DEFAULT_N);
        assert!(result
            .top_directories
            .windows(2)
            .all(|w| w[0].size >= w[1].size));
        assert!(result
            .root_children
            .windows(2)
            .all(|w| w[0].size >= w[1].size));
        assert!(result
            .extension_stats
            .windows(2)
            .all(|w| w[0].size >= w[1].size));
        assert!(result.extension_stats.iter().any(|e| e.ext == ".log"));
        assert!(result.extension_stats.iter().any(|e| e.ext == ".txt"));
    }
}
