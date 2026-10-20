//! `disk_du`：目录占用分析（各子项按大小排名，清理场景的"大户挖掘"）。
//!
//! 锚点：复用 `scan_path_with_progress(path, None, shallow_dirs, use_mft)`，
//! 从 `ScanResult.root` 取指定深度排序截断——不写新遍历器。卷根自动享受 MFT 加速。

use serde_json::{json, Value};

use super::{checked_path, ToolResult};
use crate::path_util::{opt_bool, opt_u64};
use ai_disk_domain::FileNode;

const DEFAULT_TOP_N: u64 = 50;
const MAX_TOP_N: u64 = 200;
const MAX_DEPTH: u64 = 5;

pub fn run(args: &Value) -> ToolResult {
    let raw_path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少必填参数 path".to_string())?;
    let path = checked_path(raw_path)?;
    let depth = opt_u64(args, "depth")?.unwrap_or(1).clamp(1, MAX_DEPTH);
    let shallow_dirs = opt_bool(args, "shallow_dirs", true);
    let top_n = opt_u64(args, "top_n")?
        .unwrap_or(DEFAULT_TOP_N)
        .clamp(1, MAX_TOP_N);
    let min_size = opt_u64(args, "min_size_bytes")?.unwrap_or(0);

    // 复用主应用扫描（use_mft=true：卷根自动 MFT，否则 walk）
    let (result, _used_mft) = ai_disk_scanner::scan_path_with_progress(
        &path.display().to_string(),
        None,
        shallow_dirs,
        true,
    )
    .map_err(|e| super::map_err(&e))?;

    // BFS 到指定深度收集 (path, name, size, is_dir)
    let mut items: Vec<(String, String, u64, bool)> = Vec::new();
    let mut frontier: Vec<&FileNode> = vec![&result.root];
    for _ in 0..depth {
        let mut next: Vec<&FileNode> = Vec::new();
        for node in frontier {
            for child in &node.children {
                items.push((
                    child.path.clone(),
                    child.name.clone(),
                    child.size,
                    child.is_dir,
                ));
                if child.is_dir && !child.children.is_empty() {
                    next.push(child);
                }
            }
        }
        if next.is_empty() {
            break;
        }
        frontier = next;
    }

    // size 降序 + min_size 过滤 + top_n 截断
    items.sort_by(|a, b| b.2.cmp(&a.2));
    let total_before_truncate = items.len();
    items.retain(|(_, _, size, _)| *size >= min_size);
    let truncated = items.len() > top_n as usize;
    items.truncate(top_n as usize);

    let items_json: Vec<Value> = items
        .into_iter()
        .map(|(path, name, size, is_dir)| {
            json!({"path": path, "name": name, "size": size, "is_dir": is_dir})
        })
        .collect();

    Ok(json!({
        "path": result.root.path,
        "total_size": result.total_size,
        "items": items_json,
        "truncated": truncated || (min_size > 0 && items_json.len() < total_before_truncate),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_du_ranks_children() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("big.bin"), vec![0u8; 1000]).unwrap();
        std::fs::write(dir.path().join("small.txt"), b"hi").unwrap();
        let args = json!({"path": dir.path().to_string_lossy(), "top_n": 10});
        let res = run(&args).unwrap();
        assert_eq!(res["total_size"], 1002);
        let items = res["items"].as_array().unwrap();
        assert_eq!(items[0]["name"], "big.bin");
        assert!(items.iter().any(|i| i["name"] == "small.txt"));
    }

    #[test]
    fn test_du_min_size_filter() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("big.bin"), vec![0u8; 1000]).unwrap();
        std::fs::write(dir.path().join("small.txt"), b"hi").unwrap();
        let args = json!({
            "path": dir.path().to_string_lossy(),
            "min_size_bytes": 100
        });
        let res = run(&args).unwrap();
        let items = res["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["name"], "big.bin");
    }
}
