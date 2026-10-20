//! `disk_move`：把文件/目录移动到另一目录（本地迁移场景）。
//!
//! - `confirm: false`（默认）→ 仅预演：返回将被移动的源清单与大小，零文件系统修改；
//! - `confirm: true` → 真实执行（executor `move_file`：同卷 rename / 跨卷复制后删）。
//!   同名冲突跳过并标记 `skipped_reason: "target_exists"`。

use serde_json::{json, Value};

use super::ToolResult;
use crate::path_util::{opt_bool, opt_str_array};
use ai_disk_executor::MoveOutcome;

const MAX_SOURCES: usize = 50;

pub fn run(args: &Value) -> ToolResult {
    let sources = opt_str_array(args, "sources")
        .ok_or_else(|| "缺少必填参数 sources（字符串数组）".to_string())?;
    if sources.is_empty() || sources.len() > MAX_SOURCES {
        return Err(format!("sources 必须为 1..={MAX_SOURCES} 项"));
    }
    let destination_dir = args
        .get("destination_dir")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少必填参数 destination_dir".to_string())?
        .to_string();
    let confirm = opt_bool(args, "confirm", false);

    if !std::path::Path::new(&destination_dir).is_dir() {
        return Err(format!("目标目录不存在或不是目录: {destination_dir}"));
    }

    if !confirm {
        // 预演：复用 dry_run_delete（源路径同样过黑名单校验；移动 = 源位置的删除）
        let items = ai_disk_executor::dry_run_delete(&sources);
        let items_json: Vec<Value> = items
            .iter()
            .zip(sources.iter())
            .map(|(it, src)| {
                // 目标同名冲突标记
                let name = std::path::Path::new(src)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let target = std::path::Path::new(&destination_dir).join(&name);
                let skipped_reason = if !it.exists {
                    Some("source_not_found")
                } else if !it.would_delete {
                    Some("forbidden_path")
                } else if target.exists() {
                    Some("target_exists")
                } else {
                    None
                };
                json!({
                    "source": src,
                    "destination": target.display().to_string(),
                    "exists": it.exists,
                    "is_dir": it.is_dir,
                    "size_bytes": it.size_bytes,
                    "would_move": it.would_delete && skipped_reason.is_none(),
                    "skipped_reason": skipped_reason,
                })
            })
            .collect();
        return Ok(json!({
            "mode": "dry_run",
            "destination_dir": destination_dir,
            "items": items_json,
        }));
    }

    // 执行：逐项移动；TargetExists / 失败逐项报告不中断
    let mut items_json = Vec::with_capacity(sources.len());
    let mut any_skip_or_error = false;
    for src in &sources {
        match ai_disk_executor::move_file(src, &destination_dir) {
            Ok(MoveOutcome::TargetExists) => {
                any_skip_or_error = true;
                items_json.push(json!({
                    "source": src,
                    "success": false,
                    "skipped_reason": "target_exists",
                    "error": Value::Null,
                }));
            }
            Ok(outcome) => {
                items_json.push(json!({
                    "source": src,
                    "success": true,
                    "outcome": outcome.as_str(),
                    "skipped_reason": Value::Null,
                    "error": Value::Null,
                }));
            }
            Err(e) => {
                any_skip_or_error = true;
                items_json.push(json!({
                    "source": src,
                    "success": false,
                    "skipped_reason": Value::Null,
                    "error": e.to_string(),
                }));
            }
        }
    }
    Ok(json!({
        "mode": "executed",
        "destination_dir": destination_dir,
        "items": items_json,
        "partial_failure": any_skip_or_error,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, String, String) {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src_file.txt");
        std::fs::write(&src, b"payload").unwrap();
        let dst = dir.path().join("dst");
        std::fs::create_dir_all(&dst).unwrap();
        (
            dir,
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        )
    }

    #[test]
    fn test_dry_run_zero_side_effects() {
        let (_guard, src, dst) = setup();
        let res = run(&json!({"sources": [src], "destination_dir": dst})).unwrap();
        assert_eq!(res["mode"], "dry_run");
        assert_eq!(res["items"][0]["would_move"], true);
        assert_eq!(res["items"][0]["size_bytes"], 7);
        assert!(std::path::Path::new(&src).exists(), "预演零副作用");
    }

    #[test]
    fn test_dry_run_marks_target_exists() {
        let (guard, src, dst) = setup();
        let dst_path = std::path::Path::new(&dst);
        std::fs::write(dst_path.join("src_file.txt"), b"conflict").unwrap();
        let res = run(&json!({"sources": [src], "destination_dir": dst})).unwrap();
        assert_eq!(res["items"][0]["skipped_reason"], "target_exists");
        assert_eq!(res["items"][0]["would_move"], false);
        drop(guard);
    }

    #[test]
    fn test_real_move() {
        let (_guard, src, dst) = setup();
        let res = run(&json!({
            "sources": [src],
            "destination_dir": dst,
            "confirm": true
        }))
        .unwrap();
        assert_eq!(res["mode"], "executed");
        assert_eq!(res["items"][0]["success"], true);
        assert_eq!(res["items"][0]["outcome"], "renamed"); // 同卷临时目录
        assert!(!std::path::Path::new(&src).exists());
        assert!(std::path::Path::new(&dst).join("src_file.txt").exists());
    }

    #[test]
    fn test_dest_must_be_dir() {
        let (_guard, src, dst) = setup();
        let err = run(&json!({
            "sources": [src],
            "destination_dir": format!("{}\\not_exist", dst),
            "confirm": true
        }))
        .unwrap_err();
        assert!(err.contains("目标目录"));
    }
}
