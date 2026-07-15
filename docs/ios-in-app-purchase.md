# iOS In-App Purchase (App Store subscriptions)

This document describes how Nostria sells Premium on the iOS App Store shell under Apple guideline **3.1.1** (digital content must use In-App Purchase).

## Architecture

```
Angular InAppPurchaseService
  → window.webkit.messageHandlers.nostriaStoreKit.postMessage({ action, productId })
  → packages/ios StoreKitBridge.swift (StoreKit 2)
  → window.nostriaStoreKitCallback({ success, jwsRepresentation, transactionId, ... })
  → POST https://api.nostria.app/api/account/verify-store-purchase
```

| Layer | Location |
| --- | --- |
| Checkout UI | `src/app/pages/premium/upgrade`, `renew` |
| JS bridge | `src/app/services/in-app-purchase.service.ts` |
| Platform routing | `src/app/services/platform.service.ts` |
| Native StoreKit | `packages/ios/Nostria/StoreKitBridge.swift` |

On **native iOS**, payment methods are limited to **App Store only** (no Lightning / external browser checkout) so App Review does not see alternative digital-payment paths.

Web / PWA continues to use Bitcoin Lightning.

## Product IDs (App Store Connect)

Configure these product IDs to match the client:

| Product ID | Type | Notes |
| --- | --- | --- |
| `nostria_premium_monthly` | Auto-renewable subscription | **Primary SKU** for first release |
| `nostria_premium_quarterly` | Auto-renewable subscription | Mapped, not exposed yet in store-only mode |
| `nostria_premium_yearly` | Auto-renewable subscription | Mapped, not exposed yet in store-only mode |
| `username` | Non-consumable or non-renewing | Debug / username test flow |

First native release UI only offers **Premium Monthly** (`nostria_premium_monthly`) at **$9.99** display override in the upgrade UI.

### App Store Connect checklist

1. Create a subscription group (e.g. `Nostria Premium`).
2. Add `nostria_premium_monthly` (auto-renewable, 1 month).
3. Attach localization, pricing, and review screenshot/notes.
4. Ensure the app’s Paid Applications agreement and banking/tax are active.
5. Submit the subscription with the binary (or as a metadata update if already approved).
6. Use Sandbox Apple IDs for TestFlight / device testing.

## Native shell wiring

`packages/ios` registers:

- Message handler name: `nostriaStoreKit`
- Document-start flag: `window.__NOSTRIA_NATIVE_IOS__ = true`
- Cookie: `app-platform=iOS App Store`
- User-Agent suffix: `PWAShell`

`PlatformService` treats any of those signals as `native-ios` and sets `paymentPlatform` to `app-store` **without** requiring the Debug toggle.

## Backend: `POST /api/account/verify-store-purchase`

Implemented in **nostria-service** (`StorePurchaseService`). See also `nostria-service/docs/store-purchases.md`.

Body (client):

```json
{
  "purchaseToken": "<jws or transaction id>",
  "pubkey": "<hex pubkey>",
  "store": "app-store",
  "productId": "nostria_premium_monthly",
  "username": "optional-for-upgrade",
  "jwsRepresentation": "<StoreKit 2 JWS when available>"
}
```

Backend should:

1. Verify the App Store **JWS** (preferred) via Apple’s App Store Server API / JWT verification.
2. Confirm `productId` and subscription state.
3. Activate or extend the user’s Premium entitlement for `pubkey`.
4. When `username` is present on first upgrade, claim the NIP-05 username.
5. Be idempotent on Apple’s transaction / original transaction id (renewals and retries).

Without a working verification endpoint, the StoreKit sheet can succeed but the app will show “verification failed”.

## Local / Sandbox testing

1. Build and run the Xcode project under `packages/ios`.
2. Sign in with a Sandbox Apple ID (Settings → App Store → Sandbox Account on device).
3. Open Premium → Upgrade in the app.
4. Confirm only **App Store** is offered as the payment method.
5. Complete a Sandbox purchase for `nostria_premium_monthly`.
6. Confirm backend activates the subscription and the UI advances to the completion step.

Optional: add a StoreKit Configuration file in Xcode for offline product mocking during development.

## Debug (browser only)

Settings → Debug:

- **Simulate Platform → Native iOS** plus **Enable store payments while simulating platform** exercises UI routing in a browser (StoreKit sheet still requires the real iOS shell).
