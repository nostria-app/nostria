use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "ios")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_storekit);

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetProductsRequest {
    pub product_ids: Vec<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseRequest {
    pub product_id: String,
}

#[cfg(target_os = "ios")]
pub struct StoreKit<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "ios")]
impl<R: Runtime> StoreKit<R> {
    fn initialize(&self) -> Result<serde_json::Value, String> {
        self.0
            .run_mobile_plugin("initialize", ())
            .map_err(|error| format!("{error}"))
    }

    fn get_products(&self, request: GetProductsRequest) -> Result<serde_json::Value, String> {
        self.0
            .run_mobile_plugin("getProducts", request)
            .map_err(|error| format!("{error}"))
    }

    fn purchase(&self, request: PurchaseRequest) -> Result<serde_json::Value, String> {
        self.0
            .run_mobile_plugin("purchase", request)
            .map_err(|error| format!("{error}"))
    }

    fn restore(&self) -> Result<serde_json::Value, String> {
        self.0
            .run_mobile_plugin("restore", ())
            .map_err(|error| format!("{error}"))
    }
}

#[cfg(target_os = "ios")]
pub trait StoreKitExt<R: Runtime> {
    fn storekit(&self) -> &StoreKit<R>;
}

#[cfg(target_os = "ios")]
impl<R: Runtime, T: Manager<R>> StoreKitExt<R> for T {
    fn storekit(&self) -> &StoreKit<R> {
        self.state::<StoreKit<R>>().inner()
    }
}

const UNSUPPORTED: &str = "In-app purchases are only available in the iOS app";

#[tauri::command]
fn initialize<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "ios")]
    {
        return app.storekit().initialize();
    }

    #[allow(unreachable_code)]
    {
        let _ = app;
        Err(UNSUPPORTED.to_string())
    }
}

#[tauri::command]
fn get_products<R: Runtime>(
    app: AppHandle<R>,
    request: GetProductsRequest,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "ios")]
    {
        return app.storekit().get_products(request);
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, request);
        Err(UNSUPPORTED.to_string())
    }
}

#[tauri::command]
fn purchase<R: Runtime>(
    app: AppHandle<R>,
    request: PurchaseRequest,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "ios")]
    {
        return app.storekit().purchase(request);
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, request);
        Err(UNSUPPORTED.to_string())
    }
}

#[tauri::command]
fn restore<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "ios")]
    {
        return app.storekit().restore();
    }

    #[allow(unreachable_code)]
    {
        let _ = app;
        Err(UNSUPPORTED.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("storekit")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_storekit)?;
                _app.manage(StoreKit(handle));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize,
            get_products,
            purchase,
            restore
        ])
        .build()
}
