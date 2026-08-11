use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.nostria.billing";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetProductsRequest {
    pub product_ids: Vec<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseRequest {
    pub product_id: String,
    /// Play base plan to buy; subscriptions can expose several offers.
    #[serde(default)]
    pub base_plan_id: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcknowledgeRequest {
    pub purchase_token: String,
}

#[cfg(target_os = "android")]
pub struct Billing<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "android")]
impl<R: Runtime> Billing<R> {
    fn call<T: Serialize>(&self, command: &str, payload: T) -> Result<serde_json::Value, String> {
        self.0
            .run_mobile_plugin(command, payload)
            .map_err(|error| format!("{error}"))
    }
}

#[cfg(target_os = "android")]
pub trait BillingExt<R: Runtime> {
    fn billing(&self) -> &Billing<R>;
}

#[cfg(target_os = "android")]
impl<R: Runtime, T: Manager<R>> BillingExt<R> for T {
    fn billing(&self) -> &Billing<R> {
        self.state::<Billing<R>>().inner()
    }
}

const UNSUPPORTED: &str = "Google Play billing is only available in the Android app";

#[tauri::command]
fn initialize<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        return app.billing().call("initialize", ());
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
    #[cfg(target_os = "android")]
    {
        return app.billing().call("getProducts", request);
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
    #[cfg(target_os = "android")]
    {
        return app.billing().call("purchase", request);
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, request);
        Err(UNSUPPORTED.to_string())
    }
}

#[tauri::command]
fn restore<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        return app.billing().call("restore", ());
    }

    #[allow(unreachable_code)]
    {
        let _ = app;
        Err(UNSUPPORTED.to_string())
    }
}

#[tauri::command]
fn acknowledge<R: Runtime>(
    app: AppHandle<R>,
    request: AcknowledgeRequest,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        return app.billing().call("acknowledge", request);
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, request);
        Err(UNSUPPORTED.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("billing")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "BillingPlugin")?;
                _app.manage(Billing(handle));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize,
            get_products,
            purchase,
            restore,
            acknowledge
        ])
        .build()
}
