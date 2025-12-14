# Push Notifications for PWABuilder-Packaged Apps

This document explains how to enable push notifications when the Nostria PWA is packaged for app stores using PWABuilder.

## Overview

When a PWA is packaged using PWABuilder for app stores, the standard Web Push API may not work the same way as it does in a browser. Here's what you need to know for each platform:

## Android (Google Play Store - TWA)

### How it Works
PWABuilder uses **Trusted Web Activity (TWA)** for Android, which runs your PWA inside Chrome. Web Push can work through **Notification Delegation**.

### Configuration Steps

1. **Enable Notification Delegation in PWABuilder**
   - When generating the Android package on PWABuilder.com
   - Set "Notification delegation" to **enabled**
   - This is already configured in `twa-manifest.json` with `"enableNotifications": true`

2. **Deploy assetlinks.json**
   - Ensure your Digital Asset Links file is properly deployed at:
   ```
   https://nostria.app/.well-known/assetlinks.json
   ```
   - The file must contain the correct SHA-256 fingerprint from Google Play Console

3. **Service Worker Push Handler**
   - The service worker (`src/service-worker.js`) handles `push` and `notificationclick` events
   - These handlers display notifications and handle user clicks

### Testing on Android
1. Install the TWA app from Google Play (or sideload the APK)
2. Enable notifications in the app
3. The app should request Web Push permission through Chrome
4. Push notifications should work the same as the browser PWA

## iOS (App Store)

### The Challenge
**Web Push does NOT work in WKWebView**, which PWABuilder uses to wrap your PWA for iOS. Apple does not allow Web Push in embedded web views.

### Solution: Firebase Cloud Messaging (FCM)

PWABuilder's iOS solution requires integrating Firebase Cloud Messaging for push notifications.

#### Step 1: Setup Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or use an existing one
3. Add an iOS app with your Bundle ID (from PWABuilder)
4. Download the `GoogleService-Info.plist` file

#### Step 2: Modify the PWABuilder iOS Project
After downloading the iOS package from PWABuilder:

1. Open the Xcode project
2. Add Firebase dependencies via CocoaPods:
   ```ruby
   # In Podfile
   pod 'Firebase/Messaging'
   ```

3. In `AppDelegate.swift`, uncomment the Firebase initialization and add FCM handling:
   ```swift
   import Firebase
   import FirebaseMessaging
   
   // In application(_:didFinishLaunchingWithOptions:)
   FirebaseApp.configure()
   Messaging.messaging().delegate = self
   
   // Request notification permissions
   UNUserNotificationCenter.current().delegate = self
   let authOptions: UNAuthorizationOptions = [.alert, .badge, .sound]
   UNUserNotificationCenter.current().requestAuthorization(
     options: authOptions,
     completionHandler: { _, _ in }
   )
   application.registerForRemoteNotifications()
   ```

4. Implement the messaging delegate:
   ```swift
   extension AppDelegate: MessagingDelegate {
     func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
       // Send token to your PWA via JavaScript bridge
       if let token = fcmToken {
         webView?.evaluateJavaScript("window.receiveFCMToken('\(token)')")
       }
     }
   }
   ```

#### Step 3: Backend Integration
Your notification backend needs to:
1. Accept FCM tokens for iOS devices
2. Use Firebase Admin SDK to send notifications to iOS devices
3. Continue using Web Push for Android/browser users

#### Step 4: PWA Code Integration
The `NativePushService` (`src/app/services/native-push.service.ts`) provides:
- Detection of native iOS context
- Bridge to receive FCM tokens from native app
- Methods to register tokens with your backend

### Alternative: Hybrid Approach

For simpler implementation, consider:

1. **Keep Web Push for Android/Browser** - Works with TWA notification delegation
2. **Use FCM only for iOS** - Requires native integration
3. **Or use a service like OneSignal** - Handles the complexity for you

## Backend Requirements

Your notification backend should support:

1. **Web Push** (for browsers and Android TWA)
   - VAPID keys
   - Web Push subscription storage
   - Push notification sending

2. **FCM** (for iOS native)
   - Firebase Admin SDK
   - FCM token storage
   - FCM notification sending

### Example Backend Flow

```
User Device          Your PWA              Your Backend
    |                   |                      |
    |-- Enable Push --->|                      |
    |                   |-- Register Device -->|
    |                   |   (Web Push sub or   |
    |                   |    FCM token)        |
    |                   |                      |
    |<--- Push Event ---|<-- Send Notification-|
    |                   |   (via VAPID or FCM) |
```

## Testing Checklist

### Android TWA
- [ ] Notification delegation enabled in twa-manifest.json
- [ ] assetlinks.json deployed and accessible
- [ ] Service worker handles push events
- [ ] App appears without browser address bar (TWA verified)
- [ ] Push notifications display when app is in background

### iOS
- [ ] Firebase project configured
- [ ] GoogleService-Info.plist added to Xcode project
- [ ] FCM dependencies installed
- [ ] AppDelegate configured for FCM
- [ ] JavaScript bridge working (token received in PWA)
- [ ] Backend accepts and stores FCM tokens
- [ ] Backend can send FCM notifications
- [ ] Notifications appear on device

## Troubleshooting

### Android: Notifications not working
1. Check if notification delegation is enabled
2. Verify assetlinks.json is accessible
3. Ensure the SHA-256 fingerprint matches
4. Check if Chrome has notification permissions

### iOS: Notifications not working
1. Verify Firebase is properly configured
2. Check APNs certificates in Apple Developer Portal
3. Ensure FCM token is being received
4. Verify backend is sending via FCM, not Web Push

## Resources

- [PWABuilder Android Documentation](https://docs.pwabuilder.com/#/builder/android)
- [PWABuilder iOS Documentation](https://docs.pwabuilder.com/#/builder/app-store)
- [Firebase Cloud Messaging for iOS](https://firebase.google.com/docs/cloud-messaging/ios/client)
- [TWA Documentation](https://developer.chrome.com/docs/android/trusted-web-activity/)
