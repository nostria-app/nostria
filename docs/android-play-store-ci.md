# Google Play upload from GitHub Actions

When the **Build** workflow runs (push to `main` or manual `workflow_dispatch`), after a successful signed Android build it uploads the signed `.aab` to Google Play.

This is the Android counterpart of [`docs/ios-testflight-ci.md`](./ios-testflight-ci.md). On Google Play the equivalent of TestFlight is the **internal testing** track, which is the default here.

## Job flow

```
build-android-verification (debug + debug-signed release APK, Linux)
  → build-android-signed-release (signed APK + AAB + ProGuard mapping, Linux)
    → publish-android-play-store  (upload AAB via Google Play Developer API)
    → publish-draft-release       (GitHub draft assets; parallel with Play upload)
```

The upload uses `r0adkll/upload-google-play@v1`, which talks to the Google Play Developer API directly (no fastlane or Play Console UI step needed).

## Secrets and variables

| Name | Type | Purpose |
| --- | --- | --- |
| `KEYSTORE_BASE64` | secret | Base64 of the upload keystore (already used to sign the AAB) |
| `KEYSTORE_PASSWORD` | secret | Keystore password |
| `KEY_ALIAS` | secret | Key alias inside the keystore |
| `KEY_PASSWORD` | secret | Key password |
| `PLAY_SERVICE_ACCOUNT_JSON` | secret | **New.** Full Google Cloud service account JSON key with Play Console access |
| `PLAY_TRACK` | variable (optional) | Default track when the workflow is not started manually. Defaults to `internal` |

The four `KEYSTORE_*` / `KEY_*` secrets already existed for the signed release build — nothing changes there.

> **If `PLAY_SERVICE_ACCOUNT_JSON` is not set, the job logs a warning and skips the upload** instead of failing the build. This keeps `main` green until the Play setup below is finished.

## One-time setup

### 1. Create the app in Play Console

The Play Developer API **cannot create an app**. Do this once manually:

1. Open [Google Play Console](https://play.google.com/console) → **Create app**.
2. Package name must be `app.nostria` (matches `identifier` in `src-tauri/tauri.conf.json`).
3. Complete the required declarations (app content, data safety, content rating, target audience).

### 2. Upload the first release manually

Google Play requires the **first** bundle on a track to be uploaded through the Console so that **Play App Signing** can be enrolled. Download the `nostria-android-release-aab-run-*` artifact from a Build workflow run and upload it to the internal testing track once.

After that, all further uploads can be automated.

> Make sure Play App Signing is enabled and that the keystore behind `KEYSTORE_BASE64` is registered as the **upload key**. Losing that keystore means you can no longer publish updates.

### 3. Create a service account

1. In Play Console: **Setup → API access** (or **Users and permissions**), and link a Google Cloud project.
2. In [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts) create a service account, then **Keys → Add key → Create new key → JSON** and download it.
3. Back in Play Console → **Users and permissions → Invite new users**, invite the service account email (`...@....iam.gserviceaccount.com`) and grant it, for the Nostria app:
   - **Release → Release apps to testing tracks**
   - **Release → Manage testing tracks and edit tester lists**
   - **Release to production** as well, only if you intend to use the `production` track
4. Enable the **Google Play Android Developer API** in the Google Cloud project.

Permission propagation can take a few minutes to a few hours after inviting the service account.

### 4. Add the secret

```bash
gh secret set PLAY_SERVICE_ACCOUNT_JSON --repo nostria-app/nostria < path/to/service-account.json

# Optional: change the default track for pushes to main
gh variable set PLAY_TRACK --repo nostria-app/nostria --body internal
```

Paste the JSON key **verbatim**, including the `-----BEGIN PRIVATE KEY-----` block. The workflow validates that the secret parses as JSON and contains `type`, `client_email` and `private_key` before attempting an upload.

## Choosing a track

- **Push to `main`** → uses the `PLAY_TRACK` repository variable, falling back to `internal`.
- **Manual run** (`workflow_dispatch`) → pick `play_track` (`internal`, `alpha`, `beta`, `production`) and `play_release_status` (`completed` or `draft`).

Use `draft` if you want the release created in Play Console but not rolled out until you press publish.

## Version codes

`versionCode` is derived from `version` in `package.json` by Tauri:

```
versionCode = major * 1000000 + minor * 1000 + patch
```

So `3.1.34` → `3001034`.

**Google Play rejects a versionCode that has already been used.** Pushing to `main` twice without bumping `package.json` will fail the upload with `Version code 3001034 has already been used`. Bump the version to fix it. The GitHub Actions job summary calls this out explicitly when the upload fails.

## ABI coverage

The signed bundle is built with `:app:bundleArm64Release`, so it contains only the `arm64-v8a` native library. Practically every Android device released since ~2017 is arm64, but 32-bit-only (`armeabi-v7a`) and x86/x86_64 devices (including some Chromebooks) will see the app as incompatible in the Play Store.

To cover every ABI, the signed release job in [`.github/workflows/build.yml`](../.github/workflows/build.yml) would need to build all Rust Android targets and run `:app:bundleUniversalRelease` instead. That roughly quadruples the Rust build time, which is why arm64 is used today.

## After upload

1. The build appears in Play Console → **Testing → Internal testing** within a minute or two.
2. Add testers to the track (one-time) and share the opt-in link.
3. Promote the release to `beta`/`production` from Play Console, or run the workflow manually with a different `play_track`.

Tester group management is not automated; only the bundle upload is.

## Troubleshooting

| Error | Cause |
| --- | --- |
| `The caller does not have permission` | Service account not invited in Play Console, or permissions not yet propagated |
| `Package not found: app.nostria` | App not created in Play Console, or the service account has no access to it |
| `Version code N has already been used` | Bump `version` in `package.json` |
| `APK specifies a version code that has already been used` | Same as above |
| `Only releases with status draft may be created on draft app` | The app has never had a production release; use `play_release_status: draft` or publish the app first |
| Job says *Google Play upload skipped* | `PLAY_SERVICE_ACCOUNT_JSON` is not configured |
