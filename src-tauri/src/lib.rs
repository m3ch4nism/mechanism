#[tauri::command]
fn get_exe_dir() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("no parent dir")?.to_string_lossy().to_string();
    let clean = if dir.starts_with("\\\\?\\") { dir[4..].to_string() } else { dir };
    Ok(clean.replace('\\', "/"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_exe_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
