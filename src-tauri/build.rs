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
    "log",
    "initialize",
    "update_state",
    "update_timeline",
    "clear",
    "play_audio",
    "pause_audio",
    "resume_audio",
    "stop_audio",
    "seek_audio",
    "set_audio_rate",
];

const ANDROID_MEDIA_SESSION_ENV: &str = "DEP_MEDIA_SESSION_ANDROID_LIBRARY_PATH";
const ANDROID_MEDIA_SESSION_MODULE: &str = "media-session";

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

    finalize_android_media_session_project()
        .expect("failed to finalize Android media-session Gradle wiring");
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

fn finalize_android_media_session_project() -> Result<(), Box<dyn std::error::Error>> {
    if env::var("CARGO_CFG_TARGET_OS")?.as_str() != "android" {
        return Ok(());
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    link_android_library(&manifest_dir.join("media-session/android"))?;
    Ok(())
}

fn setup_android_sources(source: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let tauri_library_path = PathBuf::from(
        env::var("DEP_TAURI_ANDROID_LIBRARY_PATH")
            .expect("missing DEP_TAURI_ANDROID_LIBRARY_PATH environment variable"),
    );

    println!("cargo:rerun-if-env-changed=DEP_TAURI_ANDROID_LIBRARY_PATH");
    copy_folder(&tauri_library_path, &source.join(".tauri/tauri-api"), &[])?;
    env::set_var(ANDROID_MEDIA_SESSION_ENV, normalize_gradle_path(source));
    println!("cargo:rerun-if-env-changed={ANDROID_MEDIA_SESSION_ENV}");
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

fn link_android_library(source: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let Some(project_path) = env::var_os("TAURI_ANDROID_PROJECT_PATH").map(PathBuf::from) else {
        return Ok(());
    };

    let gradle_path = normalize_gradle_path(source)
        .display()
        .to_string()
        .replace('\\', "\\\\");

    let settings_path = project_path.join("tauri.settings.gradle");
    if settings_path.exists() {
        let settings_contents = fs::read_to_string(&settings_path)?;
        let include_line = format!("include ':{ANDROID_MEDIA_SESSION_MODULE}'");
        let project_line = format!(
            "project(':{ANDROID_MEDIA_SESSION_MODULE}').projectDir = new File(\"{gradle_path}\")"
        );

        let mut lines = Vec::new();
        let mut include_present = false;
        let mut project_written = false;

        for line in settings_contents.lines() {
            if line == include_line {
                if !include_present {
                    lines.push(include_line.clone());
                    include_present = true;
                }
                continue;
            }

            if line.starts_with(&format!("project(':{ANDROID_MEDIA_SESSION_MODULE}').projectDir = ")) {
                if !project_written {
                    lines.push(project_line.clone());
                    project_written = true;
                }
                continue;
            }

            lines.push(line.to_string());
        }

        if !include_present {
            lines.push(include_line);
        }
        if !project_written {
            lines.push(project_line);
        }

        let mut updated = lines.join("\n");
        if settings_contents.ends_with('\n') {
            updated.push('\n');
        }

        if updated != settings_contents {
            fs::write(&settings_path, updated)?;
        }
    }

    let app_gradle_path = project_path.join("app").join("tauri.build.gradle.kts");
    if app_gradle_path.exists() {
        let app_gradle_contents = fs::read_to_string(&app_gradle_path)?;
        let dependency_line = format!("  implementation(project(\":{ANDROID_MEDIA_SESSION_MODULE}\"))");

        if !app_gradle_contents.contains(&dependency_line) {
            let insertion_point = "  implementation(project(\":tauri-android\"))\n";
            let updated = if app_gradle_contents.contains(insertion_point) {
                app_gradle_contents.replacen(
                    insertion_point,
                    &format!("{insertion_point}{dependency_line}\n"),
                    1,
                )
            } else {
                let mut contents = app_gradle_contents;
                if !contents.ends_with('\n') {
                    contents.push('\n');
                }
                contents.push_str(&dependency_line);
                contents.push('\n');
                contents
            };

            fs::write(&app_gradle_path, updated)?;
        }
    }

    Ok(())
}

fn normalize_gradle_path(path: &Path) -> PathBuf {
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let normalized_string = normalized.display().to_string();
    if let Some(stripped) = normalized_string.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        normalized
    }
}

