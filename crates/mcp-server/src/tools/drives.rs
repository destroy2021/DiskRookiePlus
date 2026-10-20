//! `disk_list_drives`：枚举所有盘符及容量（无参数）。
//!
//! 锚点：盘符遍历 `A`..`Z` 判 `Path::exists() && is_dir()`（不引入新依赖）；
//! 容量获取复用 `ai-disk-scanner` 的 `get_volume_space_bytes`（仅 Windows，
//! 其余平台返回 null 字段，红线 7 跨平台回退）。

use serde_json::{json, Value};

use super::ToolResult;

pub fn run() -> ToolResult {
    let mut drives = Vec::new();
    for c in b'A'..=b'Z' {
        let root = format!("{}:\\", c as char);
        let p = std::path::Path::new(&root);
        if p.exists() && p.is_dir() {
            // get_volume_space_bytes 仅在 Windows 返回 Some（scanner 内部 cfg 切换）
            #[cfg(windows)]
            let (total, free) = ai_disk_scanner::get_volume_space_bytes(&root)
                .map(|(t, f)| (json!(t), json!(f)))
                .unwrap_or((Value::Null, Value::Null));
            #[cfg(not(windows))]
            let (total, free) = (Value::Null, Value::Null);
            drives.push(json!({
                "path": root,
                "total_bytes": total,
                "free_bytes": free,
            }));
        }
    }
    Ok(json!({ "drives": drives }))
}

#[cfg(windows)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_drives_returns_c() {
        // Windows 测试机必有 C 盘
        let v = run().unwrap();
        let drives = v["drives"].as_array().unwrap();
        assert!(drives.iter().any(|d| d["path"] == "C:\\"));
    }
}
