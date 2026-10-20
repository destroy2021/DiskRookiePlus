//! 删除执行：executor 是所有破坏性操作的唯一入口（AGENTS.md 红线 1）。
//!
//! `delete_file` 落地为真实实现：canonicalize + 黑名单校验（`forbidden.rs`）后删除，
//! 逻辑自 src-tauri `delete_item` 迁移（行为一致：目录递归删除）。
//! 调用方（MCP server / Tauri 命令）必须自行实现"预演 → 用户确认 → 执行"两步协议，
//! 本函数不做任何确认逻辑。
//!
//! 注：原占位为 `async fn`，落地时改为同步签名——内部是纯阻塞 fs 操作，
//! 无现有调用方，同步签名使调用方无需引入 async runtime。

use ai_disk_common::DiskAnalyzerError;

use crate::forbidden::canonicalize_for_write;

/// 删除文件或目录（目录递归删除）。
/// 先经 `canonicalize_for_write` 黑名单校验，命中受保护系统目录则拒绝。
pub fn delete_file(path: &str) -> Result<(), DiskAnalyzerError> {
    let canonical = canonicalize_for_write(path)?;

    if canonical.is_dir() {
        std::fs::remove_dir_all(&canonical).map_err(|e| {
            DiskAnalyzerError::Io(std::io::Error::new(
                e.kind(),
                format!("删除目录失败 {}: {}", canonical.display(), e),
            ))
        })?;
    } else {
        std::fs::remove_file(&canonical).map_err(|e| {
            DiskAnalyzerError::Io(std::io::Error::new(
                e.kind(),
                format!("删除文件失败 {}: {}", canonical.display(), e),
            ))
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_delete_file_real() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("a.txt"), b"hello").unwrap();
        let p = dir.path().to_string_lossy().to_string();

        // 删除子目录（递归）
        let sub_path = sub.to_string_lossy().to_string();
        delete_file(&sub_path).unwrap();
        assert!(!sub.exists());

        // 删除单文件
        std::fs::write(dir.path().join("b.txt"), b"world").unwrap();
        let b_path = dir.path().join("b.txt").to_string_lossy().to_string();
        delete_file(&b_path).unwrap();
        assert!(!dir.path().join("b.txt").exists());

        // 不存在路径
        let no_such = std::path::Path::new(&p).join("no_such_file");
        let err = delete_file(&no_such.to_string_lossy()).unwrap_err();
        assert!(matches!(err, DiskAnalyzerError::InvalidPath(_)));
    }
}
