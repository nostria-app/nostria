# Zap Notification Navigation Fix

## Issue

When clicking on zap notifications, the app navigated to the zap receipt event (kind 9735) instead of the useful destination:
- **Event zaps**: Should navigate to the zapped event (the note that was zapped)
- **Profile zaps**: Should navigate to the recipient's profile (your profile)

The zap receipt event is not useful to view because it's connected to the Lightning node's pubkey, not the user.

## Root Cause

The `eventId` field in zap notifications was set to the zap receipt event ID (`event.id` from kind 9735 event), which is the technical payment receipt. While the actual zapped event ID was correctly extracted and stored in `metadata.zappedEventId`, it wasn't being used for navigation.

### Why This Happened

Zaps in Nostr have a two-level structure:
1. **Zap Receipt (kind 9735)**: The payment receipt from the Lightning node
   - Contains the `pubkey` of the Lightning service (not the zapper)
   - Contains a `description` tag with the embedded zap request
   
2. **Zap Request (kind 9734)**: The user's actual zap intent (embedded in description)
   - Contains the real zapper's `pubkey`
   - Contains an optional `e` tag pointing to the zapped event (if zapping a note)
   - If no `e` tag, it's a profile zap (zapping the user's profile directly)

The navigation was using the outer event (zap receipt) instead of the inner event reference (zapped event).

## Solution

### 1. Use Zapped Event ID for Navigation

Changed the `eventId` field in zap notifications to use the zapped event ID instead of the zap receipt ID:

**Before:**
```typescript
eventId: event.id, // The zap receipt ID (kind 9735) - not useful
```

**After:**
```typescript
eventId: zapRequestEventId, // The zapped event ID (undefined for profile zaps)
```

This means:
- **Event zaps**: `eventId` contains the zapped note's ID → clicking navigates to that note
- **Profile zaps**: `eventId` is `undefined` → triggers special handling

### 2. Store Recipient Pubkey for Profile Zaps

Added `recipientPubkey` to metadata for profile zaps to enable navigation to the recipient's profile:

```typescript
metadata: {
  zapAmount,
  zappedEventId: zapRequestEventId,      // Same as eventId (for reference)
  zapReceiptId: event.id,                // Original receipt ID (for debugging)
  recipientPubkey: pubkey,               // Recipient for profile zap navigation
}
```

### 3. Update Navigation Logic

Enhanced the `viewEvent` method in both locations to handle profile zaps:

**notifications.component.ts:**
```typescript
viewEvent(notification: Notification): void {
  const contentNotif = notification as ContentNotification;
  
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

**app.ts (toolbar notifications):**
Same logic applied to the toolbar notification click handler.

### 4. Make Profile Zaps Clickable

Updated `getEventId` helper to return a placeholder for profile zaps, making them clickable:

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
      return 'profile-zap'; // Placeholder to indicate clickable
    }
  }
  return undefined;
}
```

### 5. Update Notification ID Generation

For profile zaps without an `eventId`, use the zap receipt ID to ensure unique notification IDs:

```typescript
const notificationId = data.eventId
  ? `content-${data.type}-${data.eventId}`
  : data.metadata?.zapReceiptId
    ? `content-${data.type}-${data.metadata.zapReceiptId}`
    : `content-${data.type}-${data.authorPubkey}-${data.timestamp}`;
```

### 6. Update Type Definitions

Extended `ContentNotification` metadata interface:

```typescript
metadata?: {
  content?: string;              // For mentions/replies
  reactionContent?: string;       // For reactions
  zapAmount?: number;             // For zaps: amount in sats
  zappedEventId?: string;         // For zaps: event that was zapped (if any)
  zapReceiptId?: string;          // For zaps: zap receipt event ID (kind 9735)
  recipientPubkey?: string;       // For profile zaps: recipient's pubkey
};
```

## Files Modified

### 1. `content-notification.service.ts`

**Changes:**
- Set `eventId` to `zapRequestEventId` instead of `event.id`
- Added `zapReceiptId` and `recipientPubkey` to metadata
- Updated notification ID generation logic
- Updated `createContentNotification` parameter types

### 2. `notifications.component.ts`

**Changes:**
- Enhanced `viewEvent()` to handle profile zaps
- Updated `getEventId()` to make profile zaps clickable

### 3. `app.ts`

**Changes:**
- Enhanced `onNotificationClick()` to handle profile zaps (toolbar menu)

### 4. `storage.service.ts`

**Changes:**
- Extended `ContentNotification` interface metadata type

## Behavior

### Event Zaps (With Zapped Event)

**Before:**
1. User clicks zap notification
2. Navigates to `/e/{zap-receipt-id}` (kind 9735)
3. Shows Lightning node event (confusing, not useful)

**After:**
1. User clicks zap notification
2. Navigates to `/e/{zapped-event-id}` (kind 1, etc.)
3. Shows the actual note that was zapped ✅

### Profile Zaps (No Specific Event)

**Before:**
1. User clicks zap notification
2. Navigates to `/e/{zap-receipt-id}` (kind 9735)
3. Shows Lightning node event (confusing, not useful)

**After:**
1. User clicks zap notification
2. Navigates to `/p/{recipient-npub}` (your profile)
3. Shows your profile where the zap was received ✅

### Profile Button (Already Working)

The profile button on zap notifications already worked correctly because it used `authorPubkey` which was properly set to the zapper's pubkey (not the Lightning node).

**Behavior:**
1. User clicks profile button (person icon) on zap notification
2. Navigates to `/p/{zapper-npub}`
3. Shows the profile of the person who sent the zap ✅

## Navigation Summary

| Zap Type | Click Action | Destination | Shows |
|----------|--------------|-------------|-------|
| **Event zap** | Click notification body | `/e/{zapped-event-id}` | The note that was zapped |
| **Event zap** | Click profile button | `/p/{zapper-npub}` | Who sent the zap |
| **Profile zap** | Click notification body | `/p/{recipient-npub}` | Your profile (where zap was received) |
| **Profile zap** | Click profile button | `/p/{zapper-npub}` | Who sent the zap |

## Technical Details

### Zap Structure Example

**Zap Receipt (kind 9735):**
```json
{
  "id": "zap-receipt-id",
  "pubkey": "lightning-node-pubkey",  // Not the zapper!
  "kind": 9735,
  "tags": [
    ["p", "recipient-pubkey"],
    ["description", "{\"id\":\"zap-request-id\",\"pubkey\":\"actual-zapper-pubkey\",\"tags\":[[\"e\",\"zapped-event-id\"],[\"p\",\"recipient-pubkey\"]]}"],
    ["bolt11", "lnbc..."]
  ]
}
```

**Extracted Data:**
- `event.pubkey`: Lightning node (not useful for navigation)
- `zapRequest.pubkey`: Actual zapper → stored in `authorPubkey` ✅
- `zapRequest.tags[e]`: Zapped event ID → stored in `eventId` ✅
- `zapRequest.tags[p]`: Recipient → stored in `recipientPubkey` ✅

### Notification ID Uniqueness

**Priority for ID generation:**
1. **Zapped event ID** (preferred for event zaps)
2. **Zap receipt ID** (fallback for profile zaps)
3. **Timestamp-based** (fallback if both are missing)

This ensures:
- Each unique zap event has a unique notification ID
- No duplicate notifications for the same zap
- Profile zaps don't collide with each other

## Testing Recommendations

### 1. Event Zap Navigation Test

**Setup:**
1. Create a note and share it
2. Have someone zap the note
3. Wait for notification to appear

**Test:**
1. Click on the zap notification body
2. **Expected**: Navigate to the zapped note
3. **Verify**: The note shown is the one that was zapped
4. Click the profile button on the notification
5. **Expected**: Navigate to the zapper's profile
6. **Verify**: Shows the person who sent the zap

### 2. Profile Zap Navigation Test

**Setup:**
1. Have someone zap your profile directly (not a specific note)
2. Wait for notification to appear

**Test:**
1. Click on the zap notification body
2. **Expected**: Navigate to your profile
3. **Verify**: Your profile is displayed
4. Click the profile button on the notification
5. **Expected**: Navigate to the zapper's profile
6. **Verify**: Shows the person who sent the zap

### 3. Toolbar Notification Test

**Test:**
1. Click the notification icon in the toolbar
2. Click on a zap notification in the dropdown
3. **Expected**: Same navigation as main notification page
4. **Verify**: Event zaps go to event, profile zaps go to profile

### 4. Multiple Zaps Test

**Setup:**
1. Receive multiple zaps on the same note
2. Receive multiple profile zaps

**Test:**
1. Verify each zap creates a unique notification
2. Verify clicking each notification navigates correctly
3. Verify no duplicate notifications

## Edge Cases Handled

### 1. Missing Zap Request
If the description tag is missing or unparseable:
- ~~Falls back to using zap receipt event ID~~ (old behavior)
- **New**: `eventId` will be `undefined` for profile zaps
- Navigation will still work using `recipientPubkey`

### 2. Malformed Zap Request
If the zap request JSON is invalid:
- ~~Falls back to using zap receipt event ID~~ (old behavior)
- **New**: `eventId` will be `undefined`
- `recipientPubkey` is always available from the query (`#p` tag)
- Navigation will go to recipient's profile

### 3. Missing `e` Tag (Profile Zap)
If there's no `e` tag in the zap request (profile zap):
- `eventId` is `undefined` (correct)
- `recipientPubkey` is set (from query pubkey)
- Navigation goes to recipient's profile ✅

### 4. Multiple `e` Tags
If there are multiple `e` tags in the zap request:
- Uses the first one (standard Nostr behavior)
- Could be enhanced to use the `marker` field to identify the main event

## Future Enhancements

### 1. Show Zap Context in Notification

Could enhance the notification message to show context:
```typescript
message: zapAmount > 0 
  ? zapRequestEventId 
    ? `${zapAmount} sats on your note`
    : `${zapAmount} sats on your profile`
  : zapRequestEventId
    ? 'Zapped your note'
    : 'Zapped your profile'
```

### 2. Support Multiple Event References

Some zaps might reference multiple events (threads, replies, etc.):
```typescript
// Extract all e tags and handle them appropriately
const eTags = zapRequest.tags?.filter((t: string[]) => t[0] === 'e');
const rootEvent = eTags.find((t: string[]) => t[3] === 'root');
const replyEvent = eTags.find((t: string[]) => t[3] === 'reply');
```

### 3. Add Zap Type Indicator

Show visual indicator for event vs profile zaps:
```html
<mat-icon *ngIf="notification.metadata?.zappedEventId">note</mat-icon>
<mat-icon *ngIf="!notification.metadata?.zappedEventId">person</mat-icon>
```

### 4. Quick Preview on Hover

Show preview of the zapped event or profile on hover:
```typescript
async previewZappedEvent(eventId: string): Promise<void> {
  const event = await this.nostr.getEventById(eventId);
  // Show in tooltip or popover
}
```

## Performance Considerations

### No Additional Network Requests

This fix doesn't add any additional network requests:
- All data is already being fetched (zap receipt events)
- All data is already being parsed (description tag)
- Only change is which ID to use for navigation

### Storage Impact

Minimal additional storage:
- `zapReceiptId`: ~64 bytes per zap (optional, for debugging)
- `recipientPubkey`: ~64 bytes per zap (only for profile zaps)
- Total: ~128 bytes per notification (negligible)

### Navigation Performance

Improved navigation performance:
- Event zaps navigate directly to cached event (if available)
- Profile zaps navigate to already-loaded profile (if current user)
- No unnecessary loading of zap receipt events

## Known Limitations

### 1. Zap Receipts Still Accessible

The zap receipt event is still stored (in `metadata.zapReceiptId`) but not used for navigation. If needed for debugging, it can be accessed programmatically.

### 2. Multiple Event References Not Supported

If a zap references multiple events (rare), only the first one is used. This matches standard Nostr client behavior but could be enhanced.

### 3. No Visual Distinction

Event zaps and profile zaps look the same in the notification list. Could be enhanced with icons or labels.

## Compatibility

### Backward Compatibility

Existing notifications in storage will continue to work:
- Old notifications with zap receipt IDs in `eventId` will navigate to those events
- Not ideal but won't break
- New notifications will use the correct event IDs

### Forward Compatibility

This change is forward-compatible:
- Stores both `zappedEventId` and `zapReceiptId` for reference
- Can add more sophisticated navigation logic later
- Type definitions are extensible

## Conclusion

This fix significantly improves the user experience when interacting with zap notifications. Users can now quickly navigate to:
- **The content they created** that received zaps (event zaps)
- **Their profile** where they received direct zaps (profile zaps)
- **The person who zapped them** (via profile button)

The navigation is now intuitive and useful, making it easy to see context for zaps received and engage with the zapper or the zapped content.

**Result**: Zap notifications are now actionable and contextual, not dead ends leading to Lightning node events.
