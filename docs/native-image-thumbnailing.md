# Native Inline-Image Thumbnailing (Tauri desktop/mobile only)

## Problem

A user reported the desktop app (`WebKitWebProcess` on Ubuntu — webkit2gtk) consuming ~10 GB
of RAM. WebKit keeps the **decoded bitmap** of every on-screen `<img>` in memory; a single
12 MP photo decodes to ~48 MB. In long, image-heavy, multi-column feeds, retained decoded
bitmaps of full-resolution feed images dominate the renderer's memory and reach multiple GB.

## Why not the hosted image proxy

An earlier attempt routed inline feed images through the hosted image proxy
(`proxy.{region}.nostria.app/api/ImageOptimizeProxy`) at a bounded width. This was rejected:

- It would push **every feed thumbnail** through the self-hosted proxy, adding load and cost.
- The proxy drops EXIF orientation when transcoding to WebP, so portrait photos rendered
  **sideways** inline (while the full-screen viewer, which uses the original URL, was correct).

## Solution

A native thumbnailing path that runs **only inside the Tauri desktop/mobile app**. The web
build is completely unaffected and continues to load original image URLs directly.

### How it works

1. **Frontend** (`TauriImageService`, `src/app/services/tauri-image.service.ts`):
   - When `isTauri()` is true, inline feed image URLs are rewritten to a custom URI scheme:
     `thumbimg://localhost/<base64url(originalUrl)>?w=1080`
     (via `convertFileSrc(encoded, 'thumbimg')`, which yields `http://thumbimg.localhost/...`
     on Windows/Android).
   - On the web (and SSR), and for data/blob URLs, GIFs and SVGs, the **original URL is
     returned unchanged** — the proxy is never involved.
   - Integrated in `NoteContentComponent.getImageSrc()` and `PhotoEventComponent.getImageSrc()`.

2. **Native handler** (`src-tauri/src/image_thumbnail.rs`, registered in `lib.rs` via
   `register_asynchronous_uri_scheme_protocol("thumbimg", …)`):
   - Serves a cached JPEG thumbnail from `app_cache_dir()/image-thumbnails/` when present.
   - On a miss: downloads the original (`ureq`), decodes it (`image` crate), **applies EXIF
     orientation** (fixes the rotation bug), downscales to the requested max width preserving
     aspect ratio, re-encodes as JPEG (q≈82), writes it to the disk cache, and returns it.
   - Unsupported/vector/animated formats are passed through untouched so they still render.
   - All work runs off the main thread; the response is sent asynchronously.

### Error fallback chain

Both components implement a layered `onImageError`:

1. A native thumbnail failure falls back to the **original** source URL.
2. An original-source failure tries `stripImageProxy()` (removes third-party proxy wrappers).
3. If everything fails, the image is marked failed (broken-image placeholder).

So a thumbnailing failure never hides an otherwise-loadable image.

### Benefits

- Caps WebKit's decoded-bitmap memory (the real 10 GB driver) on native builds.
- **Zero** additional load on the hosted image proxy for feed thumbnails.
- **Fixes EXIF rotation** (portrait photos are upright inline).
- Free **offline disk caching** of thumbnails.
- Full-resolution originals are still used by the image viewer dialog.

## Dependencies added (native only)

`src-tauri/Cargo.toml`: `image` (jpeg/png/webp/gif), `ureq` (TLS via the existing ring
provider), `base64`. These affect only the desktop/mobile binaries, not the web bundle.

`image` is pinned to **`=0.25.5`** on purpose: it is the first release with the EXIF
orientation API used here (`ImageReader::into_decoder`, `ImageDecoder::orientation`,
`DynamicImage::apply_orientation`), but it predates the newer convolution code in later
0.25.x patches that uses the `slice_as_chunks` library feature stabilized only in Rust 1.88.
Pinning keeps the crate buildable on older toolchains (including older nightlies) so a local
`tauri build` does not require upgrading Rust.

## Verification

- `cargo check` passes on the old default nightly (`1.88.0-nightly`, 2025-04-14) — the exact
  toolchain that failed to build `image` 0.25.10 — confirming the version pin resolves the
  `slice_as_chunks` E0658 errors. `cargo check` compiles dependencies in full, so this proves
  `image` 0.25.5 builds, not just type-checks.
- `tsc -p tsconfig.app.json --noEmit` passes.
- Web app loaded in-browser: inline feed images use the **original** origin URLs — 0 proxied,
  0 `thumbimg` — confirming the web path is unchanged.

## Follow-ups

- Tune `JPEG_QUALITY` / max width if needed; consider periodic cache pruning if the on-disk
  thumbnail cache grows large over time (currently unbounded on disk, but small per entry).
- Video poster thumbnails and article hero images are not yet routed through the native path.
