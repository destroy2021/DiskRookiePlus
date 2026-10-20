/// MFT 枚举出的单条文件系统记录（不建树，供流式消费）。
///
/// 与 `FileNode` 的区别：无 children/name，最小化百万级记录的内存开销；
/// 供 `disk-scanner` 的 MFT 记录枚举入口输出、`mcp-server` 的名称搜索等消费。
#[derive(Debug, Clone)]
pub struct MftRecordEntry {
    /// 完整路径（如 `C:\Users\x\file.txt`）
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Unix 时间戳（秒），最近修改时间
    pub modified: Option<u64>,
}
