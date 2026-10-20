//! server 端统一路径处理：规范化、绝对性校验、长度上限（安全模型第 3 条）。

use std::path::PathBuf;

use ai_disk_common::DiskAnalyzerError;

/// 路径长度上限（Windows NTFS 组件上限）
pub const MAX_PATH_LEN: usize = 32_767;

/// 规范化路径（支持正斜杠、去除首尾空白），语义与 scanner 的 normalize_path 一致。
pub fn normalize_path(path: &str) -> PathBuf {
    let s = path.trim();
    #[cfg(windows)]
    let s = s.replace('/', "\\");
    PathBuf::from(s)
}

/// 校验路径参数：非空、绝对路径、长度 ≤ 32767。返回规范化后的 PathBuf。
/// 存在性校验由各工具按需执行（`disk_read_text` 等对不存在路径报 `InvalidPath`）。
pub fn validate_path(raw: &str) -> Result<PathBuf, DiskAnalyzerError> {
    let p = normalize_path(raw);
    let s = p.to_string_lossy();
    if s.is_empty() {
        return Err(DiskAnalyzerError::InvalidPath("路径为空".to_string()));
    }
    if !p.is_absolute() {
        return Err(DiskAnalyzerError::InvalidPath(format!(
            "必须是绝对路径: {}",
            s
        )));
    }
    if s.len() > MAX_PATH_LEN {
        return Err(DiskAnalyzerError::InvalidPath(format!(
            "路径长度超过 {} 上限",
            MAX_PATH_LEN
        )));
    }
    Ok(p)
}

/// 从 JSON 参数取可选 u64（缺省 None；类型错误返回 Err）
pub fn opt_u64(params: &serde_json::Value, key: &str) -> Result<Option<u64>, String> {
    match params.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => n
            .as_i64()
            .map(|v| Some(v.max(0) as u64))
            .ok_or_else(|| format!("参数 {} 必须是整数", key)),
        Some(_) => Err(format!("参数 {} 必须是整数", key)),
    }
}

/// 从 JSON 参数取可选字符串
pub fn opt_str(params: &serde_json::Value, key: &str) -> Option<String> {
    params.get(key).and_then(|v| v.as_str()).map(String::from)
}

/// 从 JSON 参数取可选 bool
pub fn opt_bool(params: &serde_json::Value, key: &str, default: bool) -> bool {
    params.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

/// 从 JSON 参数取可选字符串数组（None 表示缺省）
pub fn opt_str_array(params: &serde_json::Value, key: &str) -> Option<Vec<String>> {
    match params.get(key) {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::Array(arr)) => Some(
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect(),
        ),
        Some(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_path() {
        assert!(validate_path("C:\\Users").is_ok());
        assert!(validate_path("relative/path").is_err());
        assert!(validate_path("").is_err());
        let long = format!("C:\\{}", "a".repeat(40_000));
        assert!(validate_path(&long).is_err());
    }

    #[test]
    fn test_opt_str_array() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"drives":["C:\\","D:\\"],"x":null}"#).unwrap();
        assert_eq!(
            opt_str_array(&v, "drives"),
            Some(vec!["C:\\".to_string(), "D:\\".to_string()])
        );
        assert_eq!(opt_str_array(&v, "x"), None);
        assert_eq!(opt_str_array(&v, "missing"), None);
    }
}
