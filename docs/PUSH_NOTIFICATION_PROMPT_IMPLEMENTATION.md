# Push Notification Prompt Implementation

## Overview
This implementation adds a user-friendly push notification prompt system that introduces users to push notifications after they've used the app 5 times.

## Changes Made

### 1. Account Local State Service (`account-local-state.service.ts`)
- **Added `launchCount` property** to `AccountLocalState` interface to track app launches per account
- **Added `getLaunchCount(pubkey)`**: Returns the current launch count for an account
- **Added `incrementLaunchCount(pubkey)`**: Increments and returns the new launch count

### 2. Push Notification Prompt Component
Created a new bottom sheet component to prompt users about enabling push notifications:

**Files:**
- `push-notification-prompt.component.ts`
- `push-notification-prompt.component.html`
- `push-notification-prompt.component.scss`

**Features:**
- Displays an attractive prompt with notification icon
- Explains the benefits of push notifications
- Provides "Maybe Later" and "Enable Notifications" buttons
- Navigates to notification settings when user clicks "Enable"
- Supports both light and dark themes
- Responsive design for mobile devices

### 3. App Component (`app.ts`)

#### Imports Added:
- `WebPushService` - to check push notification status
- `PushNotificationPromptComponent` - the bottom sheet component
- `isPlatformBrowser` - to check if running in browser

#### New Properties:
- `webPushService` - injected service for push notification management
- `pushPromptShown` - signal to track if prompt has been shown in current session

#### New Methods:
- **`isPushNotificationEnabled()`**: Checks if push notifications are currently enabled
- **`enablePushNotifications()`**: Navigates to notification settings page
- **`showPushNotificationPrompt()`**: Opens the bottom sheet with push notification prompt
- **`getNotificationIcon(type)`**: Returns appropriate icon for each notification type

#### Logic in `ngOnInit()`:
After app initialization for authenticated users:
1. Increments launch count for current account
2. Checks if launch count >= 5
3. Checks if prompt hasn't been shown this session
4. Checks if push notifications are NOT enabled
5. If all conditions met, shows bottom sheet after 3-second delay

### 4. App Template (`app.html`)

Added "Enable Push Notifications" button to notification menu:
- Appears only when push notifications are NOT enabled
- Clicking navigates to notification settings
- Placed between notification list and "What's New" menu item

## User Experience Flow

1. **First 4 launches**: User uses app normally, launch counter increments silently
2. **5th launch and beyond**:
   - If push notifications NOT enabled:
     - After 3 seconds, bottom sheet appears from bottom of screen
     - User can dismiss with "Maybe Later" or enable with "Enable Notifications"
   - Prompt only shows once per app session
   - Button always available in notification menu

3. **Notification Menu**:
   - Users can enable push notifications anytime via the menu button
   - Button only visible when push notifications are disabled

## Design Decisions

1. **Launch counter is per-account**: Different accounts have separate launch counts
2. **3-second delay**: Avoids overwhelming users immediately on startup
3. **Session-based tracking**: Prompt shows max once per app session to avoid annoyance
4. **Non-intrusive**: User can easily dismiss the prompt
5. **Always accessible**: Menu button provides alternative access point
6. **Platform check**: Only works in browser environment (not SSR)

## Testing Recommendations

1. Clear localStorage to reset launch counter
2. Test with multiple accounts to verify per-account tracking
3. Test that prompt doesn't show if notifications already enabled
4. Verify prompt only shows once per session
5. Test navigation to settings works from both prompt and menu
6. Test on mobile devices for responsive design
7. Test in both light and dark themes
