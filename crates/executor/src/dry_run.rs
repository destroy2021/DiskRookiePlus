//! 预演（dry-run）：删除/移动前生成"将被影响的路径清单与大小预估"，零文件系统修改。
//!
//! 确认两步协议的第一步：`confirm: false` 时 MCP server 只调用本模块，
//! 不触碰 `delete_file` / `move_file`。
//!
//! 「路径是否存在」与「是否允许写」是两件事：前者决定 `exists`，
//! 后者决定 `would_delete`。合并成一次 canonicalize 会把存在的黑名单路径误报成不存在。

use std::path::Path;

use crate::forbidden::check_write_allowed;

/// 单个路径的预演条目
#[derive(Debug, Clone)]
pub struct DryRunItem {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    /// 递归大小（文件为自身大小，目录为子树累计；不存在为 0）
    pub size_bytes: u64,
    /// 通过黑名单校验、将被实际删除/移动
    pub would_delete: bool,
    /// 不可写的原因（黑名单 / 路径不存在 / 无法解析）；可写时为 None
    pub blocked_reason: Option<String>,
}

/// 对一批路径做删除预演：校验 + 大小统计，不修改任何文件。
/// 黑名单命中的路径 `would_delete: false` 并在 `blocked_reason` 说明，不报错（由调用方呈现）。
pub fn dry_run_delete(paths: &[String]) -> Vec<DryRunItem> {
    paths
        .iter()
        .map(|p| {
            let canonical = match std::fs::canonicalize(p.trim()) {
                Ok(c) => c,
                Err(e) => {
                    return DryRunItem {
                        path: p.trim().to_string(),
                        exists: false,
                        is_dir: false,
                        size_bytes: 0,
                        would_delete: false,
                        blocked_reason: Some(format!("路径不存在或无法解析: {e}")),
                    }
                }
            };
            let is_dir = canonical.is_dir();
            let size_bytes = if is_dir {
                dir_size(&canonical)
            } else {
                std::fs::metadata(&canonical).map(|m| m.len()).unwrap_or(0)
            };
            let blocked_reason = check_write_allowed(&canonical).err().map(|e| e.to_string());
            DryRunItem {
                path: canonical.display().to_string(),
                exists: true,
                is_dir,
                size_bytes,
                would_delete: blocked_reason.is_none(),
                blocked_reason,
            }
        })
        .collect()
}

/// 递归统计目录大小（流式累计，不可读/损坏目录按 0 跳过，与 scanner 行为一致）
fn dir_size(path: &Path) -> u64 {
    let mut total: u64 = 0;
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        if p.is_dir() {
            total = total.saturating_add(dir_size(&p));
        } else {
            total = total.saturating_add(entry.metadata().map(|m| m.len()).unwrap_or(0));
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dry_run_reports_and_keeps_files() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("a.txt"), b"hello").unwrap();
        std::fs::write(dir.path().join("b.txt"), b"world").unwrap();

        let paths = vec![
            sub.to_string_lossy().to_string(),
            dir.path().join("b.txt").to_string_lossy().to_string(),
            dir.path().join("missing.txt").to_string_lossy().to_string(),
        ];
        let items = dry_run_delete(&paths);

        assert_eq!(items.len(), 3);
        assert!(items[0].is_dir && items[0].size_bytes == 5 && items[0].would_delete);
        assert!(!items[1].is_dir && items[1].size_bytes == 5 && items[1].would_delete);
        assert!(!items[2].exists && !items[2].would_delete && items[2].size_bytes == 0);
        assert!(items[2].blocked_reason.is_some());

        // 预演零副作用
        assert!(sub.exists());
        assert!(dir.path().join("b.txt").exists());
    }

    #[test]
    fn test_dry_run_marks_forbidden_but_existing() {
        #[cfg(windows)]
        let forbidden = r"C:\Windows\System32".to_string();
        #[cfg(not(windows))]
        let forbidden = "/usr/bin".to_string();
        if Path::new(&forbidden).exists() {
            let items = dry_run_delete(&[forbidden]);
            assert_eq!(items.len(), 1);
            assert!(!items[0].would_delete, "黑名单路径必须标记为不删除");
            assert!(items[0].exists, "存在的黑名单路径必须如实报告 exists=true");
            assert!(items[0]
                .blocked_reason
                .as_deref()
                .is_some_and(|r| r.contains("禁止")));
        }
    }
}
