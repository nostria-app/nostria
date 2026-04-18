use std::{
    env,
    fs,
    path::{Path, PathBuf},
};

const ANDROID_SIGNER_COMMANDS: &[&str] = &[
    "is_available",
    "get_public_key",
    "sign_event",
    "nip04_encrypt",
    "nip04_decrypt",
    "nip44_encrypt",
    "nip44_decrypt",
];

const MEDIA_SESSION_COMMANDS: &[&str] = &[
    "initialize",
    "update_state",
    "update_timeline",
    "clear",
];

#[cfg(target_os = "macos")]
const IOS_MEDIA_SESSION_PACKAGE_NAME: &str = "nostria-media-session";

fn main() {
    configure_target_aliases();
    setup_media_session_mobile_sources().expect("failed to wire mobile media-session sources");

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .plugin(
                "android-signer",
                tauri_build::InlinedPlugin::new()
                    .commands(ANDROID_SIGNER_COMMANDS)
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            )
            .plugin(
                "media-session",
                tauri_build::InlinedPlugin::new()
                    .commands(MEDIA_SESSION_COMMANDS)
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            ),
    )
    .expect("failed to run tauri build");
}

fn configure_target_aliases() {
    println!("cargo:rustc-check-cfg=cfg(mobile)");
    println!("cargo:rustc-check-cfg=cfg(desktop)");

    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("missing CARGO_CFG_TARGET_OS");
    if matches!(target_os.as_str(), "android" | "ios") {
        println!("cargo:rustc-cfg=mobile");
    } else {
        println!("cargo:rustc-cfg=desktop");
    }
}

fn setup_media_session_mobile_sources() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let target_os = env::var("CARGO_CFG_TARGET_OS")?;

    match target_os.as_str() {
        "android" => setup_android_sources(&manifest_dir.join("media-session/android"))?,
        "ios" => setup_ios_sources(&manifest_dir.join("media-session/ios"))?,
        _ => {}
    }

    Ok(())
}

fn setup_android_sources(source: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let tauri_library_path = PathBuf::from(
        env::var("DEP_TAURI_ANDROID_LIBRARY_PATH")
            .expect("missing DEP_TAURI_ANDROID_LIBRARY_PATH environment variable"),
    );

    println!("cargo:rerun-if-env-changed=DEP_TAURI_ANDROID_LIBRARY_PATH");
    copy_folder(&tauri_library_path, &source.join(".tauri/tauri-api"), &[])?;
    println!("cargo:android_library_path={}", source.display());
    Ok(())
}

#[cfg(target_os = "macos")]
fn setup_ios_sources(source: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let tauri_library_path = PathBuf::from(
        env::var("DEP_TAURI_IOS_LIBRARY_PATH")
            .expect("missing DEP_TAURI_IOS_LIBRARY_PATH environment variable"),
    );

    println!("cargo:rerun-if-env-changed=DEP_TAURI_IOS_LIBRARY_PATH");

    let tauri_dep_path = source
        .parent()
        .expect("media-session/ios should have a parent directory")
        .join(".tauri/tauri-api");
    copy_folder(&tauri_library_path, &tauri_dep_path, &[".build", "Package.resolved", "Tests"])?;

    tauri_utils::build::link_apple_library(IOS_MEDIA_SESSION_PACKAGE_NAME, source.to_path_buf());

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn setup_ios_sources(_source: &Path) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

fn copy_folder(
    source: &Path,
    target: &Path,
    ignore_paths: &[&str],
) -> Result<(), Box<dyn std::error::Error>> {
    if target.exists() {
        fs::remove_dir_all(target)?;
    }

    copy_folder_recursive(source, source, target, ignore_paths)?;
    Ok(())
}

fn copy_folder_recursive(
    root: &Path,
    current: &Path,
    target_root: &Path,
    ignore_paths: &[&str],
) -> Result<(), Box<dyn std::error::Error>> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let relative = path.strip_prefix(root)?;
        let relative_str = relative.to_string_lossy().replace('\\', "/");

        if ignore_paths.iter().any(|ignore| relative_str.starts_with(ignore)) {
            continue;
        }

        let destination = target_root.join(relative);
        if entry.file_type()?.is_dir() {
            fs::create_dir_all(&destination)?;
            copy_folder_recursive(root, &path, target_root, ignore_paths)?;
        } else {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&path, &destination)?;
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }

    Ok(())
}
