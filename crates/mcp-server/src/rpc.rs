//! 最小 JSON-RPC 2.0 stdio 循环 + MCP 协议层。
//!
//! 选型依据（设计文档 2.3 节）：rmcp 会传递依赖 tokio 全家桶（async runtime、transport 等），
//! 而本 server 只需 initialize / tools/list / tools/call 三个方法且工具层是同步 IO，
//! 手写约 150 行循环依赖更少、与 executor 同步模型一致，故选手写。
//!
//! 协议细节：
//! - MCP 协议版本 "2024-11-05"（Claude Desktop 等客户端当前接受的标准版本）；
//! - 请求按行读取（Content-Length 分帧为 SSE/HTTP transport 语义，stdio 用行分帧）；
//! - `notifications/initialized` 等通知（无 id）静默忽略；
//! - 工具执行错误 → `result.isError: true` + text content（MCP 语义：工具业务错误不占用
//!   JSON-RPC error 通道，协议层 error 仅用于 unknown method / malformed request）。

use std::io::{BufRead, Write};

use serde_json::{json, Value};

use crate::tools;

const PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "diskrookie-mcp";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 运行 stdio JSON-RPC 主循环，stdin 关闭即退出。
pub fn run() -> Result<(), String> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = stdin.lock();
    let mut out = stdout.lock();

    let mut line = String::new();
    loop {
        line.clear();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| format!("read stdin: {e}"))?;
        if n == 0 {
            return Ok(()); // EOF：客户端关闭
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                write_response(
                    &mut out,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": Value::Null,
                        "error": {"code": -32700, "message": format!("parse error: {e}")}
                    }),
                )?;
                continue;
            }
        };

        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(Value::Null);

        // 通知（无 id）不回包
        let Some(id) = id else {
            continue;
        };

        let result = match method {
            "initialize" => Some(handle_initialize(&params)),
            "ping" => Some(json!({})),
            "tools/list" => Some(handle_tools_list(&params)),
            "tools/call" => Some(handle_tools_call(&params)),
            _ => None,
        };

        match result {
            Some(res) => {
                write_response(
                    &mut out,
                    &json!({"jsonrpc": "2.0", "id": id, "result": res}),
                )?;
            }
            None => {
                write_response(
                    &mut out,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {"code": -32601, "message": format!("method not found: {method}")}
                    }),
                )?;
            }
        }
    }
}

fn write_response(out: &mut std::io::StdoutLock, v: &Value) -> Result<(), String> {
    serde_json::to_writer(&mut *out, &v).map_err(|e| format!("serialize: {e}"))?;
    out.write_all(b"\n")
        .map_err(|e| format!("write stdout: {e}"))?;
    out.flush().map_err(|e| format!("flush stdout: {e}"))
}

fn handle_initialize(_params: &Value) -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": SERVER_NAME,
            "version": SERVER_VERSION
        }
    })
}

fn handle_tools_list(_params: &Value) -> Value {
    json!({
        "tools": tools::tool_definitions()
    })
}

fn handle_tools_call(params: &Value) -> Value {
    let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let (content_text, is_error) = match tools::dispatch(name, &args) {
        Ok(v) => (v.to_string(), false),
        Err(e) => (e, true),
    };
    json!({
        "content": [{"type": "text", "text": content_text}],
        "isError": is_error
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize_result() {
        let res = handle_initialize(&json!({}));
        assert_eq!(res["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(res["serverInfo"]["name"], SERVER_NAME);
        assert!(res["capabilities"]["tools"].is_object());
    }

    #[test]
    fn test_tools_list_contains_all_8() {
        let res = handle_tools_list(&json!({}));
        let names: Vec<&str> = res["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        for expected in [
            "disk_list_drives",
            "disk_scan_cleanable",
            "disk_list_dir",
            "disk_du",
            "disk_search_name",
            "disk_read_text",
            "disk_delete",
            "disk_move",
        ] {
            assert!(names.contains(&expected), "missing tool {expected}");
        }
    }
}
