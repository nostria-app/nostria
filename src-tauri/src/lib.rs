// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod android_signer;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateContext {
    platform: &'static str,
    linux_install_kind: Option<&'static str>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn desktop_update_context() -> DesktopUpdateContext {
    #[cfg(target_os = "linux")]
    {
        let appimage_env = std::env::var_os("APPIMAGE");
        let current_exe = std::env::current_exe().ok();
        let is_appimage = appimage_env.is_some()
            || current_exe
                .as_ref()
                .and_then(|path| path.file_name())
                .and_then(|name| name.to_str())
                .map(|name| name.ends_with(".AppImage"))
                .unwrap_or(false);

        return DesktopUpdateContext {
            platform: "linux",
            linux_install_kind: Some(if is_appimage { "appimage" } else { "system" }),
        };
    }

    #[cfg(target_os = "windows")]
    {
        return DesktopUpdateContext {
            platform: "windows",
            linux_install_kind: None,
        };
    }

    #[cfg(target_os = "macos")]
    {
        return DesktopUpdateContext {
            platform: "macos",
            linux_install_kind: None,
        };
    }

    #[allow(unreachable_code)]
    DesktopUpdateContext {
        platform: "unknown",
        linux_install_kind: None,
    }
}

fn install_rustls_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_rustls_crypto_provider();

    tauri::Builder::default()
        .plugin(android_signer::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![greet, desktop_update_context])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
