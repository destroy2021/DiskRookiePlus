#[tauri::command]
pub fn log_frontend_event(level: String, message: String, context: Option<String>) {
    let payload = match context {
        Some(ctx) if !ctx.trim().is_empty() => format!("{message} | {ctx}"),
        _ => message,
    };

    match level.to_ascii_lowercase().as_str() {
        "error" => log::error!(target: "frontend", "{payload}"),
        "warn" | "warning" => log::warn!(target: "frontend", "{payload}"),
        "debug" => log::debug!(target: "frontend", "{payload}"),
        _ => log::info!(target: "frontend", "{payload}"),
    }
}
