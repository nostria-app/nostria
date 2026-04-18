use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, WebviewWindow,
};

#[cfg(desktop)]
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

#[cfg(desktop)]
use tauri::Emitter;

#[cfg(desktop)]
use std::ffi::c_void;

#[cfg(desktop)]
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};

#[cfg(mobile)]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.nostria.mediasession";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_media_session);

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playback_speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_playing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_prev: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_next: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_seek: Option<bool>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playback_speed: Option<f64>,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaActionPayload {
    action: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    seek_position: Option<f64>,
}

#[cfg(mobile)]
pub struct MediaSession<R: Runtime>(PluginHandle<R>);

#[cfg(mobile)]
impl<R: Runtime> MediaSession<R> {
    fn initialize(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<()>("initialize", ())
            .map_err(|error| format!("{error}"))
    }

    fn update_state(&self, state: MediaState) -> Result<(), String> {
        self.0
            .run_mobile_plugin("updateState", state)
            .map_err(|error| format!("{error}"))
    }

    fn update_timeline(&self, timeline: TimelineUpdate) -> Result<(), String> {
        self.0
            .run_mobile_plugin("updateTimeline", timeline)
            .map_err(|error| format!("{error}"))
    }

    fn clear(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<()>("clear", ())
            .map_err(|error| format!("{error}"))
    }
}

#[cfg(mobile)]
pub trait MediaSessionExt<R: Runtime> {
    fn media_session(&self) -> &MediaSession<R>;
}

#[cfg(mobile)]
impl<R: Runtime, T: Manager<R>> MediaSessionExt<R> for T {
    fn media_session(&self) -> &MediaSession<R> {
        self.state::<MediaSession<R>>().inner()
    }
}

#[cfg(desktop)]
#[derive(Default)]
struct DesktopMediaSessionState {
    inner: Arc<Mutex<DesktopMediaSessionInner>>,
}

#[cfg(desktop)]
#[derive(Default)]
struct DesktopMediaSessionInner {
    controls: Option<MediaControls>,
    state: MediaState,
}

#[cfg(desktop)]
impl DesktopMediaSessionState {
    fn initialize<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        window: &WebviewWindow<R>,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "media session state poisoned")?;
        if inner.controls.is_none() {
            inner.controls = Some(Self::create_controls(app, window, Arc::clone(&self.inner))?);
        }
        Ok(())
    }

    fn update_state<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        window: &WebviewWindow<R>,
        update: MediaState,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "media session state poisoned")?;
        if inner.controls.is_none() {
            inner.controls = Some(Self::create_controls(app, window, Arc::clone(&self.inner))?);
        }

        merge_media_state(&mut inner.state, update);
        Self::apply_state(&mut inner)
    }

    fn update_timeline<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        window: &WebviewWindow<R>,
        timeline: TimelineUpdate,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "media session state poisoned")?;
        if inner.controls.is_none() {
            inner.controls = Some(Self::create_controls(app, window, Arc::clone(&self.inner))?);
        }

        merge_timeline_state(&mut inner.state, timeline);
        Self::apply_state(&mut inner)
    }

    fn clear(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "media session state poisoned")?;
        if let Some(mut controls) = inner.controls.take() {
            let _ = controls.set_metadata(MediaMetadata::default());
            let _ = controls.set_playback(MediaPlayback::Stopped);
            let _ = controls.detach();
        }
        inner.state = MediaState::default();
        Ok(())
    }

    fn apply_state(inner: &mut DesktopMediaSessionInner) -> Result<(), String> {
        let snapshot = inner.state.clone();
        let metadata = build_desktop_metadata(&snapshot);
        let playback = build_desktop_playback(&snapshot);
        let controls = inner
            .controls
            .as_mut()
            .ok_or_else(|| "desktop media controls unavailable".to_string())?;

        controls
            .set_metadata(metadata)
            .map_err(|error| format!("failed to update desktop media metadata: {error}"))?;
        controls
            .set_playback(playback)
            .map_err(|error| format!("failed to update desktop media playback: {error}"))?;

        Ok(())
    }

    fn create_controls<R: Runtime>(
        app: &AppHandle<R>,
        window: &WebviewWindow<R>,
        state: Arc<Mutex<DesktopMediaSessionInner>>,
    ) -> Result<MediaControls, String> {
        let display_name = app.package_info().name.clone();
        let dbus_name = sanitize_dbus_name(&app.config().identifier);

        #[cfg(windows)]
        let hwnd = Some(
            window
                .hwnd()
                .map_err(|error| format!("failed to resolve window handle: {error}"))?
                .0 as *mut c_void,
        );

        #[cfg(not(windows))]
        let hwnd = None;

        let mut controls = MediaControls::new(PlatformConfig {
            display_name: &display_name,
            dbus_name: &dbus_name,
            hwnd,
        })
        .map_err(|error| format!("failed to initialize desktop media controls: {error}"))?;

        let app_handle = app.clone();
        controls
            .attach(move |event| emit_desktop_event(&app_handle, &state, event))
            .map_err(|error| format!("failed to attach desktop media controls: {error}"))?;

        Ok(controls)
    }
}

#[cfg(desktop)]
fn merge_media_state(current: &mut MediaState, update: MediaState) {
    if update.title.is_some() {
        current.title = update.title;
    }
    if update.artist.is_some() {
        current.artist = update.artist;
    }
    if update.album.is_some() {
        current.album = update.album;
    }
    if update.artwork_url.is_some() {
        current.artwork_url = update.artwork_url;
    }
    if update.duration.is_some() {
        current.duration = update.duration;
    }
    if update.position.is_some() {
        current.position = update.position;
    }
    if update.playback_speed.is_some() {
        current.playback_speed = update.playback_speed;
    }
    if update.is_playing.is_some() {
        current.is_playing = update.is_playing;
    }
    if update.can_prev.is_some() {
        current.can_prev = update.can_prev;
    }
    if update.can_next.is_some() {
        current.can_next = update.can_next;
    }
    if update.can_seek.is_some() {
        current.can_seek = update.can_seek;
    }
}

#[cfg(desktop)]
fn merge_timeline_state(current: &mut MediaState, update: TimelineUpdate) {
    if update.position.is_some() {
        current.position = update.position;
    }
    if update.duration.is_some() {
        current.duration = update.duration;
    }
    if update.playback_speed.is_some() {
        current.playback_speed = update.playback_speed;
    }
}

#[cfg(desktop)]
fn build_desktop_metadata(state: &MediaState) -> MediaMetadata<'_> {
    MediaMetadata {
        title: state.title.as_deref().filter(|value| !value.is_empty()),
        artist: state.artist.as_deref().filter(|value| !value.is_empty()),
        album: state.album.as_deref().filter(|value| !value.is_empty()),
        cover_url: state
            .artwork_url
            .as_deref()
            .filter(|value| !value.is_empty()),
        duration: state
            .duration
            .filter(|value| value.is_finite() && *value > 0.0)
            .map(Duration::from_secs_f64),
    }
}

#[cfg(desktop)]
fn build_desktop_playback(state: &MediaState) -> MediaPlayback {
    let progress = state
        .position
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| MediaPosition(Duration::from_secs_f64(value)));

    if state.is_playing.unwrap_or(false) {
        MediaPlayback::Playing { progress }
    } else {
        MediaPlayback::Paused { progress }
    }
}

#[cfg(desktop)]
fn emit_desktop_event<R: Runtime>(
    app: &AppHandle<R>,
    state: &Arc<Mutex<DesktopMediaSessionInner>>,
    event: MediaControlEvent,
) {
    if let Some(payload) = map_desktop_event(state, event) {
        let _ = app.emit("media_action", payload);
    }
}

#[cfg(desktop)]
fn map_desktop_event(
    state: &Arc<Mutex<DesktopMediaSessionInner>>,
    event: MediaControlEvent,
) -> Option<MediaActionPayload> {
    match event {
        MediaControlEvent::Play => Some(MediaActionPayload {
            action: "play",
            seek_position: None,
        }),
        MediaControlEvent::Pause => Some(MediaActionPayload {
            action: "pause",
            seek_position: None,
        }),
        MediaControlEvent::Toggle => {
            let is_playing = state
                .lock()
                .ok()
                .and_then(|inner| inner.state.is_playing)
                .unwrap_or(false);

            Some(MediaActionPayload {
                action: if is_playing { "pause" } else { "play" },
                seek_position: None,
            })
        }
        MediaControlEvent::Next => Some(MediaActionPayload {
            action: "next",
            seek_position: None,
        }),
        MediaControlEvent::Previous => Some(MediaActionPayload {
            action: "previous",
            seek_position: None,
        }),
        MediaControlEvent::Stop => Some(MediaActionPayload {
            action: "stop",
            seek_position: None,
        }),
        MediaControlEvent::SetPosition(MediaPosition(position)) => Some(MediaActionPayload {
            action: "seek",
            seek_position: Some(position.as_secs_f64()),
        }),
        MediaControlEvent::SeekBy(direction, amount) => Some(MediaActionPayload {
            action: "seek",
            seek_position: Some(resolve_seek_target(state, direction, amount.as_secs_f64())),
        }),
        MediaControlEvent::Seek(direction) => Some(MediaActionPayload {
            action: "seek",
            seek_position: Some(resolve_seek_target(state, direction, 10.0)),
        }),
        MediaControlEvent::SetVolume(_)
        | MediaControlEvent::OpenUri(_)
        | MediaControlEvent::Raise
        | MediaControlEvent::Quit => None,
    }
}

#[cfg(desktop)]
fn resolve_seek_target(
    state: &Arc<Mutex<DesktopMediaSessionInner>>,
    direction: SeekDirection,
    delta_seconds: f64,
) -> f64 {
    let (current_position, duration) = state
        .lock()
        .ok()
        .map(|inner| (inner.state.position.unwrap_or(0.0), inner.state.duration))
        .unwrap_or((0.0, None));

    let next_position = match direction {
        SeekDirection::Forward => current_position + delta_seconds,
        SeekDirection::Backward => current_position - delta_seconds,
    };

    let clamped = next_position.max(0.0);
    if let Some(duration) = duration.filter(|value| value.is_finite() && *value > 0.0) {
        clamped.min(duration)
    } else {
        clamped
    }
}

#[cfg(desktop)]
fn sanitize_dbus_name(identifier: &str) -> String {
    let sanitized = identifier
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '.' => character,
            _ => '_',
        })
        .collect::<String>();

    if sanitized.contains('.') {
        sanitized
    } else {
        format!("app.{sanitized}")
    }
}

#[tauri::command]
fn initialize<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = window;
        return app.media_session().initialize();
    }

    #[cfg(desktop)]
    {
        return app
            .state::<DesktopMediaSessionState>()
            .initialize(&app, &window);
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, window);
        Ok(())
    }
}

#[tauri::command]
fn update_state<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: MediaState,
) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = window;
        return app.media_session().update_state(state);
    }

    #[cfg(desktop)]
    {
        return app
            .state::<DesktopMediaSessionState>()
            .update_state(&app, &window, state);
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, window, state);
        Ok(())
    }
}

#[tauri::command]
fn update_timeline<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    timeline: TimelineUpdate,
) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = window;
        return app.media_session().update_timeline(timeline);
    }

    #[cfg(desktop)]
    {
        return app
            .state::<DesktopMediaSessionState>()
            .update_timeline(&app, &window, timeline);
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, window, timeline);
        Ok(())
    }
}

#[tauri::command]
fn clear<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = window;
        return app.media_session().clear();
    }

    #[cfg(desktop)]
    {
        let _ = window;
        return app.state::<DesktopMediaSessionState>().clear();
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, window);
        Ok(())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("media-session")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "MediaSessionPlugin")?;

            #[cfg(target_os = "ios")]
            let handle = _api.register_ios_plugin(init_plugin_media_session)?;

            #[cfg(mobile)]
            app.manage(MediaSession(handle));

            #[cfg(desktop)]
            app.manage(DesktopMediaSessionState::default());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize,
            update_state,
            update_timeline,
            clear
        ])
        .build()
}