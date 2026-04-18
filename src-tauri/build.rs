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
    "register_listener",
];

fn main() {
    tauri_plugin::Builder::new(MEDIA_SESSION_COMMANDS)
        .android_path("media-session/android")
        .ios_path("media-session/ios")
        .build();

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
