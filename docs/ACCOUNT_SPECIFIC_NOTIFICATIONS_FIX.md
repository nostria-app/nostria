# Account-Specific Notifications Fix

## Problem
Notifications were not being filtered by the current account's public key (pubkey). When switching between accounts, all notifications from all accounts were displayed in the toolbar, making it impossible to distinguish which notifications belonged to which account.

## Root Cause
The notification system was storing notifications in IndexedDB without any association to a specific account. The `Notification` interface did not include a field to track which account received each notification, and the loading logic did not filter notifications by the current account.

## Solution
Implemented a comprehensive fix that:

1. **Added `recipientPubkey` field** to the `Notification` interface in `storage.service.ts`
   - This field stores the public key of the account that received the notification
   - Made optional for backward compatibility

2. **Updated database schema** (version 5)
   - Added a new index `by-recipient` on the `recipientPubkey` field in the notifications object store
   - This enables efficient querying of notifications by account
   - Existing notifications are cleared during upgrade since they lack the `recipientPubkey` field

3. **Modified notification creation** in `content-notification.service.ts`
   - Updated `createContentNotification()` to require and store `recipientPubkey`
   - Updated all notification type checks (followers, mentions, reposts, replies, reactions, zaps) to pass the current account's pubkey

4. **Added filtered query method** in `storage.service.ts`
   - Created `getAllNotificationsForPubkey(pubkey: string)` method
   - Queries notifications using the `by-recipient` index
   - Returns only notifications for the specified account

5. **Updated NotificationService** to filter by account
   - Injected `AccountStateService` to track the current account
   - Modified `loadNotifications()` to use the filtered query when an account is logged in
   - Added an effect to automatically reload notifications when the account changes

## Files Modified

- `src/app/services/storage.service.ts`
  - Added `recipientPubkey?: string` to `Notification` interface
  - Updated `NostriaDBSchema` to include `by-recipient` index
  - Incremented `DB_VERSION` from 4 to 5
  - Added database upgrade logic for version 5
  - Created `getAllNotificationsForPubkey()` method

- `src/app/services/content-notification.service.ts`
  - Updated `createContentNotification()` parameter interface to require `recipientPubkey`
  - Modified all calls to `createContentNotification()` in:
    - `checkForNewFollowers()`
    - `checkForMentions()`
    - `checkForReposts()`
    - `checkForReplies()`
    - `checkForReactions()`
    - `checkForZaps()`

- `src/app/services/notification.service.ts`
  - Injected `AccountStateService`
  - Added effect to reload notifications when account changes
  - Updated `loadNotifications()` to filter by current account's pubkey

## Testing
When switching between accounts:
1. Each account should now see only its own notifications in the toolbar
2. The notification badge count should reflect only the current account's unread notifications
3. Notifications should automatically reload when switching accounts
4. New notifications created after this fix will be properly associated with the account that received them

## Database Migration Notes
- **Version**: Database schema upgraded from version 4 to version 5
- **Data Loss**: Existing notifications will be cleared during the upgrade since they don't have the `recipientPubkey` field
- **Impact**: Users will need to receive new notifications after the update, but this is acceptable since old notifications couldn't be properly attributed to accounts anyway

## Future Considerations
- Consider migrating existing notifications by attempting to infer the recipient from the notification metadata
- Add UI to view notifications from all accounts (with clear labeling)
- Implement notification settings per account
