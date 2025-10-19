# Content Notifications Implementation

## Overview

Implemented a comprehensive notification system that separates **Content Notifications** (social interactions) from **System Notifications** (technical messages). Content notifications count toward the notification badge, while system notifications run in the background.

## Terminology

- **Content Notifications** (also called "Activity"): Social interactions from other users (follows, mentions, reposts, replies, reactions, zaps)
- **System Notifications** (also called "Technical"): Application-level messages (relay publishing status, settings changes, errors, warnings)

## Architecture

### New Service: `ContentNotificationService`

Location: `src/app/services/content-notification.service.ts`

This service queries the account relay for new social interactions and generates content notifications.

**Key Features:**
- Checks for new content since last app use
- Queries multiple event types in parallel
- Tracks last check timestamp in local storage
- Prevents duplicate notifications
- Integrates with existing `NotificationService`

**Notification Types Checked:**

1. **New Followers** (Kind 3)
   - Detects when someone adds you to their contact list
   - Shows "Someone started following you"

2. **Mentions** (Kind 1 with 'p' tag)
   - Finds notes where you're mentioned
   - Excludes replies (handled separately)
   - Shows preview of content

3. **Reposts** (Kind 6)
   - Detects when someone reposts your content
   - Shows "Reposted your note"

4. **Replies** (Kind 1 with reply marker)
   - Finds direct replies to your notes
   - Shows preview of reply content

5. **Reactions** (Kind 7)
   - Detects emoji reactions to your content
   - Shows the reaction emoji

6. **Zaps** (Kind 9735)
   - Detects lightning payments sent to you
   - Extracts and shows sat amount

### Updated: `NotificationType` Enum

Location: `src/app/services/storage.service.ts`

```typescript
export enum NotificationType {
  // System notifications (technical, not counted in badge)
  RELAY_PUBLISHING = 'relaypublishing',
  GENERAL = 'general',
  ERROR = 'error',
  SUCCESS = 'success',
  WARNING = 'warning',
  
  // Content notifications (social interactions, counted in badge)
  NEW_FOLLOWER = 'newfollower',
  MENTION = 'mention',
  REPOST = 'repost',
  REPLY = 'reply',
  REACTION = 'reaction',
  ZAP = 'zap',
}
```

### New Interface: `ContentNotification`

Location: `src/app/services/storage.service.ts`

```typescript
export interface ContentNotification extends Notification {
  authorPubkey: string;      // Who triggered the notification
  eventId?: string;          // Related Nostr event ID
  metadata?: {
    content?: string;         // For mentions/replies
    reactionContent?: string; // For reactions (emoji)
    zapAmount?: number;       // For zaps (sats)
  };
}
```

## UI Changes

### Tabbed Interface

The notifications page now has two tabs:

1. **Activity Tab** (Content Notifications)
   - Icon: people
   - Shows follows, mentions, reposts, replies, reactions, zaps
   - Badge shows count
   - Counts toward main notification badge

2. **System Tab** (System Notifications)
   - Icon: settings
   - Shows relay publishing, errors, warnings, success messages
   - Badge shows count (secondary style)
   - Does NOT count toward main notification badge

### Badge Behavior

- **Header Badge**: Only shows count of **unread content notifications**
- **Tab Badges**: Show total count of notifications in each tab
- System notifications are logged but don't disturb the user

### Empty States

Each tab has a custom empty state:
- **Activity**: "No activity yet" - mentions social interactions
- **System**: "No system notifications" - mentions technical messages

## How to Use

### Initializing Content Notifications

```typescript
// In your app initialization (e.g., app.component.ts or main.ts)
const contentNotificationService = inject(ContentNotificationService);

// Initialize the service
await contentNotificationService.initialize();

// Check for new notifications
await contentNotificationService.checkForNewNotifications();
```

### Checking for New Content

The service should be called periodically or when:
- App starts
- User returns to app (from background)
- User pulls to refresh
- Periodically in the background (e.g., every 5 minutes)

```typescript
// Example: Check on app visibility change
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden) {
    await contentNotificationService.checkForNewNotifications();
  }
});
```

### Creating System Notifications

System notifications use the existing `NotificationService`:

```typescript
// Example: Creating a system notification
notificationService.notify(
  'Feeds have been reset',
  'Your feed configuration has been restored to defaults',
  NotificationType.GENERAL
);
```

## Query Details

### Performance Considerations

- All queries use `since` parameter to only fetch new events
- Queries run in parallel for efficiency
- Limited to 50 events per type to prevent overload
- Last check timestamp stored in local storage

### Nostr Protocol Notes

- Timestamps are in **seconds** (Nostr protocol standard)
- Converted to milliseconds for JavaScript `Date` compatibility
- Queries use NIP-01 filters
- Follows NIP-10 for thread/reply detection

## Testing

### Manual Testing Checklist

1. **New Followers**
   - Have someone follow you
   - Check Activity tab for "New follower" notification

2. **Mentions**
   - Have someone mention your npub in a note
   - Check Activity tab for mention with content preview

3. **Reposts**
   - Have someone repost your note
   - Check Activity tab for "Reposted your note"

4. **Replies**
   - Have someone reply to your note
   - Check Activity tab for reply with content

5. **Reactions**
   - Have someone react to your note
   - Check Activity tab for reaction with emoji

6. **System Notifications**
   - Publish a note (triggers relay publishing)
   - Check System tab for relay status

7. **Badge Count**
   - Verify badge only counts Activity notifications
   - Verify badge shows "X new"
   - Mark as read and verify badge updates

### Edge Cases

- No active account → service skips gracefully
- Account relay not initialized → logs warning
- Query failures → logs error, continues with other types
- Duplicate events → prevented by unique notification IDs

## Future Enhancements

### Potential Additions

1. **More Event Types**
   - Long-form content (kind 30023)
   - Channel messages (kind 42)
   - Live activities (kind 30311)
   - Badges (kind 30009)

2. **Filtering & Grouping**
   - Group notifications by type
   - Filter by date range
   - Search notifications
   - Archive old notifications

3. **User Preferences**
   - Toggle notification types on/off
   - Set check frequency
   - Mute specific users
   - Custom notification sounds

4. **Performance**
   - Incremental loading
   - Virtual scrolling for large lists
   - Cache user profiles
   - Background sync worker

5. **Analytics**
   - Track notification engagement
   - Most active followers
   - Popular content

## Files Modified

### Created
- `src/app/services/content-notification.service.ts`
- `docs/CONTENT_NOTIFICATIONS.md` (this file)

### Modified
- `src/app/services/storage.service.ts`
  - Added content notification types to enum
  - Added `ContentNotification` interface
  
- `src/app/services/notification.service.ts`
  - Made `persistNotificationToStorage` public

- `src/app/pages/notifications/notifications.component.ts`
  - Added system/content notification helpers
  - Added computed signals for separated notifications
  - Updated badge count logic

- `src/app/pages/notifications/notifications.component.html`
  - Added tab group with Activity and System tabs
  - Separate empty states per tab
  - Tab badges showing counts

- `src/app/pages/notifications/notifications.component.scss`
  - Added tab styling
  - Added badge styling for tabs

## Integration Points

### Nostr Events

The service integrates with standard Nostr event kinds:
- `kinds.Contacts` (3) - Follow lists
- `kinds.ShortTextNote` (1) - Notes, mentions, replies
- `kinds.Repost` (6) - Reposts
- `kinds.Reaction` (7) - Reactions
- `9735` - Zap receipts

### Services

Depends on:
- `LoggerService` - Logging
- `NotificationService` - Notification storage/display
- `AccountRelayService` - Querying Nostr relays
- `LocalStorageService` - Timestamp persistence
- `AccountStateService` - Current user pubkey

## Troubleshooting

### Notifications Not Appearing

1. Check console for errors
2. Verify account relay is initialized
3. Confirm user has active account
4. Check last check timestamp: `localStorage.getItem('lastNotificationCheck')`
5. Manually trigger: `contentNotificationService.checkForNewNotifications()`

### Duplicate Notifications

- Notification IDs are generated from: `type-authorPubkey-timestamp`
- Should naturally prevent duplicates
- If duplicates occur, check timestamp precision

### Performance Issues

- Reduce `limit` in queries (currently 50)
- Increase check interval
- Implement pagination
- Add debouncing to check calls

## Security Considerations

- No private keys involved (read-only queries)
- Uses existing account relay configuration
- Respects user's relay preferences
- No external API calls
- All data stored locally

## Compliance

- NIP-01: Basic protocol flow
- NIP-10: Reply detection
- NIP-19: npub encoding (for display)
- NIP-57: Zap receipts (kind 9735)
