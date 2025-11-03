# Notification Timestamp Bug Fix

## Problem

Old events were being treated as "new" notifications repeatedly, even after they had been processed. This caused the same notifications to reappear in the notification list after app restarts or when checking for new notifications.

## Root Cause

The bug was in the `ContentNotificationService.checkForNewNotifications()` method. It was using an **in-memory signal** (`_lastCheckTimestamp`) to determine the `since` parameter for relay queries instead of reading from **account-specific storage**.

### The Issue

```typescript
// WRONG: Uses in-memory signal (not account-specific)
let since = this._lastCheckTimestamp();
```

This caused several problems:

1. **Account Switch Issues**: When switching between accounts, the in-memory signal was not updated to reflect the new account's last check timestamp
2. **Stale Data**: The signal could become out of sync with the actual storage value
3. **Re-fetching Old Events**: This meant the service would query relays with a stale/incorrect `since` timestamp, fetching old events that had already been processed

### Why It Matters

Nostr relay queries use the `since` parameter to filter events:

```typescript
await this.accountRelay.getMany({
  kinds: [kinds.ShortTextNote],
  '#p': [pubkey],
  since,  // Only fetch events after this timestamp
  limit: 500,
});
```

If `since` is incorrect (too old or zero), the relay returns old events that have already been turned into notifications. Since notification IDs are deterministic (based on event IDs), this creates:

1. Duplicate notification IDs in memory (deduplicated by `addNotification`)
2. But re-saves them to IndexedDB, overwriting the existing ones
3. The notifications appear "new" because they're loaded from storage with their original event timestamps

## Solution

### 1. Always Read from Storage

Changed the code to **always** read the last check timestamp from account-specific storage:

```typescript
// CORRECT: Always read from storage for current account
let since = await this.getLastCheckTimestamp();
```

The `getLastCheckTimestamp()` method correctly reads from `AccountLocalStateService`, which stores timestamps per account:

```typescript
private async getLastCheckTimestamp(): Promise<number> {
  const pubkey = this.accountState.pubkey();
  if (!pubkey) {
    return 0;
  }
  
  const timestamp = this.accountLocalState.getNotificationLastCheck(pubkey);
  return timestamp;
}
```

### 2. Defensive Duplicate Check

Added a defensive check to prevent creating duplicate notifications even if old events are re-fetched:

```typescript
// Check if notification already exists in storage
const existingNotification = await this.storage.getNotification(notificationId);
if (existingNotification) {
  this.logger.debug(`Skipping duplicate notification: ${notificationId} (already exists in storage)`);
  return;
}
```

This prevents re-creating notifications that already exist in IndexedDB.

### 3. Enhanced Logging

Added detailed logging to help debug timestamp issues:

```typescript
this.logger.info(`[getLastCheckTimestamp] Loaded last check timestamp for account ${pubkey.slice(0, 8)}: ${timestamp} (${new Date(timestamp * 1000).toISOString()})`);

this.logger.debug(`Fetching notifications since timestamp: ${since} (${new Date(since * 1000).toISOString()})`);

this.logger.info(`[updateLastCheckTimestamp] Updated last check timestamp for account ${pubkey.slice(0, 8)} to ${timestamp} (${new Date(timestamp * 1000).toISOString()})`);
```

## Files Modified

### `content-notification.service.ts`

**Changes:**

1. **Import**: Added `StorageService` to imports
2. **Service Injection**: Injected `StorageService` to check for existing notifications
3. **checkForNewNotifications()**: Changed to read from storage instead of signal
4. **createContentNotification()**: Added duplicate check before creating notification
5. **getLastCheckTimestamp()**: Enhanced logging with ISO timestamps
6. **updateLastCheckTimestamp()**: Enhanced logging with ISO timestamps

## Technical Details

### Timestamp Storage

Timestamps are stored per-account in `AccountLocalStateService`:

```typescript
interface AccountLocalState {
  notificationLastCheck?: number; // Unix timestamp in seconds
}
```

Storage key pattern: Account pubkey → state object

### Nostr Timestamp Format

**Important**: Nostr uses timestamps in **seconds**, not milliseconds!

```typescript
// Nostr event timestamp (seconds)
event.created_at // e.g., 1730419200

// JavaScript Date.now() (milliseconds)
Date.now() // e.g., 1730419200000

// Conversion
const seconds = Math.floor(Date.now() / 1000);
const milliseconds = event.created_at * 1000;
```

### Notification ID Generation

Notification IDs are deterministic to prevent true duplicates:

```typescript
if (data.type === NotificationType.ZAP && data.metadata?.zapReceiptId) {
  notificationId = `content-${data.type}-${data.metadata.zapReceiptId}`;
} else if (data.eventId) {
  notificationId = `content-${data.type}-${data.eventId}`;
} else {
  notificationId = `content-${data.type}-${data.authorPubkey}-${data.timestamp}`;
}
```

This means:
- Same event ID → Same notification ID
- Already handled by `addNotification()` which checks for duplicates in memory
- Now also checked in storage before creation

## Testing Recommendations

1. **Account Switching**: Switch between accounts and verify notifications are account-specific
2. **App Restart**: Restart app and verify no duplicate notifications appear
3. **Multiple Checks**: Run notification check multiple times, verify no duplicates
4. **Console Logs**: Check logs for timestamp values and verify they're incrementing correctly

## Related Issues

- Account-specific notifications (see `ACCOUNT_SPECIFIC_NOTIFICATIONS_FIX.md`)
- Notification persistence (see `NOTIFICATION_PERSISTENCE_BUG_FIX.md`)
- Notification limit fix (see `NOTIFICATION_LIMIT_FIX.md`)
