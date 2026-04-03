const ANDROID_SIGNER_COMMANDS: &[&str] = &[
    "is_available",
    "get_public_key",
    "sign_event",
    "nip04_encrypt",
    "nip04_decrypt",
    "nip44_encrypt",
    "nip44_decrypt",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "android-signer",
            tauri_build::InlinedPlugin::new()
                .commands(ANDROID_SIGNER_COMMANDS)
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to run tauri build");
}
