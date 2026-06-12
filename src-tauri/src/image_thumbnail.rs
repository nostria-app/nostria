// Native inline-image thumbnailing for the Tauri (desktop/mobile) builds.
//
// The web app loads feed images directly from their origin at full resolution. WebKit
// (webkit2gtk on Linux, used by the Tauri desktop build) keeps the *decoded* bitmap of every
// on-screen <img> in memory; a single 12 MP photo decodes to ~48 MB. Across long, image-heavy
// feeds this is the dominant driver of the multi-gigabyte `WebKitWebProcess` memory reports.
//
// Instead of routing feed thumbnails through the hosted image proxy (which adds load and, in
// practice, dropped EXIF orientation so portrait photos rendered sideways), the native app
// rewrites inline image URLs to a custom `thumbimg://` URI scheme handled here. This handler:
//   1. Serves a previously generated thumbnail from the on-disk cache when available.
//   2. Otherwise downloads the original, applies EXIF orientation, downscales to a bounded
//      width while preserving aspect ratio, re-encodes as JPEG, caches it, and returns it.
//
// The full-resolution original is still used by the in-app image viewer, so opening an image
// shows full quality. The web build never uses this scheme and is therefore unaffected.

use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use base64::Engine as _;
use image::ImageDecoder;
use tauri::{Manager, UriSchemeResponder, Wry};

/// Maximum number of bytes to download for a single source image before giving up.
/// Guards against pathologically large originals exhausting memory during decode.
const MAX_DOWNLOAD_BYTES: u64 = 40 * 1024 * 1024; // 40 MB

/// Clamp bounds for the requested thumbnail width.
const MIN_WIDTH: u32 = 64;
const MAX_WIDTH: u32 = 4096;

/// JPEG quality for generated thumbnails (0-100).
const JPEG_QUALITY: u8 = 82;

/// Keep native thumbnail work bounded. Android WebView can request many feed images at once,
/// and spawning one OS thread per request can panic if the process hits its thread limit.
#[cfg(target_os = "android")]
const MAX_CONCURRENT_THUMBNAIL_JOBS: usize = 4;

#[cfg(not(target_os = "android"))]
const MAX_CONCURRENT_THUMBNAIL_JOBS: usize = 8;

static ACTIVE_THUMBNAIL_JOBS: AtomicUsize = AtomicUsize::new(0);

struct ActiveThumbnailJob;

impl Drop for ActiveThumbnailJob {
    fn drop(&mut self) {
        ACTIVE_THUMBNAIL_JOBS.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Register the `thumbimg` asynchronous URI scheme protocol on the Tauri builder.
///
/// Requests look like `thumbimg://localhost/<base64url(originalUrl)>?w=1080`
/// (or `http://thumbimg.localhost/...` on Windows/Android, produced by `convertFileSrc`).
pub fn register(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder.register_asynchronous_uri_scheme_protocol("thumbimg", move |ctx, request, responder| {
        let app = ctx.app_handle().clone();
        let uri = request.uri().clone();

        let active_jobs = ACTIVE_THUMBNAIL_JOBS.fetch_add(1, Ordering::AcqRel) + 1;
        if active_jobs > MAX_CONCURRENT_THUMBNAIL_JOBS {
            ACTIVE_THUMBNAIL_JOBS.fetch_sub(1, Ordering::AcqRel);
            respond(responder, 429, "text/plain", b"thumbnail busy".to_vec());
            return;
        }

        // The download + decode + resize work is blocking and CPU/IO heavy, so run it off the
        // main thread and respond asynchronously. Use Builder::spawn so thread exhaustion is
        // reported as an error instead of panicking across Android's JNI request callback.
        let spawn_result = std::thread::Builder::new()
            .name("nostria-thumbimg".to_string())
            .spawn(move || {
                let _active_job = ActiveThumbnailJob;
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    serve(&app, uri.path(), uri.query())
                }));

                match result {
                    Ok((status, content_type, body)) => {
                        respond(responder, status, &content_type, body);
                    }
                    Err(_) => {
                        respond(responder, 500, "text/plain", b"thumbnail panicked".to_vec());
                    }
                }
            });

        if let Err(error) = spawn_result {
            ACTIVE_THUMBNAIL_JOBS.fetch_sub(1, Ordering::AcqRel);
            eprintln!("failed to spawn thumbnail worker: {error}");
        }
    })
}

fn respond(responder: UriSchemeResponder, status: u16, content_type: &str, body: Vec<u8>) {
    let cache_control = if status == 200 {
        "max-age=604800"
    } else {
        "no-store"
    };

    let response = tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, content_type)
        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(tauri::http::header::CACHE_CONTROL, cache_control)
        .body(Cow::<'static, [u8]>::Owned(body))
        .unwrap_or_else(|_| tauri::http::Response::new(Cow::<'static, [u8]>::Owned(Vec::new())));

    responder.respond(response);
}

/// Resolve a thumbnail request into an HTTP status, content type, and body bytes.
fn serve(app: &tauri::AppHandle, path: &str, query: Option<&str>) -> (u16, String, Vec<u8>) {
    let (url, width) = match decode_request(path, query) {
        Some(parsed) => parsed,
        None => return (400, "text/plain".to_string(), b"bad request".to_vec()),
    };

    // Serve from cache when present (thumbnails are cached as JPEG).
    if let Some(cache_path) = cache_path(app, &url, width) {
        if let Ok(bytes) = std::fs::read(&cache_path) {
            return (200, "image/jpeg".to_string(), bytes);
        }
    }

    match build_thumbnail(&url, width) {
        Ok(ThumbnailResult::Jpeg(bytes)) => {
            if let Some(cache_path) = cache_path(app, &url, width) {
                if let Some(parent) = cache_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(&cache_path, &bytes);
            }
            (200, "image/jpeg".to_string(), bytes)
        }
        // Unknown/animated/vector formats are passed through untouched so they still render.
        Ok(ThumbnailResult::Passthrough {
            bytes,
            content_type,
        }) => (200, content_type, bytes),
        // On failure return an error status; the frontend <img> onerror falls back to the
        // original URL, so a thumbnailing failure never hides an image.
        Err(_) => (502, "text/plain".to_string(), b"thumbnail failed".to_vec()),
    }
}

/// Parse `<base64url(url)>` path segment and optional `w=<width>` query parameter.
fn decode_request(path: &str, query: Option<&str>) -> Option<(String, u32)> {
    let encoded = path.trim_start_matches('/');
    if encoded.is_empty() {
        return None;
    }

    let url_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded.as_bytes())
        .ok()?;
    let url = String::from_utf8(url_bytes).ok()?;

    // Only allow http(s) sources.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return None;
    }

    let mut width = 1080u32;
    if let Some(query) = query {
        for pair in query.split('&') {
            if let Some(value) = pair.strip_prefix("w=") {
                if let Ok(parsed) = value.parse::<u32>() {
                    width = parsed;
                }
            }
        }
    }

    Some((url, width.clamp(MIN_WIDTH, MAX_WIDTH)))
}

enum ThumbnailResult {
    Jpeg(Vec<u8>),
    Passthrough {
        bytes: Vec<u8>,
        content_type: String,
    },
}

/// Download the original image and produce a bounded-width JPEG thumbnail.
fn build_thumbnail(url: &str, width: u32) -> Result<ThumbnailResult, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .user_agent("Nostria-Thumbnailer")
        .build();

    let response = agent.get(url).call().map_err(|err| err.to_string())?;
    let source_content_type = response
        .header("Content-Type")
        .unwrap_or("application/octet-stream")
        .to_string();

    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_DOWNLOAD_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|err| err.to_string())?;

    match resize_to_jpeg(&bytes, width) {
        Some(jpeg) => Ok(ThumbnailResult::Jpeg(jpeg)),
        // Decoding failed (e.g. SVG or an unsupported/animated format) — pass the original
        // through so the image still displays.
        None => Ok(ThumbnailResult::Passthrough {
            bytes,
            content_type: source_content_type,
        }),
    }
}

/// Decode the image, apply EXIF orientation, downscale to `max_width`, and encode JPEG.
/// Returns `None` if the bytes cannot be decoded as a raster image.
fn resize_to_jpeg(bytes: &[u8], max_width: u32) -> Option<Vec<u8>> {
    let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;

    let mut decoder = reader.into_decoder().ok()?;
    // Read EXIF orientation before consuming the decoder so portrait photos are upright.
    let orientation = decoder.orientation().ok()?;

    let mut img = image::DynamicImage::from_decoder(decoder).ok()?;
    img.apply_orientation(orientation);

    let (current_width, current_height) = (img.width(), img.height());
    let output = if current_width > max_width {
        let new_height =
            ((current_height as u64 * max_width as u64) / current_width as u64).max(1) as u32;
        img.resize_exact(max_width, new_height, image::imageops::FilterType::Triangle)
    } else {
        // Smaller than the bound — keep as-is (no upscaling), still re-encoded as JPEG.
        img
    };

    let rgb = output.to_rgb8();
    let mut buffer = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, JPEG_QUALITY);
    encoder.encode_image(&rgb).ok()?;
    Some(buffer)
}

/// Compute the on-disk cache path for a given source URL + width.
fn cache_path(app: &tauri::AppHandle, url: &str, width: u32) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join("image-thumbnails");

    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    width.hash(&mut hasher);
    let key = hasher.finish();

    Some(dir.join(format!("{key:016x}.jpg")))
}
