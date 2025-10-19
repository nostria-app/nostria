# Content Notifications - Quick Start Guide

## What Was Built

A complete notification system that separates:
- **Content Notifications** (Activity): Social interactions from Nostr - follows, mentions, reposts, replies, reactions, zaps
- **System Notifications** (System): Technical messages - relay status, errors, warnings

## How to Integrate

### Step 1: Initialize in Your App Component

Add to `src/app/app.component.ts` (or wherever you initialize services):

```typescript
import { ContentNotificationService } from './services/content-notification.service';
import { Component, OnInit, inject } from '@angular/core';

export class AppComponent implements OnInit {
  private contentNotifications = inject(ContentNotificationService);

  async ngOnInit() {
    // Initialize the service
    await this.contentNotifications.initialize();
    
    // Check for new notifications on startup
    await this.contentNotifications.checkForNewNotifications();
  }
}
```

### Step 2: Add Periodic Checks (Optional)

```typescript
// Check every 5 minutes while app is active
setInterval(async () => {
  await this.contentNotifications.checkForNewNotifications();
}, 5 * 60 * 1000);
```

### Step 3: Check on App Return

```typescript
// Check when user returns to the app
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden) {
    await this.contentNotifications.checkForNewNotifications();
  }
});
```

## What Users Will See

### Notifications Page

1. **Header with Badge**
   - Shows count of NEW content notifications only
   - System notifications don't count toward badge

2. **Two Tabs**
   - **Activity Tab**: Social interactions (with badges)
   - **System Tab**: Technical messages (with secondary badges)

3. **Each Notification Shows**
   - Bell icon
   - Title (e.g., "Mentioned you", "Reposted your note")
   - Optional message/preview
   - Timestamp (e.g., "2h ago")
   - NEW badge if unread
   - Mark as read button
   - Remove button

## Notification Types Generated

### Content Notifications (Activity Tab)

| Type | When | Example Title |
|------|------|---------------|
| New Follower | Someone follows you | "New follower" |
| Mention | Tagged in a note | "Mentioned you" |
| Repost | Your note is reposted | "Reposted your note" |
| Reply | Someone replies to your note | "Replied to your note" |
| Reaction | Someone reacts to your content | "Reacted ❤️" |
| Zap | You receive a zap | "Zapped you" |

### System Notifications (System Tab)

| Type | When | Example Title |
|------|------|---------------|
| Relay Publishing | Publishing to relays | "Publishing to relays" |
| General | App messages | "Feeds have been reset" |
| Error | Something fails | "Failed to load profile" |
| Success | Operation succeeds | "Profile updated" |
| Warning | Potential issues | "Slow relay connection" |

## Testing

### Manual Test

1. **Start the app** - Service initializes
2. **Check console** - Should see "ContentNotificationService initialized"
3. **Navigate to Notifications** - Should see two tabs
4. **Trigger events on Nostr**:
   - Have someone follow you
   - Have someone mention you
   - Have someone reply to your note
5. **Call check** - `contentNotificationService.checkForNewNotifications()`
6. **Verify** - Notifications appear in Activity tab
7. **Check badge** - Only Activity notifications count

### Debug Commands (Browser Console)

```javascript
// Check last check timestamp
localStorage.getItem('lastNotificationCheck')

// Reset (will fetch all notifications again)
localStorage.removeItem('lastNotificationCheck')

// Force check
// (Need to get the service instance first)
```

## Configuration

### Adjust Query Limits

In `content-notification.service.ts`, each query has:
```typescript
limit: 50  // Adjust this to fetch more/fewer events
```

### Adjust Check Frequency

In your app component:
```typescript
setInterval(() => { ... }, 5 * 60 * 1000);  // 5 minutes
//                           ^^^^^^^^^^^^^^
//                           Change this value (in milliseconds)
```

### Disable Specific Notification Types

Comment out the unwanted check in `checkForNewNotifications()`:

```typescript
await Promise.all([
  this.checkForNewFollowers(pubkey, since),
  // this.checkForMentions(pubkey, since),  // Disabled
  this.checkForReposts(pubkey, since),
  // ... etc
]);
```

## Architecture Overview

```
┌─────────────────────────────────────┐
│   ContentNotificationService        │
│   - Queries Nostr relays            │
│   - Detects social interactions     │
│   - Creates notifications           │
└─────────────┬───────────────────────┘
              │
              ↓
┌─────────────────────────────────────┐
│   NotificationService               │
│   - Stores notifications            │
│   - Manages read/unread             │
│   - Persists to IndexedDB           │
└─────────────┬───────────────────────┘
              │
              ↓
┌─────────────────────────────────────┐
│   NotificationsComponent            │
│   - Displays in two tabs            │
│   - Shows badges                    │
│   - Handles user actions            │
└─────────────────────────────────────┘
```

## Performance Expectations

- **Cold start**: 2-5 seconds (first check)
- **Warm checks**: 0.5-2 seconds
- **Network**: 5-50KB per check
- **Storage**: ~500 bytes per notification
- **Queries**: 6 parallel requests to account relay

## Troubleshooting

### No Notifications Appearing

**Check:**
1. Console for errors
2. Account relay is initialized: `accountRelay.getRelayUrls()`
3. Active account exists: `accountState.pubkey()`
4. Last check timestamp: `localStorage.getItem('lastNotificationCheck')`

**Fix:**
- Manually trigger check: `contentNotificationService.checkForNewNotifications()`
- Reset timestamp: `localStorage.removeItem('lastNotificationCheck')`

### Badge Count Wrong

**Check:**
- Notification classification in component
- `isContentNotification()` logic

**Fix:**
- Verify notification types match enum
- Check filter logic in `newNotificationCount` computed

### Too Many Duplicates

**Check:**
- Notification ID generation
- Last check timestamp updating

**Fix:**
- Ensure timestamp is properly saved after check
- Verify unique ID format: `content-${type}-${authorPubkey}-${timestamp}`

## Next Steps

1. ✅ Service created and tested
2. ✅ UI updated with tabs
3. ✅ Documentation complete
4. ⏸️ **Add to app initialization** ← YOU ARE HERE
5. ⏸️ Test with real Nostr events
6. ⏸️ Add pull-to-refresh
7. ⏸️ Add user profile pictures
8. ⏸️ Implement notification preferences

## Need Help?

See full documentation:
- `docs/CONTENT_NOTIFICATIONS.md` - Comprehensive technical docs
- `docs/CONTENT_NOTIFICATIONS_SUMMARY.md` - Complete feature summary

## Code Examples

### Creating System Notifications

```typescript
// In any service/component
notificationService.notify(
  'Settings Updated',
  'Your preferences have been saved',
  NotificationType.SUCCESS
);
```

### Checking Notification Status

```typescript
// Is currently checking?
const checking = contentNotificationService.checking;

// Get all content notifications
const contentNotifs = notificationService.notifications()
  .filter(n => isContentNotification(n.type));

// Count unread
const unreadCount = contentNotifs.filter(n => !n.read).length;
```

### Manually Trigger Check

```typescript
// In any component
private contentNotifications = inject(ContentNotificationService);

async checkNow() {
  await this.contentNotifications.checkForNewNotifications();
}
```

---

**Status**: ✅ Ready to integrate
**Last Updated**: October 19, 2025
