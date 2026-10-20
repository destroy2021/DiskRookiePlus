//! `disk_delete`：删除文件/目录（目录递归删除）。确认两步协议的执行端。
//!
//! - `confirm: false`（默认）→ 仅预演（executor `dry_run_delete`），零文件系统修改；
//! - `confirm: true` → 真实执行（executor `delete_file`，唯一破坏性入口）。
//!   系统关键目录黑名单在 executor 内统一校验；黑名单命中路径在预演中标记
//!   `would_delete: false`，在执行中单独报错、不影响其他路径。

use serde_json::{json, Value};

use super::ToolResult;
use crate::path_util::{opt_bool, opt_str_array};

const MAX_PATHS: usize = 50;

pub fn run(args: &Value) -> ToolResult {
    let paths = opt_str_array(args, "paths")
        .ok_or_else(|| "缺少必填参数 paths（字符串数组）".to_string())?;
    if paths.is_empty() || paths.len() > MAX_PATHS {
        return Err(format!("paths 必须为 1..={MAX_PATHS} 项"));
    }
    let confirm = opt_bool(args, "confirm", false);

    if !confirm {
        // 预演：零文件系统修改
        let items = ai_disk_executor::dry_run_delete(&paths);
        let items_json: Vec<Value> = items
            .iter()
            .map(|it| {
                json!({
                    "path": it.path,
                    "exists": it.exists,
                    "is_dir": it.is_dir,
                    "size_bytes": it.size_bytes,
                    "would_delete": it.would_delete,
                    "blocked_reason": it.blocked_reason,
                })
            })
            .collect();
        let would_free: u64 = items
            .iter()
            .filter(|it| it.would_delete)
            .map(|it| it.size_bytes)
            .sum();
        return Ok(json!({
            "mode": "dry_run",
            "items": items_json,
            "would_free_bytes": would_free,
        }));
    }

    // 执行：先预演统计大小（同一套黑名单校验），再逐项删除；失败项如实报告不中断
    let dry = ai_disk_executor::dry_run_delete(&paths);
    let mut items_json = Vec::with_capacity(paths.len());
    let mut freed_bytes = 0u64;
    let mut any_error = false;
    for (p, dry_item) in paths.iter().zip(dry.iter()) {
        match ai_disk_executor::delete_file(p) {
            Ok(()) => {
                if dry_item.would_delete {
                    freed_bytes += dry_item.size_bytes;
                }
                items_json.push(json!({"path": p, "success": true, "error": Value::Null}));
            }
            Err(e) => {
                any_error = true;
                items_json.push(json!({"path": p, "success": false, "error": e.to_string()}));
            }
        }
    }
    Ok(json!({
        "mode": "executed",
        "items": items_json,
        "freed_bytes": freed_bytes,
        "partial_failure": any_error,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dry_run_zero_side_effects() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("victim.txt");
        std::fs::write(&f, b"data").unwrap();

        let res = run(&json!({"paths": [f.to_string_lossy()]})).unwrap();
        assert_eq!(res["mode"], "dry_run");
        assert_eq!(res["would_free_bytes"], 4);
        assert_eq!(res["items"][0]["would_delete"], true);
        // 零副作用
        assert!(f.exists());
    }

    #[test]
    fn test_confirm_false_is_default() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("safe.txt");
        std::fs::write(&f, b"x").unwrap();
        // 不传 confirm → 预演
        let res = run(&json!({"paths": [f.to_string_lossy()]})).unwrap();
        assert_eq!(res["mode"], "dry_run");
        assert!(f.exists());
    }

    #[test]
    fn test_real_delete_and_freed_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("real.txt");
        std::fs::write(&f, b"12345").unwrap();
        let res = run(&json!({
            "paths": [f.to_string_lossy()],
            "confirm": true
        }))
        .unwrap();
        assert_eq!(res["mode"], "executed");
        assert_eq!(res["items"][0]["success"], true);
        assert_eq!(res["freed_bytes"], 5);
        assert!(!f.exists());
    }

    #[test]
    fn test_forbidden_path_reports_error() {
        #[cfg(windows)]
        let forbidden = r"C:\Windows\System32";
        #[cfg(not(windows))]
        let forbidden = "/usr/bin";
        // 预演：would_delete=false 而非报错
        let res = run(&json!({"paths": [forbidden]})).unwrap();
        assert_eq!(res["items"][0]["would_delete"], false);
        // 执行：单独报错不影响其它路径（此处仅一条）
        let res2 = run(&json!({"paths": [forbidden], "confirm": true})).unwrap();
        assert_eq!(res2["items"][0]["success"], false);
        assert!(res2["items"][0]["error"].as_str().unwrap().contains("禁止"));
    }

    #[test]
    fn test_paths_count_validation() {
        assert!(run(&json!({"paths": []})).is_err());
        let many: Vec<String> = (0..51).map(|i| format!("C:\\x{i}")).collect();
        assert!(run(&json!({"paths": many})).is_err());
    }
}
