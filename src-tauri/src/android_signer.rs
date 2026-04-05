use serde::{Deserialize, Serialize};
use tauri::{plugin::TauriPlugin, AppHandle, Manager, Runtime};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.nostria";

type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AndroidSignerPermission {
    #[serde(rename = "type")]
    pub permission_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<u16>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
struct AndroidSignerCommandRequest<'a> {
    content: &'a str,
    #[serde(rename = "currentUser")]
    current_user: &'a str,
    #[serde(rename = "signerPackage")]
    signer_package: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pubkey: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<&'a str>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
struct GetPublicKeyRequest {
    permissions: Vec<AndroidSignerPermission>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AndroidSignerGetPublicKeyResponse {
    pub pubkey: String,
    #[serde(rename = "packageName")]
    pub package_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AndroidSignerCommandResponse {
    pub result: String,
    #[serde(rename = "packageName")]
    pub package_name: Option<String>,
    pub id: Option<String>,
    pub event: Option<String>,
}

pub struct AndroidSigner<R: Runtime> {
    #[cfg(target_os = "android")]
    mobile_plugin_handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> AndroidSigner<R> {
    pub fn is_available(&self) -> Result<bool> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin("isAvailable", ())
                .map_err(|error| error.to_string())
        }

        #[cfg(not(target_os = "android"))]
        {
            Ok(false)
        }
    }

    pub fn get_public_key(
        &self,
        permissions: Vec<AndroidSignerPermission>,
    ) -> Result<AndroidSignerGetPublicKeyResponse> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin("getPublicKey", GetPublicKeyRequest { permissions })
                .map_err(|error| error.to_string())
        }

        #[cfg(not(target_os = "android"))]
        {
            let _ = permissions;
            Err("Android signer is only available on Android.".into())
        }
    }

    pub fn sign_event(
        &self,
        content: &str,
        current_user: &str,
        signer_package: &str,
        id: Option<&str>,
    ) -> Result<AndroidSignerCommandResponse> {
        self.run_command("signEvent", content, current_user, signer_package, None, id)
    }

    pub fn nip04_encrypt(
        &self,
        content: &str,
        pubkey: &str,
        current_user: &str,
        signer_package: &str,
        id: Option<&str>,
    ) -> Result<AndroidSignerCommandResponse> {
        self.run_command(
            "nip04Encrypt",
            content,
            current_user,
            signer_package,
            Some(pubkey),
            id,
        )
    }

    pub fn nip04_decrypt(
        &self,
        content: &str,
        pubkey: &str,
        current_user: &str,
        signer_package: &str,
        id: Option<&str>,
    ) -> Result<AndroidSignerCommandResponse> {
        self.run_command(
            "nip04Decrypt",
            content,
            current_user,
            signer_package,
            Some(pubkey),
            id,
        )
    }

    pub fn nip44_encrypt(
        &self,
        content: &str,
        pubkey: &str,
        current_user: &str,
        signer_package: &str,
        id: Option<&str>,
    ) -> Result<AndroidSignerCommandResponse> {
        self.run_command(
            "nip44Encrypt",
            content,
            current_user,
            signer_package,
            Some(pubkey),
            id,
        )
    }

    pub fn nip44_decrypt(
        &self,
        content: &str,
        pubkey: &str,
        current_user: &str,
        signer_package: &str,
        id: Option<&str>,
    ) -> Result<AndroidSignerCommandResponse> {
        self.run_command(
            "nip44Decrypt",
            content,
            current_user,
            signer_package,
            Some(pubkey),
            id,
        )
    }

    fn run_command(
        &self,
        command: &str,
        content: &str,
        current_user: &str,
        signer_package: &str,
        pubkey: Option<&str>,
        id: Option<&str>,
    ) -> Result<AndroidSignerCommandResponse> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin(
                    command,
                    AndroidSignerCommandRequest {
                        content,
                        current_user,
                        signer_package,
                        pubkey,
                        id,
                    },
                )
                .map_err(|error| error.to_string())
        }

        #[cfg(not(target_os = "android"))]
        {
            let _ = (command, content, current_user, signer_package, pubkey, id);
            Err("Android signer is only available on Android.".into())
        }
    }
}

pub trait AndroidSignerExt<R: Runtime> {
    fn android_signer(&self) -> &AndroidSigner<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidSignerExt<R> for T {
    fn android_signer(&self) -> &AndroidSigner<R> {
        self.state::<AndroidSigner<R>>().inner()
    }
}

#[tauri::command]
async fn is_available<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    app.android_signer().is_available()
}

#[tauri::command]
async fn get_public_key<R: Runtime>(
    app: AppHandle<R>,
    permissions: Option<Vec<AndroidSignerPermission>>,
) -> Result<AndroidSignerGetPublicKeyResponse> {
    app.android_signer()
        .get_public_key(permissions.unwrap_or_default())
}

#[tauri::command]
async fn sign_event<R: Runtime>(
    app: AppHandle<R>,
    content: String,
    current_user: String,
    signer_package: String,
    id: Option<String>,
) -> Result<AndroidSignerCommandResponse> {
    app.android_signer()
        .sign_event(&content, &current_user, &signer_package, id.as_deref())
}

#[tauri::command]
async fn nip04_encrypt<R: Runtime>(
    app: AppHandle<R>,
    content: String,
    pubkey: String,
    current_user: String,
    signer_package: String,
    id: Option<String>,
) -> Result<AndroidSignerCommandResponse> {
    app.android_signer().nip04_encrypt(
        &content,
        &pubkey,
        &current_user,
        &signer_package,
        id.as_deref(),
    )
}

#[tauri::command]
async fn nip04_decrypt<R: Runtime>(
    app: AppHandle<R>,
    content: String,
    pubkey: String,
    current_user: String,
    signer_package: String,
    id: Option<String>,
) -> Result<AndroidSignerCommandResponse> {
    app.android_signer().nip04_decrypt(
        &content,
        &pubkey,
        &current_user,
        &signer_package,
        id.as_deref(),
    )
}

#[tauri::command]
async fn nip44_encrypt<R: Runtime>(
    app: AppHandle<R>,
    content: String,
    pubkey: String,
    current_user: String,
    signer_package: String,
    id: Option<String>,
) -> Result<AndroidSignerCommandResponse> {
    app.android_signer().nip44_encrypt(
        &content,
        &pubkey,
        &current_user,
        &signer_package,
        id.as_deref(),
    )
}

#[tauri::command]
async fn nip44_decrypt<R: Runtime>(
    app: AppHandle<R>,
    content: String,
    pubkey: String,
    current_user: String,
    signer_package: String,
    id: Option<String>,
) -> Result<AndroidSignerCommandResponse> {
    app.android_signer().nip44_decrypt(
        &content,
        &pubkey,
        &current_user,
        &signer_package,
        id.as_deref(),
    )
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("android-signer")
        .invoke_handler(tauri::generate_handler![
            is_available,
            get_public_key,
            sign_event,
            nip04_encrypt,
            nip04_decrypt,
            nip44_encrypt,
            nip44_decrypt,
        ])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidSignerPlugin")?;

            app.manage(AndroidSigner {
                #[cfg(target_os = "android")]
                mobile_plugin_handle: handle,
                #[cfg(not(target_os = "android"))]
                _marker: std::marker::PhantomData::<fn() -> R>,
            });

            Ok(())
        })
        .build()
}
