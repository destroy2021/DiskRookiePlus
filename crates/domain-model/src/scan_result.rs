use serde::{Deserialize, Serialize};

use crate::FileNode;
use crate::TopFileEntry;

/// 目录/文件聚合摘要条目
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SummaryEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dir_count: Option<u64>,
    pub is_dir: bool,
}

/// 按扩展名聚合统计
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExtensionStat {
    pub ext: String,
    pub size: u64,
    pub count: u64,
}

/// 扫描结果，包含树结构与各项指标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub root: FileNode,
    pub scan_time_ms: u64,
    pub file_count: u64,
    /// 本次扫描到的文件总大小（非卷容量）
    pub total_size: u64,
    /// 当 MFT 扫描失败（如 I/O 错误）并回退到普通扫描时，在此标注错误信息，前端可提示「此磁盘的扫描有错误」
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan_warning: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub interrupted: bool,
    /// 卷总容量（字节），由操作系统 API 获取，仅 Windows 卷根扫描时可能为 Some
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume_total_bytes: Option<u64>,
    /// 卷剩余可用空间（字节），由 GetDiskFreeSpaceEx 获取
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume_free_bytes: Option<u64>,
    /// 按大小排序的前 N 个文件（MFT 扫描时填充），供前端摘要与 AI 分析使用，避免遍历整棵树
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_files: Option<Vec<TopFileEntry>>,
    /// 按总占用排序的目录列表（为空时不序列化）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub top_directories: Vec<SummaryEntry>,
    /// 根目录下一层子项（为空时不序列化）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub root_children: Vec<SummaryEntry>,
    /// 扩展名聚合统计（为空时不序列化）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extension_stats: Vec<ExtensionStat>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_root() -> FileNode {
        FileNode {
            path: "C:\\".to_string(),
            name: "C:\\".to_string(),
            size: 0,
            is_dir: true,
            modified: None,
            children: vec![],
        }
    }

    #[test]
    fn deserialize_legacy_payload_defaults_new_fields() {
        let payload = serde_json::json!({
            "root": {
                "path": "C:\\",
                "name": "C:\\",
                "size": 123,
                "is_dir": true,
                "children": []
            },
            "scan_time_ms": 10,
            "file_count": 2,
            "total_size": 123,
            "top_files": []
        });

        let parsed: ScanResult = serde_json::from_value(payload).expect("legacy payload parses");
        assert!(parsed.top_directories.is_empty());
        assert!(parsed.root_children.is_empty());
        assert!(parsed.extension_stats.is_empty());
        assert!(!parsed.interrupted);
    }

    #[test]
    fn serialize_empty_summary_fields_are_omitted() {
        let result = ScanResult {
            root: sample_root(),
            scan_time_ms: 1,
            file_count: 0,
            total_size: 0,
            scan_warning: None,
            interrupted: false,
            volume_total_bytes: None,
            volume_free_bytes: None,
            top_files: None,
            top_directories: vec![],
            root_children: vec![],
            extension_stats: vec![],
        };

        let value = serde_json::to_value(result).expect("serialize scan result");
        assert!(value.get("top_directories").is_none());
        assert!(value.get("root_children").is_none());
        assert!(value.get("extension_stats").is_none());
    }

    #[test]
    fn deserialize_new_summary_fields() {
        let payload = serde_json::json!({
            "root": {
                "path": "C:\\",
                "name": "C:\\",
                "size": 1000,
                "is_dir": true,
                "children": []
            },
            "scan_time_ms": 10,
            "file_count": 3,
            "total_size": 1000,
            "top_directories": [
                {
                    "path": "C:\\Users",
                    "name": "Users",
                    "size": 600,
                    "file_count": 10,
                    "is_dir": true
                }
            ],
            "root_children": [
                {
                    "path": "C:\\Users",
                    "name": "Users",
                    "size": 600,
                    "is_dir": true
                }
            ],
            "extension_stats": [
                {
                    "ext": ".log",
                    "size": 200,
                    "count": 3
                }
            ]
        });

        let parsed: ScanResult = serde_json::from_value(payload).expect("new payload parses");
        assert_eq!(parsed.top_directories.len(), 1);
        assert_eq!(parsed.root_children.len(), 1);
        assert_eq!(parsed.extension_stats.len(), 1);
        assert_eq!(parsed.extension_stats[0].ext, ".log");
    }
}
