# Notification Profile Route and Timestamp Fix

## Issues Fixed

### 1. Profile Route Correction

**Problem:**
The "View Profile" button was navigating to `/people/{npub}` with NIP-19 encoded npub, but the correct route should be `/p/{pubkey}` with raw hex pubkey.

**Solution:**
Changed the route from:
```typescript
// Before
const npub = nip19.npubEncode(contentNotif.authorPubkey);
this.router.navigate(['/people', npub]);

// After
this.router.navigate(['/p', contentNotif.authorPubkey]);
```

**Impact:**
- Profile links now work correctly
- No longer need to encode/decode pubkey for profile navigation
- More efficient (no NIP-19 encoding overhead)
- Consistent with app's routing structure

### 2. Timestamp Display with AgoPipe

**Problem:**
The `formatTimestamp()` method was being used to display relative time, but the app already has a standardized `ago` pipe for this purpose. Using the pipe ensures consistency across the entire application.

**Solution:**
Replaced custom `formatTimestamp()` calls with the `ago` pipe:

```html
<!-- Before -->
<span class="notification-time">{{ formatTimestamp(notification.timestamp) }}</span>

<!-- After -->
<span class="notification-time">{{ notification.timestamp | ago }}</span>
```

**Changes Made:**
1. Imported `AgoPipe` in component
2. Added `AgoPipe` to component's imports array
3. Updated both Activity and System notification templates to use the pipe

**Benefits:**
- Consistent timestamp formatting across entire app
- Automatic updates if pipe logic changes
- Less code to maintain (can remove custom formatTimestamp method)
- Better separation of concerns (formatting logic in pipe, not component)

## Files Modified

### 1. `notifications.component.ts`

**Imports:**
```typescript
import { AgoPipe } from '../../pipes/ago.pipe';
```

**Component imports array:**
```typescript
@Component({
  imports: [
    // ...existing imports...
    AgoPipe,
  ],
})
```

**Profile navigation:**
```typescript
viewAuthorProfile(notification: Notification): void {
  const contentNotif = notification as ContentNotification;
  if (contentNotif.authorPubkey) {
    this.router.navigate(['/p', contentNotif.authorPubkey]);
  }
}
```

### 2. `notifications.component.html`

**Activity tab timestamps:**
```html
<span class="notification-time">{{ notification.timestamp | ago }}</span>
```

**System tab timestamps:**
```html
<span class="notification-time">{{ notification.timestamp | ago }}</span>
```

## Testing

### Profile Navigation
1. ✅ Click "View Profile" on any content notification
2. ✅ Verify URL is `/p/{hex_pubkey}`
3. ✅ Verify profile page loads correctly
4. ✅ No encoding/decoding errors

### Timestamp Display
1. ✅ Check Activity tab notifications show "X ago" format
2. ✅ Check System tab notifications show "X ago" format
3. ✅ Verify consistency with timestamps elsewhere in the app
4. ✅ Test various time ranges (seconds, minutes, hours, days)

## AgoPipe Format Examples

The `ago` pipe typically displays timestamps in user-friendly formats:
- "just now" (< 1 minute)
- "2 minutes ago"
- "1 hour ago"
- "3 hours ago"
- "Yesterday"
- "2 days ago"
- "Last week"
- "Jan 15" (for older dates)

## Route Structure

**Profile Route:**
- Pattern: `/p/:pubkey`
- Parameter: Raw hex pubkey (64 characters)
- Example: `/p/3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d`

**Event Route:**
- Pattern: `/e/:id`
- Parameter: NIP-19 encoded note ID
- Example: `/e/note1xyz...`

## Future Cleanup

The `formatTimestamp()` method can potentially be removed if it's no longer used elsewhere in the component. This would simplify the code and reduce duplication.

## Summary

✅ **Profile route fixed** - Now navigates to `/p/{pubkey}` correctly
✅ **AgoPipe implemented** - Consistent timestamp formatting
✅ **Both tabs updated** - Activity and System notifications use pipe
✅ **No breaking changes** - Existing functionality preserved
✅ **Code simplified** - Using existing pipes instead of custom methods

The notification system now correctly links to profiles and displays timestamps in a consistent, user-friendly format across the entire application.
