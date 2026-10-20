//! `disk_list_dir`：枚举目录直接子项（分页，"进入目录"即反复调用下钻）。
//!
//! 子目录大小不在此计算（毫秒级响应），大小分析用 `disk_du`（职责分离）。

use std::path::Path;

use serde_json::{json, Value};

use super::{checked_path, ToolResult};
use crate::path_util::{opt_bool, opt_str, opt_u64};

const DEFAULT_LIMIT: u64 = 200;
const MAX_LIMIT: u64 = 1000;

pub fn run(args: &Value) -> ToolResult {
    let raw_path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少必填参数 path".to_string())?;
    let path = checked_path(raw_path)?;
    let offset = opt_u64(args, "offset")?.unwrap_or(0);
    let limit = opt_u64(args, "limit")?
        .unwrap_or(DEFAULT_LIMIT)
        .clamp(1, MAX_LIMIT);
    let sort = opt_str(args, "sort").unwrap_or_else(|| "size".to_string());
    let show_hidden = opt_bool(args, "show_hidden", true);

    if !path.is_dir() {
        return Err(format!("路径不存在或不是目录: {}", path.display()));
    }

    // 收集直接子项（不递归）；读取失败的子项跳过
    let mut entries: Vec<(String, u64, bool, Option<u64>)> = Vec::new(); // (name, size, is_dir, modified)
    for entry in std::fs::read_dir(&path)
        .map_err(|e| super::map_io_err(&e))?
        .filter_map(|e| e.ok())
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if !show_hidden && is_hidden(&entry.path()) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        entries.push((name, meta.len(), meta.is_dir(), modified));
    }

    // 排序：size 降序 / name 字典序 / modified 降序；目录与文件混合按同一键
    match sort.as_str() {
        "name" => entries.sort_by(|a, b| a.0.cmp(&b.0)),
        "modified" => entries.sort_by(|a, b| b.3.cmp(&a.3)),
        _ => entries.sort_by(|a, b| b.1.cmp(&a.1)), // 默认 size 降序
    }

    let total_matched = entries.len() as u64;
    let truncated = offset + limit < total_matched;
    let next_offset = if truncated {
        Some(offset + limit)
    } else {
        None
    };
    let items: Vec<Value> = entries
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|(name, size, is_dir, modified)| {
            let full = Path::new(&path).join(&name);
            json!({
                "path": full.display().to_string(),
                "name": name,
                "size": size,
                "is_dir": is_dir,
                "modified": modified,
            })
        })
        .collect();

    Ok(json!({
        "path": path.display().to_string(),
        "entries": items,
        "total_matched": total_matched,
        "truncated": truncated,
        "next_offset": next_offset,
    }))
}

/// 简易隐藏判定：Windows 属性或 `.` 前缀（Unix）
fn is_hidden(p: &Path) -> bool {
    #[cfg(windows)]
    {
        let _ = p;
        false // Windows 隐藏属性需 Win32 API；`.` 前缀判定对 Windows 无意义，默认不隐藏
    }
    #[cfg(not(windows))]
    {
        p.file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_dir_paginates() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            std::fs::write(
                dir.path().join(format!("f{i}.txt")),
                vec![0u8; (5 - i) * 10],
            )
            .unwrap();
        }
        let args = json!({"path": dir.path().to_string_lossy(), "limit": 2, "sort": "size"});
        let res = run(&args).unwrap();
        assert_eq!(res["total_matched"], 5);
        assert_eq!(res["entries"].as_array().unwrap().len(), 2);
        assert_eq!(res["truncated"], true);
        assert_eq!(res["next_offset"], 2);
        // size 降序：第一条是最大的 f0
        assert_eq!(res["entries"][0]["name"], "f0.txt");

        // 第二页
        let args2 =
            json!({"path": dir.path().to_string_lossy(), "offset": 2, "limit": 2, "sort": "size"});
        let res2 = run(&args2).unwrap();
        assert_eq!(res2["entries"][0]["name"], "f2.txt");
    }

    #[test]
    fn test_list_dir_not_a_dir() {
        let err = run(&json!({"path": "Z:\\no_such_dir_xyz"})).unwrap_err();
        assert!(err.contains("不存在"));
    }
}
