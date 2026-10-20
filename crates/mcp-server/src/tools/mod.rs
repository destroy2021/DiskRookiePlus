//! 工具层：8 个 MCP 工具的业务实现（每工具一模块）+ 注册表。
//!
//! 通用约定（设计文档 3 节）：
//! - 路径参数统一经 [`crate::path_util::validate_path`] 校验；
//! - 错误统一 `DiskAnalyzerError` → 消息字符串（MCP isError），不存在路径 → `InvalidPath`；
//! - 枚举/搜索类输出带 `truncated: bool` 与 `next_offset: u64|null`；
//! - 执行类工具（delete/move）的确认两步协议写入 description，由调用方 AI 遵守。

#[cfg(windows)]
pub mod categories;
pub mod delete;
pub mod drives;
pub mod du;
pub mod list_dir;
pub mod move_file;
pub mod read_text;
pub mod scan_cleanable;
pub mod search_name;

use serde_json::{json, Value};

use crate::path_util;

/// 工具结果：Ok 为可 JSON 化的结果（text content）；Err 为业务错误消息（isError）
pub type ToolResult = Result<Value, String>;

pub(crate) fn map_io_err(e: &std::io::Error) -> String {
    format!("IO error: {e}")
}

/// 单个工具的静态定义（name / description / inputSchema）
struct ToolDef {
    name: &'static str,
    description: &'static str,
    schema: Value,
}

fn schema(props: &Value, required: &[&str]) -> Value {
    let required: Vec<&str> = required.to_vec();
    json!({
        "type": "object",
        "properties": props,
        "required": required
    })
}

fn str_prop(desc: &str) -> Value {
    json!({"type": "string", "description": desc})
}

fn bool_prop(desc: &str) -> Value {
    json!({"type": "boolean", "description": desc})
}

fn u64_prop(desc: &str) -> Value {
    json!({"type": "integer", "description": desc, "minimum": 0})
}

fn arr_str_prop(desc: &str) -> Value {
    json!({"type": "array", "items": {"type": "string"}, "description": desc})
}

/// 8 个工具定义（顺序即 tools/list 输出顺序）
fn definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "disk_list_drives",
            description: "列出本机所有盘符及容量/剩余空间（无参数）。清理工作流第一步：盘点各盘，锁定目标。",
            schema: schema(&json!({}), &[]),
        },
        ToolDef {
            name: "disk_scan_cleanable",
            description: "扫描全盘（或指定盘）的可清理内容地图：按内置类别（浏览器缓存/临时文件/回收站/包管理器缓存/缩略图/崩溃转储/Windows 更新残留/旧下载）聚合大小与文件数，一次调用给出全部清理候选。这是磁盘清理的起点工具。输入：drives（可选，默认全部本地盘）、categories（可选，类别 id 过滤）。",
            schema: schema(
                &json!({
                    "drives": arr_str_prop("要扫描的盘符列表（如 [\"C:\\\"]），缺省为所有本地盘"),
                    "categories": arr_str_prop("类别 id 过滤（如 [\"browser_cache\"]），缺省为全部类别")
                }),
                &[],
            ),
        },
        ToolDef {
            name: "disk_list_dir",
            description: "枚举目录的直接子项（分页）。\"进入目录\"即反复调用本工具下钻；子目录大小不在此计算（毫秒级响应），大小分析用 disk_du。",
            schema: schema(
                &json!({
                    "path": str_prop("目录绝对路径"),
                    "offset": u64_prop("分页偏移，默认 0"),
                    "limit": u64_prop("每页条数，默认 200，最大 1000"),
                    "sort": json!({"type": "string", "enum": ["size", "name", "modified"], "description": "排序键，默认 size 降序"}),
                    "show_hidden": bool_prop("是否包含隐藏项，默认 true")
                }),
                &["path"],
            ),
        },
        ToolDef {
            name: "disk_du",
            description: "目录占用分析：各子项按大小排名，清理场景的\"大户挖掘\"。直接回答\"这个目录里什么占地方\"。",
            schema: schema(
                &json!({
                    "path": str_prop("目录绝对路径"),
                    "depth": u64_prop("下钻深度，默认 1，最大 5"),
                    "shallow_dirs": bool_prop("node_modules/.git 等常见缓存目录只计大小不递归展开（与主应用一致），默认 true"),
                    "top_n": u64_prop("返回前 N 项，默认 50，最大 200"),
                    "min_size_bytes": u64_prop("只返回大于等于该大小的项，默认 0")
                }),
                &["path"],
            ),
        },
        ToolDef {
            name: "disk_search_name",
            description: "高性能文件名搜索：fuzzy（子串）/ glob / regex 三种模式。卷根走 MFT 引擎（需管理员，秒级完成全卷匹配），否则回退并行目录 walk（engine 字段如实告知）。",
            schema: schema(
                &json!({
                    "root": str_prop("搜索起始目录（绝对路径）"),
                    "pattern": str_prop("搜索模式"),
                    "mode": json!({"type": "string", "enum": ["fuzzy", "glob", "regex"], "description": "匹配模式，默认 fuzzy"}),
                    "case_sensitive": bool_prop("大小写敏感，默认 false"),
                    "is_dir": bool_prop("null=全部 / true=仅目录 / false=仅文件，默认 null"),
                    "offset": u64_prop("跳过前 N 条命中，默认 0"),
                    "limit": u64_prop("返回条数上限，默认 100，最大 1000")
                }),
                &["root", "pattern"],
            ),
        },
        ToolDef {
            name: "disk_read_text",
            description: "读取文本文件内容片段（AI 取证用：看日志/配置/README 判断文件用途）。前 8KB 二进制嗅探，二进制文件拒绝；UTF-8 优先，失败回退 GBK。只读字节范围，不整文件载入。",
            schema: schema(
                &json!({
                    "path": str_prop("文件绝对路径"),
                    "offset_bytes": u64_prop("起始字节偏移，默认 0"),
                    "max_bytes": u64_prop("最多读取字节数，默认 65536，最大 262144")
                }),
                &["path"],
            ),
        },
        ToolDef {
            name: "disk_delete",
            description: "删除文件/目录（目录递归删除）。⚠️ 确认两步协议：confirm=false（默认）仅预演，返回将被删除的路径与大小，零文件系统修改；confirm=true 真实执行。正确用法：先预演 → 向用户展示结果 → 用户明确同意 → confirm=true 执行。系统关键目录在黑名单内被拒绝（C:\\Windows\\Temp 等清理安全例外除外）。",
            schema: schema(
                &json!({
                    "paths": arr_str_prop("待删除路径列表（1..=50 项；缓存目录可直接传目录）"),
                    "confirm": bool_prop("false=仅预演（默认）；true=真实执行（必须已有用户同意）")
                }),
                &["paths"],
            ),
        },
        ToolDef {
            name: "disk_move",
            description: "把文件/目录移动到另一目录（本地迁移：同卷 rename 快路径，跨卷先复制后删除）。⚠️ 确认两步协议同 disk_delete：confirm=false 预演，confirm=true 执行。目标同名冲突跳过并标记 target_exists。",
            schema: schema(
                &json!({
                    "sources": arr_str_prop("待移动路径列表（1..=50 项）"),
                    "destination_dir": str_prop("目标目录（必须已存在）"),
                    "confirm": bool_prop("false=仅预演（默认）；true=真实执行（必须已有用户同意）")
                }),
                &["sources", "destination_dir"],
            ),
        },
    ]
}

/// tools/list 输出
pub fn tool_definitions() -> Vec<Value> {
    definitions()
        .into_iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": t.schema
            })
        })
        .collect()
}

/// tools/call 分发
pub fn dispatch(name: &str, args: &Value) -> ToolResult {
    match name {
        "disk_list_drives" => drives::run(),
        "disk_scan_cleanable" => scan_cleanable::run(args),
        "disk_list_dir" => list_dir::run(args),
        "disk_du" => du::run(args),
        "disk_search_name" => search_name::run(args),
        "disk_read_text" => read_text::run(args),
        "disk_delete" => delete::run(args),
        "disk_move" => move_file::run(args),
        _ => Err(format!("unknown tool: {name}")),
    }
}

/// `DiskAnalyzerError` → 工具错误消息
pub(crate) fn map_err(e: &ai_disk_common::DiskAnalyzerError) -> String {
    e.to_string()
}

/// 校验路径并返回 PathBuf（工具入口公共包装）
pub(crate) fn checked_path(raw: &str) -> Result<std::path::PathBuf, String> {
    path_util::validate_path(raw).map_err(|e| map_err(&e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dispatch_unknown() {
        assert!(dispatch("nope", &json!({})).is_err());
    }

    #[test]
    fn test_dispatch_missing_args() {
        // 必填参数缺失 → 业务错误
        let r = dispatch("disk_list_dir", &json!({}));
        assert!(r.is_err());
    }
}
