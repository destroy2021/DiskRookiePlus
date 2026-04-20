use chrono::Local;
use fern::Dispatch;
use log::LevelFilter;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

static LOGGER_INIT: OnceLock<()> = OnceLock::new();

pub fn init_app_logging(app: &AppHandle) -> Result<PathBuf, String> {
    if LOGGER_INIT.get().is_some() {
        return Ok(resolve_log_root(app)?);
    }

    let log_root = resolve_log_root(app)?;
    fs::create_dir_all(&log_root).map_err(|e| format!("创建日志目录失败: {e}"))?;

    let now = Local::now();
    let day_dir = log_root.join(now.format("%Y-%m-%d").to_string());
    fs::create_dir_all(&day_dir).map_err(|e| format!("创建日期日志目录失败: {e}"))?;
    let session = now.format("%H%M%S").to_string();

    let all_file = fern::log_file(day_dir.join(format!("all-{session}.log")))
        .map_err(|e| format!("创建 all 日志文件失败: {e}"))?;
    let info_file = fern::log_file(day_dir.join(format!("info-{session}.log")))
        .map_err(|e| format!("创建 info 日志文件失败: {e}"))?;
    let warn_file = fern::log_file(day_dir.join(format!("warn-{session}.log")))
        .map_err(|e| format!("创建 warn 日志文件失败: {e}"))?;
    let error_file = fern::log_file(day_dir.join(format!("error-{session}.log")))
        .map_err(|e| format!("创建 error 日志文件失败: {e}"))?;
    let debug_file = fern::log_file(day_dir.join(format!("debug-{session}.log")))
        .map_err(|e| format!("创建 debug 日志文件失败: {e}"))?;

    Dispatch::new()
        .level(LevelFilter::Info)
        .level_for("tao", LevelFilter::Error)
        .level_for("winit", LevelFilter::Error)
        .chain(
            Dispatch::new()
                .format(format_log_line)
                .chain(std::io::stdout())
                .chain(all_file),
        )
        .chain(
            Dispatch::new()
                .level(LevelFilter::Info)
                .filter(|meta| meta.level() == log::Level::Info)
                .format(format_log_line)
                .chain(info_file),
        )
        .chain(
            Dispatch::new()
                .level(LevelFilter::Warn)
                .filter(|meta| meta.level() == log::Level::Warn)
                .format(format_log_line)
                .chain(warn_file),
        )
        .chain(
            Dispatch::new()
                .level(LevelFilter::Error)
                .filter(|meta| meta.level() == log::Level::Error)
                .format(format_log_line)
                .chain(error_file),
        )
        .chain(
            Dispatch::new()
                .level(LevelFilter::Debug)
                .filter(|meta| meta.level() == log::Level::Debug)
                .format(format_log_line)
                .chain(debug_file),
        )
        .apply()
        .map_err(|e| format!("初始化日志系统失败: {e}"))?;

    let _ = LOGGER_INIT.set(());
    log::info!("日志系统初始化完成，日志目录: {}", log_root.display());
    Ok(log_root)
}

fn resolve_log_root(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("无法获取用户目录: {e}"))?;
    Ok(home.join(".disk-rookie").join("logs"))
}

fn format_log_line(
    out: fern::FormatCallback<'_>,
    message: &std::fmt::Arguments<'_>,
    record: &log::Record<'_>,
) {
    let file = record.file().unwrap_or("unknown");
    let file_name = Path::new(file)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or(file);
    let line = record.line().unwrap_or(0);
    out.finish(format_args!(
        "[{}][{}][{}:{}] {}",
        Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        record.level(),
        file_name,
        line,
        message
    ));
}
