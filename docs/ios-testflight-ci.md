# TestFlight upload from GitHub Actions

When the **Build** workflow runs (push to `main` or manual `workflow_dispatch`), after a successful signed IPA build it uploads that IPA to App Store Connect for TestFlight.

## Job flow

```
build-ios-verification (simulator, macOS + Xcode 26 / iOS 26 SDK)
  → build-ios-signed-release (device IPA, macOS + Xcode 26 / iOS 26 SDK)
    → publish-ios-testflight  (upload IPA via App Store Connect API on Linux)
    → publish-draft-release   (GitHub draft assets; parallel with TestFlight)
```

**SDK requirement:** App Store Connect rejects IPAs built with SDKs older than iOS 26.
CI selects Xcode 26 via `maxim-lobanov/setup-xcode` (`xcode-version: '26'`).

**SwiftRs link stubs:** `Sources/nostria/SwiftCompatibilityStubs.c` defines
`__swift_FORCE_LOAD_$_swiftCompatibility56` / `Concurrency` because Xcode 26 no longer
ships those compatibility libs on all platforms.

Upload uses `apple-actions/upload-testflight-build@v4` with `backend: appstore-api`.
That avoids `xcrun iTMSTransporter` / Transporter.app (OSStatus `-10814` without Transporter.app).

## Secrets (nostria app repo)

| Secret | Purpose |
| --- | --- |
| `IOS_CERTIFICATE` | Base64 `.p12` distribution cert + private key |
| `IOS_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `IOS_PROVISIONING_PROFILE` | Base64 App Store / distribution `.mobileprovision` |
| `APPLE_IAP_ISSUER_ID` | App Store Connect API Issuer ID |
| `APPLE_IAP_KEY_ID` | App Store Connect API Key ID |
| `APPLE_IAP_PRIVATE_KEY` | Contents of the `.p8` key |

The `APPLE_IAP_*` names match the backend IAP verifier. The **same App Store Connect API key format** is used for uploads. The key must have **App Manager** or **Admin** access (not “Developer” only).

> **Backend reminder:** `nostria-service` still needs the same (or a separate) App Store Connect API credentials in **its** deploy environment for purchase verification at runtime. Secrets on this repo only cover CI upload.

## Requirements for a successful upload

1. **App record** exists in App Store Connect with bundle id `app.nostria` (or whatever is in `src-tauri/tauri.ios.conf.json`).
2. **Provisioning profile** is an **App Store** distribution profile (not Development / Ad Hoc).  
   The workflow chooses `--export-method app-store-connect` when the profile has no device list.
3. **Version / build** in the IPA must be new relative to previous uploads (CFBundleShortVersionString / CFBundleVersion).
4. Paid Apps agreement / banking / tax must be active if required for your account.

## After upload

1. Wait for processing in App Store Connect (often 5–30 minutes).
2. Open **TestFlight** for the app.
3. Assign the new build to internal and/or external groups.
4. External testing may need a short Beta App Review the first time / for major changes.

Automatic group assignment is not configured yet; only the binary upload is automated.

## Local / dry-run check

You cannot fully dry-run ASC upload without credentials, but you can confirm the IPA exists from the `nostria-ios-signed-run-*` workflow artifact.
