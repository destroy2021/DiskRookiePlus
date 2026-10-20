//! 迁移执行：本地移动（同卷 rename 快路径，跨卷先复制后删除）。
//!
//! 约束（来自 MCP 工具设计）：
//! - 目标必须存在且为目录；
//! - 同名冲突跳过并标记 `skipped_reason: "target_exists"`（由调用方组装结果，本函数返回错误由调用方转译）；
//! - 跨卷先复制后删除，删除失败报告并保留源，不留半份文件（复制用临时名，成功后再删源）。

use std::path::{Path, PathBuf};

use ai_disk_common::DiskAnalyzerError;

use crate::forbidden::canonicalize_for_write;

/// 单项移动结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MoveOutcome {
    /// 移动成功（同卷 rename）
    Renamed,
    /// 移动成功（跨卷复制后删除源）
    CopiedThenDeleted,
    /// 目标同名已存在，跳过（源保留）
    TargetExists,
}

impl MoveOutcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            MoveOutcome::Renamed => "renamed",
            MoveOutcome::CopiedThenDeleted => "copied_then_deleted",
            MoveOutcome::TargetExists => "target_exists",
        }
    }
}

/// 移动单个文件或目录到目标目录。
/// - `source` 经 `canonicalize_for_write` 黑名单校验（删除源也是破坏性操作）。
/// - `destination_dir` 必须存在且为目录（同样 canonicalize，避免 `\\?\` 前缀与相对路径混入）。
/// - 目标目录下同名条目已存在 → `Ok(TargetExists)`，不覆盖。
pub fn move_file(from: &str, to_dir: &str) -> Result<MoveOutcome, DiskAnalyzerError> {
    let source = canonicalize_for_write(from)?;
    // 目标目录只要求可解析且为目录：黑名单仅约束“写入点”，目标目录本身不应被写操作拦截。
    let dest_dir = std::fs::canonicalize(to_dir.trim())
        .map_err(|e| DiskAnalyzerError::InvalidPath(format!("目标目录不存在或无法解析: {e}")))?;
    if !dest_dir.is_dir() {
        return Err(DiskAnalyzerError::InvalidPath(format!(
            "目标目录不存在或不是目录: {}",
            dest_dir.display()
        )));
    }
    let file_name = source.file_name().ok_or_else(|| {
        DiskAnalyzerError::InvalidPath(format!("源路径缺少文件名: {}", source.display()))
    })?;
    let target = dest_dir.join(file_name);
    if target.exists() {
        return Ok(MoveOutcome::TargetExists);
    }

    // 同卷 rename 快路径
    if same_volume(&source, &dest_dir) {
        return std::fs::rename(&source, &target)
            .map(|_| MoveOutcome::Renamed)
            .map_err(|e| {
                DiskAnalyzerError::Io(std::io::Error::new(
                    e.kind(),
                    format!(
                        "移动失败 {} -> {}: {}",
                        source.display(),
                        target.display(),
                        e
                    ),
                ))
            });
    }

    // 跨卷：先完整复制到临时名，成功后删源；删源失败保留源（调用方如实报告）
    let tmp_target = dest_dir.join(format!(".diskrookie_mcp_{}", file_name.to_string_lossy()));
    if tmp_target.exists() {
        std::fs::remove_dir_all(&tmp_target)
            .or_else(|_| std::fs::remove_file(&tmp_target))
            .map_err(|e| {
                DiskAnalyzerError::Io(std::io::Error::new(
                    e.kind(),
                    format!("清理残留临时路径失败 {}: {}", tmp_target.display(), e),
                ))
            })?;
    }
    copy_recursive(&source, &tmp_target)?;
    match std::fs::rename(&tmp_target, &target) {
        Ok(()) => {}
        Err(e) => {
            // rename 失败（如目标刚被创建）：清理临时路径后报错
            let _ =
                std::fs::remove_dir_all(&tmp_target).or_else(|_| std::fs::remove_file(&tmp_target));
            return Err(DiskAnalyzerError::Io(std::io::Error::new(
                e.kind(),
                format!(
                    "移动失败 {} -> {}: {}",
                    source.display(),
                    target.display(),
                    e
                ),
            )));
        }
    }
    delete_source_keep_on_failure(&source)?;
    Ok(MoveOutcome::CopiedThenDeleted)
}

/// 删除源；失败时不回滚目标（已成功复制），仅报错让调用方如实转告"源保留，需手动处理"。
fn delete_source_keep_on_failure(source: &Path) -> Result<(), DiskAnalyzerError> {
    let removed = if source.is_dir() {
        std::fs::remove_dir_all(source)
    } else {
        std::fs::remove_file(source)
    };
    removed.map_err(|e| {
        DiskAnalyzerError::Io(std::io::Error::new(
            e.kind(),
            format!(
                "跨卷移动：目标已复制成功，但删除源失败（源已保留） {}: {}",
                source.display(),
                e
            ),
        ))
    })
}

/// 判断两个路径是否在同一卷：比较 canonicalize 后路径的卷根前缀（Windows 盘符 `C:\`，Unix `/`）。
/// 纯 std 实现，跨平台（红线 7）。
fn same_volume(a: &Path, b: &Path) -> bool {
    let (Ok(ca), Ok(cb)) = (std::fs::canonicalize(a), std::fs::canonicalize(b)) else {
        return false; // 元数据不可得时按跨卷处理（走复制路径，更安全）
    };
    volume_root(&ca) == volume_root(&cb)
}

/// 取路径所在卷的根：`C:\` 或 `/`。路径不可解析时回退到整段路径（不相等即走跨卷安全路径）。
fn volume_root(p: &Path) -> PathBuf {
    if p.is_absolute() {
        let mut comps = p.components();
        let mut root = PathBuf::new();
        if let Some(first) = comps.next() {
            root.push(first.as_os_str());
            // Windows Prefix 根（如 `C:\`）已含完整前缀；Unix RootDir 为 `/`
            return root;
        }
    }
    p.to_path_buf()
}

/// 递归复制文件或目录（含权限位）。流式复制文件内容，不整文件载入。
fn copy_recursive(src: &Path, dst: &Path) -> Result<(), DiskAnalyzerError> {
    let meta = std::fs::metadata(src).map_err(DiskAnalyzerError::Io)?;
    if meta.is_dir() {
        std::fs::create_dir_all(dst).map_err(DiskAnalyzerError::Io)?;
        for entry in std::fs::read_dir(src).map_err(DiskAnalyzerError::Io)? {
            let entry = entry.map_err(DiskAnalyzerError::Io)?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dst).map(|_| ()).map_err(|e| {
            DiskAnalyzerError::Io(std::io::Error::new(
                e.kind(),
                format!("复制文件失败 {} -> {}: {}", src.display(), dst.display(), e),
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, String, String) {
        let dir = tempfile::tempdir().unwrap();
        let src_dir = dir.path().join("src");
        let dst_dir = dir.path().join("dst");
        std::fs::create_dir_all(src_dir.join("nested")).unwrap();
        std::fs::create_dir_all(&dst_dir).unwrap();
        std::fs::write(src_dir.join("a.txt"), b"hello").unwrap();
        std::fs::write(src_dir.join("nested").join("b.txt"), b"world").unwrap();
        (
            dir,
            src_dir.to_string_lossy().to_string(),
            dst_dir.to_string_lossy().to_string(),
        )
    }

    #[test]
    fn test_move_directory() {
        let (_guard, src, dst) = setup();
        let out = move_file(&src, &dst).unwrap();
        assert!(matches!(out, MoveOutcome::Renamed));
        assert!(Path::new(&dst).join("src").join("a.txt").exists());
        assert!(!Path::new(&src).exists());
    }

    #[test]
    fn test_move_target_exists_skips() {
        let (_guard, src, dst) = setup();
        move_file(&src, &dst).unwrap();
        // 重新创建同名源再移动 → 跳过
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(Path::new(&src).join("a.txt"), b"hello").unwrap();
        let out = move_file(&src, &dst).unwrap();
        assert!(matches!(out, MoveOutcome::TargetExists));
        assert!(Path::new(&src).exists(), "源必须保留");
    }

    #[test]
    fn test_move_dest_must_be_dir() {
        let (_guard, src, dst) = setup();
        let not_dir = std::path::Path::new(&dst).join("not_a_dir");
        let err = move_file(&src, &not_dir.to_string_lossy()).unwrap_err();
        assert!(matches!(err, DiskAnalyzerError::InvalidPath(_)));
    }
}
