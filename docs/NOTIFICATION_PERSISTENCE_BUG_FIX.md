# Notification Persistence Bug Fix

## Problem
Users reported that content notifications kept coming back as unread even after using "Mark All Read" or "Clear all". The notifications would reappear after app restart or when the periodic check ran.

## Root Cause
The issue was related to the `notificationLastCheck` timestamp not being updated when users performed bulk actions on notifications:

1. **"Mark All Read"** - Would mark all notifications as read in storage, but wouldn't update the `notificationLastCheck` timestamp
2. **"Clear all"** - Would clear all notifications from storage, but wouldn't update the `notificationLastCheck` timestamp

When the `ContentNotificationService` performed its periodic check or on app restart, it would use the old `notificationLastCheck` timestamp to query relays. This meant it would re-fetch all the same notifications that were just marked as read or cleared, since the `since` parameter in relay queries was still pointing to the old timestamp.

## Solution

### 1. Update Timestamp on Bulk Actions
Modified `notifications.component.ts` to update the `notificationLastCheck` timestamp when:
- User clicks "Mark All Read" - Updates timestamp to current time (in seconds)
- User clicks "Clear all" - Updates timestamp to current time (in seconds)

This ensures that future notification checks will only fetch events that occurred AFTER these actions.

```typescript
markAllAsRead(): void {
  for (const notification of this.notifications()) {
    if (!notification.read) {
      this.markAsRead(notification.id);
    }
  }
  
  // Update the notification last check timestamp to now
  const pubkey = this.accountState.pubkey();
  if (pubkey) {
    const now = Math.floor(Date.now() / 1000); // Nostr uses seconds
    this.accountLocalState.setNotificationLastCheck(pubkey, now);
  }
}

clearNotifications(): void {
  this.notificationService.clearNotifications();
  
  // Update the notification last check timestamp to now
  const pubkey = this.accountState.pubkey();
  if (pubkey) {
    const now = Math.floor(Date.now() / 1000); // Nostr uses seconds
    this.accountLocalState.setNotificationLastCheck(pubkey, now);
  }
}
```

### 2. Account-Specific Notification Clearing
Modified `notification.service.ts` to clear only notifications for the current account instead of all notifications:

```typescript
clearNotifications(): void {
  const pubkey = this.accountState.pubkey();
  
  if (pubkey) {
    // Only clear notifications for the current account
    this._notifications.update(notifications => 
      notifications.filter(n => n.recipientPubkey !== pubkey)
    );
    
    // Delete each notification for this account from storage
    this.storage.getAllNotificationsForPubkey(pubkey)
      .then(notifications => {
        return Promise.all(
          notifications.map(n => this.storage.deleteNotification(n.id))
        );
      })
      .catch(error => this.logger.error('Failed to clear notifications from storage', error));
  } else {
    // No account, clear all (legacy behavior)
    this._notifications.set([]);
    this.storage.clearAllNotifications()
      .catch(error => this.logger.error('Failed to clear notifications from storage', error));
  }
}
```

This prevents accidentally clearing notifications from other accounts when multiple accounts are configured.

## Technical Details

### Timestamp Storage
The `notificationLastCheck` timestamp is stored per-account in `AccountLocalState`:
- Key: `nostria-state` in localStorage
- Structure: `{ [pubkey]: { notificationLastCheck: number, ... } }`
- Value: Unix timestamp in **seconds** (not milliseconds, as Nostr uses seconds)

### Notification Fetching
The `ContentNotificationService.checkForNewNotifications()` method uses this timestamp as the `since` parameter when querying relays:

```typescript
async checkForNewNotifications(limitDays?: number): Promise<void> {
  let since = this._lastCheckTimestamp(); // Gets notificationLastCheck from storage
  const now = Math.floor(Date.now() / 1000); // Nostr uses seconds
  
  // Query relays with since parameter
  await this.accountRelay.getMany({
    kinds: [kinds.ShortTextNote],
    '#p': [pubkey],
    since, // Only fetch events after this timestamp
    limit: 500,
  });
  
  // Update timestamp after successful check
  await this.updateLastCheckTimestamp(now);
}
```

## Files Changed
1. `src/app/pages/notifications/notifications.component.ts`
   - Added imports for `ContentNotificationService`, `AccountStateService`, and `AccountLocalStateService`
   - Updated `markAllAsRead()` to set timestamp
   - Updated `clearNotifications()` to set timestamp

2. `src/app/services/notification.service.ts`
   - Updated `clearNotifications()` to clear only current account's notifications
   - Improved multi-account support

## Testing Recommendations
1. Mark all notifications as read, restart app → notifications should not reappear
2. Clear all notifications, restart app → notifications should not reappear
3. With multiple accounts:
   - Switch to Account A, mark all as read
   - Switch to Account B, verify notifications still exist
   - Switch back to Account A, verify notifications stay read
4. Generate new notifications after marking as read → only new notifications should appear

## Related Files
- `src/app/services/content-notification.service.ts` - Fetches notifications from relays
- `src/app/services/account-local-state.service.ts` - Stores per-account state including timestamp
- `src/app/services/storage.service.ts` - IndexedDB storage for notifications
