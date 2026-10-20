//! diskrookie-mcp：DiskRookie MCP server（stdio transport）。
//!
//! 模块结构（协议层与业务解耦）：
//! - [`rpc`]：最小 JSON-RPC 2.0 stdio 循环 + MCP initialize 握手 + tools/list + tools/call 分发；
//! - [`tools`]：8 个工具的业务实现，每工具一模块；
//! - [`tools::categories`]：内置清理类别规则表（独立模块）；
//! - [`path_util`]：server 端统一路径规范化与校验。
//!
//! 红线：本 crate 零 unsafe；破坏性操作唯一入口 [`ai_disk_executor`]；
//! 所有枚举/搜索输出带 `truncated`/`next_offset`，禁止无界缓存（AGENTS.md 红线 4）。

mod path_util;
mod rpc;
mod tools;

fn main() {
    if let Err(e) = rpc::run() {
        eprintln!("diskrookie-mcp fatal: {e}");
        std::process::exit(1);
    }
}
