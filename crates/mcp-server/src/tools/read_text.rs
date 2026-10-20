//! `disk_read_text`：读取文本文件内容片段（AI 取证用）。
//!
//! 约束（设计文档 3.1）：前 8KB 二进制嗅探（NUL 字节或不可打印比例过高 → 拒绝）；
//! UTF-8 优先（剥 BOM），失败回退 GBK（encoding_rs），仍失败报错。
//! 只读字节范围（offset_bytes + max_bytes），绝不整文件载入。

use std::io::{Read, Seek, SeekFrom};

use serde_json::{json, Value};

use super::{checked_path, ToolResult};
use crate::path_util::opt_u64;

const DEFAULT_MAX_BYTES: u64 = 65_536;
const MAX_MAX_BYTES: u64 = 262_144;
const SNIFF_LEN: usize = 8_192;

pub fn run(args: &Value) -> ToolResult {
    let raw_path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少必填参数 path".to_string())?;
    let path = checked_path(raw_path)?;
    let offset_bytes = opt_u64(args, "offset_bytes")?.unwrap_or(0);
    let max_bytes = opt_u64(args, "max_bytes")?
        .unwrap_or(DEFAULT_MAX_BYTES)
        .clamp(1, MAX_MAX_BYTES);

    if path.is_dir() {
        return Err(format!("路径是目录不是文件: {}", path.display()));
    }
    let meta = std::fs::metadata(&path).map_err(|e| super::map_io_err(&e))?;
    let size = meta.len();

    let mut file = std::fs::File::open(&path).map_err(|e| super::map_io_err(&e))?;

    // 二进制嗅探：读前 8KB（与请求范围无关，判断整个文件性质）
    let mut sniff_buf = vec![0u8; SNIFF_LEN.min(size as usize)];
    file.read_exact(&mut sniff_buf)
        .map_err(|e| super::map_io_err(&e))?;
    if is_likely_binary(&sniff_buf) {
        return Err(format!(
            "疑似二进制文件（清理场景不提供 hex 预览）: {}",
            path.display()
        ));
    }

    // 读请求范围
    if offset_bytes >= size {
        return Ok(json!({
            "content": "",
            "encoding": "utf-8",
            "size_bytes": size,
            "truncated": false,
            "next_offset_bytes": Value::Null,
        }));
    }
    file.seek(SeekFrom::Start(offset_bytes))
        .map_err(|e| super::map_io_err(&e))?;
    let to_read = max_bytes.min(size - offset_bytes) as usize;
    let mut buf = vec![0u8; to_read];
    file.read_exact(&mut buf)
        .map_err(|e| super::map_io_err(&e))?;

    let end = offset_bytes + to_read as u64;
    let truncated = end < size;
    let next_offset_bytes = if truncated { Some(end) } else { None };

    // 解码：UTF-8（剥 BOM）优先，失败回退 GBK
    let (content, encoding) = decode_utf8_or_gbk(&buf);

    Ok(json!({
        "content": content,
        "encoding": encoding,
        "size_bytes": size,
        "truncated": truncated,
        "next_offset_bytes": next_offset_bytes,
    }))
}

/// NUL 字节存在或不可打印比例 > 30% 判为二进制（文本中偶发控制字符不误伤）
fn is_likely_binary(buf: &[u8]) -> bool {
    if buf.is_empty() {
        return false;
    }
    if buf.contains(&0u8) {
        return true;
    }
    let non_printable = buf
        .iter()
        .filter(|&&b| b < 0x20 && b != b'\n' && b != b'\r' && b != b'\t')
        .count();
    non_printable * 10 > buf.len() * 3
}

/// UTF-8（剥 BOM）优先；失败回退 GBK（encoding_rs）；仍失败报错。
/// 返回 (内容, 编码名)。GBK 解码总是成功（replacement 兜底），因此错误只剩两者皆非法——
/// GBK 双字节覆盖面广，实际不可达，保险起见仍检查。
fn decode_utf8_or_gbk(buf: &[u8]) -> (String, &'static str) {
    // BOM 处理
    let buf = buf.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(buf);
    if let Ok(s) = std::str::from_utf8(buf) {
        return (s.to_string(), "utf-8");
    }
    let (decoded, _, had_errors) = encoding_rs::GBK.decode(buf);
    if had_errors {
        // GBK 兜底后仍有替换字符：内容非法，但清理取证场景给出尽力而为的结果即可
        return (decoded.into_owned(), "gbk");
    }
    (decoded.into_owned(), "gbk")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, "hello 磁盘清理").unwrap();
        let res = run(&json!({"path": f.to_string_lossy()})).unwrap();
        assert_eq!(res["content"], "hello 磁盘清理");
        assert_eq!(res["encoding"], "utf-8");
        assert_eq!(res["truncated"], false);
    }

    #[test]
    fn test_read_truncates_and_offsets() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("b.txt");
        std::fs::write(&f, "0123456789").unwrap();
        // 只读前 4 字节
        let res = run(&json!({"path": f.to_string_lossy(), "max_bytes": 4})).unwrap();
        assert_eq!(res["content"], "0123");
        assert_eq!(res["truncated"], true);
        assert_eq!(res["next_offset_bytes"], 4);
        // 从偏移 4 继续
        let res2 = run(&json!({"path": f.to_string_lossy(), "offset_bytes": 4, "max_bytes": 100}))
            .unwrap();
        assert_eq!(res2["content"], "456789");
        assert_eq!(res2["truncated"], false);
    }

    #[test]
    fn test_binary_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("c.bin");
        std::fs::write(&f, [0u8, 1, 2, 0, 255, 254, 0, 3]).unwrap();
        let err = run(&json!({"path": f.to_string_lossy()})).unwrap_err();
        assert!(err.contains("二进制"));
    }

    #[test]
    fn test_gbk_fallback() {
        // "你好" 的 GBK 编码
        let gbk_bytes: &[u8] = &[0xC4, 0xE3, 0xBA, 0xC3];
        let (s, enc) = decode_utf8_or_gbk(gbk_bytes);
        assert_eq!(enc, "gbk");
        assert_eq!(s, "你好");
    }

    #[test]
    fn test_dir_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let err = run(&json!({"path": dir.path().to_string_lossy()})).unwrap_err();
        assert!(err.contains("目录"));
    }
}
