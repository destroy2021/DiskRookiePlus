//! executor：所有破坏性文件操作（删除/移动）的唯一入口（AGENTS.md 红线 1）。
//!
//! 安全模型：
//! - [`forbidden::FORBIDDEN_PATHS`] + [`forbidden::CLEAN_SAFE_EXCEPTIONS`] 单一定义于此，
//!   `src-tauri` 与 `mcp-server` 共同引用；
//! - 所有写操作先经 [`forbidden::canonicalize_for_write`] 校验；
//! - 预演（[`dry_run`]）与执行（[`delete`]/[`move`]）分离，调用方实现"预演 → 用户确认 → 执行"协议。

pub mod delete;
pub mod dry_run;
pub mod forbidden;
pub mod r#move;

pub use delete::*;
pub use dry_run::*;
pub use forbidden::*;
pub use r#move::*;
