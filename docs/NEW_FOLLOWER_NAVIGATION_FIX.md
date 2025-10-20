# New Follower Notification Navigation Fix

**Date**: 2025-10-20  
**Component**: `notifications.component.ts`  
**Issue**: New follower notifications navigated to kind 3 contact list event instead of follower's profile

## Problem

When users clicked on "New follower" notifications, the app navigated to the kind 3 (contact list) event details page, which was not useful because:
- Kind 3 events are contact lists (following lists) in Nostr
- Viewing the raw event doesn't provide meaningful information to users
- Users want to see **who** followed them, not the technical event

### Expected Behavior

Clicking a "New follower" notification should navigate to the **follower's profile** so users can:
- See who followed them
- View their posts and activity
- Decide whether to follow back
- Interact with the new follower

## Root Cause

The `viewEvent()` method in `notifications.component.ts` had a generic handler that navigated to event details for all notifications with an `eventId`:

```typescript
// BEFORE - Generic handler sent all events to event details page
viewEvent(notification: Notification): void {
  const contentNotif = notification as ContentNotification;

  // For zaps with a specific event, navigate to that event
  if (contentNotif.eventId && contentNotif.authorPubkey) {
    const neventId = nip19.neventEncode({
      id: contentNotif.eventId,
      author: contentNotif.authorPubkey,
    });
    this.router.navigate(['/e', neventId]); // ❌ Kind 3 event details
    return;
  }
  // ...
}
```

Since "New follower" notifications store the kind 3 event ID in `eventId`, the generic handler would navigate to the contact list event page instead of the follower's profile.

## Solution

Added a special case handler for `NEW_FOLLOWER` notifications that navigates to the follower's profile instead:

```typescript
// AFTER - Special handler for new follower notifications
viewEvent(notification: Notification): void {
  const contentNotif = notification as ContentNotification;

  // For new follower notifications, navigate to the follower's profile
  if (contentNotif.type === NotificationType.NEW_FOLLOWER && contentNotif.authorPubkey) {
    this.router.navigate(['/p', contentNotif.authorPubkey]); // ✅ Follower's profile
    return;
  }

  // For zaps with a specific event, navigate to that event
  if (contentNotif.eventId && contentNotif.authorPubkey) {
    const neventId = nip19.neventEncode({
      id: contentNotif.eventId,
      author: contentNotif.authorPubkey,
    });
    this.router.navigate(['/e', neventId]);
    return;
  }

  // For profile zaps (no specific event), navigate to recipient's profile
  if (contentNotif.type === NotificationType.ZAP && contentNotif.metadata?.recipientPubkey) {
    const npubId = nip19.npubEncode(contentNotif.metadata.recipientPubkey);
    this.router.navigate(['/p', npubId]);
  }
}
```

### Handler Priority

The handlers are checked in this order:
1. **NEW_FOLLOWER** → Navigate to follower's profile
2. **Event with ID** → Navigate to event details (for replies, mentions, reposts, reactions)
3. **Profile zap** → Navigate to recipient's profile

This ensures new follower notifications are handled before the generic event handler.

## Additional Safety Check

Also updated `getEventId()` to ensure new follower notifications are always clickable, even if the `eventId` is missing:

```typescript
getEventId(notification: Notification): string | undefined {
  if (this.isContentNotificationWithData(notification)) {
    const contentNotif = notification as ContentNotification;

    // If there's an eventId, return it
    if (contentNotif.eventId) {
      return contentNotif.eventId;
    }

    // For profile zaps without an eventId, return a placeholder to indicate it's clickable
    if (contentNotif.type === NotificationType.ZAP && contentNotif.metadata?.recipientPubkey) {
      return 'profile-zap';
    }

    // For new follower notifications, always clickable (navigate to follower's profile)
    if (contentNotif.type === NotificationType.NEW_FOLLOWER && contentNotif.authorPubkey) {
      return 'new-follower'; // ✅ Placeholder to indicate clickable
    }
  }
  return undefined;
}
```

This ensures the notification item receives the `clickable` class and is visually indicated as interactive.

## How New Follower Notifications Work

### Data Flow

1. **Detection** (`content-notification.service.ts`):
   ```typescript
   private async checkForNewFollowers(pubkey: string, since: number): Promise<void> {
     // Query for kind 3 (contact list) events that include this user's pubkey
     const events = await this.accountRelay.getMany({
       kinds: [kinds.Contacts], // Kind 3
       '#p': [pubkey],
       since,
       limit: NOTIFICATION_QUERY_LIMITS.FOLLOWERS,
     });

     for (const event of events) {
       if (isFollowing) {
         await this.createContentNotification({
           type: NotificationType.NEW_FOLLOWER,
           title: 'New follower',
           message: 'Someone started following you',
           authorPubkey: event.pubkey, // ✅ The follower's pubkey
           eventId: event.id,           // The kind 3 event (not needed for UI)
           timestamp: event.created_at * 1000,
         });
       }
     }
   }
   ```

2. **Storage**: Notification stored with:
   - `authorPubkey`: The person who followed you
   - `eventId`: The kind 3 contact list event (technical reference)

3. **Display**: Notification shown in UI with follower info

4. **Navigation**: Click → Navigate to `authorPubkey` profile

### Why eventId is Still Stored

The kind 3 `eventId` is kept for:
- Deduplication (prevent duplicate follow notifications)
- Technical auditing
- Potential future features (e.g., viewing follow timestamp)

But it's **not used for navigation** anymore.

## Impact

### Before Fix
- ❌ Clicking "New follower" → Kind 3 event details page
- ❌ Confusing technical event view
- ❌ Users couldn't easily see who followed them
- ❌ Required manual navigation to find the follower

### After Fix
- ✅ Clicking "New follower" → Follower's profile page
- ✅ Immediate access to follower information
- ✅ Can follow back with one click
- ✅ Can view follower's posts and activity
- ✅ Consistent with user expectations

## Related Notification Types

This fix is similar to the profile zap navigation fix implemented earlier:

| Notification Type | Navigation Target | Reason |
|------------------|-------------------|---------|
| **New Follower** | Follower's profile | See who followed you |
| **Profile Zap** | Recipient's profile | See who was zapped |
| **Mention** | Event with mention | See the post mentioning you |
| **Reply** | Reply event | See the reply to your post |
| **Reaction** | Event that was reacted to | See which post got a reaction |
| **Repost** | Event that was reposted | See which post was reposted |
| **Zap (on event)** | Zapped event | See which post was zapped |

## Testing

### Verification Steps

1. **Get a new follower**:
   - Have someone follow you on Nostr
   - Wait for notification to appear (or trigger refresh)

2. **Check notification**:
   - Should show "New follower" notification
   - Should have follower icon and message

3. **Click notification**:
   - Should navigate to `/p/{follower-pubkey}`
   - Should show follower's profile page
   - Should display follower's name, avatar, posts

4. **Verify clickability**:
   - Notification should have `clickable` class
   - Cursor should change to pointer on hover
   - Should have visual feedback on hover

### Edge Cases

1. **Missing authorPubkey**: Notification won't be clickable (fallback behavior)
2. **Deleted profile**: Navigation still works, profile page shows "user not found"
3. **Multiple followers**: Each notification navigates to respective follower

## Files Modified

- `src/app/pages/notifications/notifications.component.ts`
  - `viewEvent()`: Added NEW_FOLLOWER handler before generic event handler
  - `getEventId()`: Added NEW_FOLLOWER fallback for clickability
- `src/app/app.ts`
  - `onNotificationClick()`: Added NEW_FOLLOWER handler for toolbar notification clicks

## Implementation Details

The fix was applied in **two locations** where notification clicks are handled:

### 1. Notifications Page (`notifications.component.ts`)

Handles clicks when viewing the full notifications page:

```typescript
viewEvent(notification: Notification): void {
  const contentNotif = notification as ContentNotification;

  // For new follower notifications, navigate to the follower's profile
  if (contentNotif.type === NotificationType.NEW_FOLLOWER && contentNotif.authorPubkey) {
    this.router.navigate(['/p', contentNotif.authorPubkey]);
    return;
  }
  // ... other handlers
}
```

### 2. Toolbar Notifications Menu (`app.ts`)

Handles clicks from the notification dropdown in the toolbar:

```typescript
onNotificationClick(notification: Notification, event: MouseEvent): void {
  // Close the menu
  this.notificationMenuTrigger?.closeMenu();

  if (this.isContentNotification(notification)) {
    const contentNotif = notification as ContentNotification;

    // For new follower notifications, navigate to the follower's profile
    if (contentNotif.type === NotificationType.NEW_FOLLOWER && contentNotif.authorPubkey) {
      this.router.navigate(['/p', contentNotif.authorPubkey]);
      return;
    }
    // ... other handlers
  }
}
```

Both handlers now provide consistent navigation behavior for new follower notifications.

## Related Documentation

- `ZAP_NOTIFICATION_NAVIGATION_FIX.md` - Similar fix for zap notifications
- `CONTENT_NOTIFICATIONS_SUMMARY.md` - Overall notification system architecture
- `NOTIFICATION_ACTIVITY_FILTER.md` - Notification filtering system
