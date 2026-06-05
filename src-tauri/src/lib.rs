// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod android_signer;
mod media_session;

#[cfg(desktop)]
use tauri::Manager;

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
fn log_js(message: String) {
    eprintln!("[js] {}", message);
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

/// Applies an OS-level translucency effect to the main window. On Windows the
/// window is left as a plain transparent window (no Acrylic) because Acrylic
/// renders as a flat opaque-looking surface here; the translucent CSS surfaces
/// let the desktop show through directly. macOS still gets native Vibrancy.
#[cfg(desktop)]
fn apply_window_effects<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
        if let Err(error) = apply_vibrancy(
            window,
            NSVisualEffectMaterial::HudWindow,
            None,
            None,
        ) {
            eprintln!("failed to apply vibrancy window effect: {error}");
        }
    }

    // Silence unused-variable warnings on platforms without a vibrancy backend
    // (Windows now relies purely on the transparent window + CSS surfaces).
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_rustls_crypto_provider();

    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(android_signer::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(media_session::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                if let Err(error) = app.deep_link().register_all() {
                    eprintln!("failed to register deep link schemes: {error}");
                }
            }

            #[cfg(desktop)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    apply_window_effects(&window);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, log_js, desktop_update_context])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
