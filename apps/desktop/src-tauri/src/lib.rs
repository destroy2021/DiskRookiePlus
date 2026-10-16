mod commands;
mod logging;
mod panic_hook;

use commands::oauth::OAuthState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    panic_hook::install_broken_pipe_safe_panic_hook();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            if let Err(err) = logging::init_app_logging(app.handle()) {
                eprintln!("日志系统初始化失败: {err}");
            }
            Ok(())
        })
        .manage(commands::scan::ScanCancelRegistry::default())
        .manage(OAuthState::default())
        .invoke_handler(tauri::generate_handler![
            commands::scan::scan_path_command,
            commands::scan::cancel_scan_command,
            commands::analyze::analyze_disk,
            commands::plan::get_cleanup_plan,
            commands::execute::execute_plan,
            commands::permission::check_admin_permission,
            commands::delete::delete_item,
            commands::delete::trash_item,
            commands::storage::read_storage_file,
            commands::storage::write_storage_file,
            commands::storage::delete_storage_file,
            commands::storage::list_storage_files,
            commands::storage::get_storage_path,
            // OAuth commands
            commands::oauth::complete_google_oauth,
            commands::oauth::refresh_google_token,
            commands::oauth::revoke_google_token,
            commands::oauth::get_google_user_info,
            commands::oauth::get_google_drive_quota,
            // Baidu Netdisk OAuth commands
            commands::oauth::complete_baidu_oauth,
            commands::oauth::refresh_baidu_token,
            commands::oauth::revoke_baidu_token,
            commands::oauth::get_baidu_user_info,
            commands::oauth::get_baidu_netdisk_quota,
            // Aliyun Drive OAuth commands
            commands::oauth::complete_aliyun_oauth,
            commands::oauth::refresh_aliyun_token,
            commands::oauth::revoke_aliyun_token,
            commands::oauth::get_aliyun_user_info,
            commands::oauth::get_aliyun_drive_quota,
            // Dropbox OAuth commands
            commands::oauth::complete_dropbox_oauth,
            commands::oauth::refresh_dropbox_token,
            commands::oauth::revoke_dropbox_token,
            commands::oauth::get_dropbox_user_info,
            commands::oauth::get_dropbox_quota,
            // Cloud upload commands
            commands::cloud_upload::upload_to_cloud,
            commands::open_in_file_manager::open_in_file_manager,
            commands::kimi_oauth::kimi_code_request_device,
            commands::kimi_oauth::kimi_code_poll_token,
            commands::logging::log_frontend_event,
            commands::drill_down::scan_directory_top_n_command,
            commands::list_directory::list_directory_command,
            commands::list_directory::get_directory_size_command,
            commands::list_directory::get_file_info_command,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            log::error!("Tauri 应用运行失败: {err}");
            eprintln!("Tauri 应用运行失败: {err}");
        });
}
