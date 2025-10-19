# Notification Timestamp Format Fix

## Issue

All notifications were showing "In the future" instead of proper relative time like "2 hours ago".

## Root Cause

**Timestamp Format Mismatch:**
- The `ago` pipe expects timestamps in **seconds** (Unix timestamp format)
- The notification service was storing timestamps in **milliseconds** (`event.created_at * 1000`)
- When passed to the pipe without conversion, the millisecond values were interpreted as seconds, making them appear far in the future

### Example of the Problem

```typescript
// Nostr event timestamp (seconds)
event.created_at = 1729350000  // Oct 19, 2025 in seconds

// Notification service converts to milliseconds
timestamp: event.created_at * 1000  // 1729350000000

// Ago pipe interprets this as seconds
const now = Math.floor(Date.now() / 1000);  // ~1729350000
const diff = now - 1729350000000;  // Huge negative number!

// Result: "in the future" because diff < 0
```

## Solution

Convert milliseconds back to seconds when passing to the `ago` pipe:

```html
<!-- Before (WRONG) -->
<span class="notification-time">{{ notification.timestamp | ago }}</span>

<!-- After (CORRECT) -->
<span class="notification-time">{{ (notification.timestamp / 1000) | ago }}</span>
```

## Why Store in Milliseconds?

The notification service stores timestamps in milliseconds to maintain consistency with JavaScript's `Date.now()` and other parts of the application that use millisecond timestamps. This is a common practice in JavaScript/TypeScript applications.

## How the AgoPipe Works

The `ago` pipe is designed to work with Unix timestamps in **seconds**:

```typescript
transform(value: number | any): string {
  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  const timestamp = value;  // Expected to be in seconds
  const diff = now - timestamp; // Difference in seconds
  
  if (diff < 0) {
    return 'in the future';
  }
  // ... rest of the logic
}
```

## Files Modified

### `notifications.component.html`

**Activity Tab:**
```html
<span class="notification-time">{{ (notification.timestamp / 1000) | ago }}</span>
```

**System Tab:**
```html
<span class="notification-time">{{ (notification.timestamp / 1000) | ago }}</span>
```

## Verification

After this fix, notifications should display proper relative times:

- "just now" (< 5 seconds)
- "2 minutes ago"
- "3 hours ago"
- "yesterday"
- "5 days ago"
- "2 weeks ago"
- "a month ago"

## Consistency Across the App

This fix aligns with how other parts of the app handle the ago pipe:

**Other examples in the codebase:**
```html
<!-- Drafts component converts milliseconds to seconds -->
{{ draft.lastModified * 1000 | ago }}

<!-- Events use Nostr's created_at directly (already in seconds) -->
{{ event.created_at | ago }}

<!-- Account last used converts milliseconds to seconds -->
{{ (item.account.lastUsed! / 1000) | ago }}
```

## Alternative Approaches Considered

1. **Modify the ago pipe to accept milliseconds:**
   - Would break existing usage across the app
   - Nostr timestamps are naturally in seconds
   - Would require updating many files

2. **Store timestamps in seconds in notification service:**
   - Would break consistency with JavaScript conventions
   - Would require changes in storage layer
   - More complex migration path

3. **Convert in template (CHOSEN):**
   - ✅ Simple, minimal change
   - ✅ Maintains consistency with storage layer
   - ✅ Aligns with existing patterns in the app
   - ✅ No breaking changes elsewhere

## Testing

### Manual Testing

1. Create a new notification (mention, reply, etc.)
2. Check the notification page
3. Verify it shows relative time (e.g., "just now")
4. Wait a few minutes and refresh
5. Verify it updates to show "X minutes ago"

### Test Different Time Ranges

- Recent: "just now", "2 minutes ago"
- Hours: "3 hours ago"
- Days: "yesterday", "3 days ago"
- Weeks: "a week ago", "2 weeks ago"
- Months: "a month ago"

### Expected Results

✅ No more "in the future" messages
✅ Relative time displays correctly
✅ Time updates appropriately as notifications age
✅ Consistent with other parts of the app

## Technical Details

### Timestamp Formats in the App

**Milliseconds (JavaScript convention):**
- `Date.now()` returns milliseconds
- Notification storage uses milliseconds
- Internal timestamps use milliseconds

**Seconds (Nostr/Unix convention):**
- Nostr `event.created_at` is in seconds
- Unix timestamps are in seconds
- The `ago` pipe expects seconds

### Conversion Formula

```typescript
// Milliseconds to seconds
const seconds = milliseconds / 1000;

// Seconds to milliseconds
const milliseconds = seconds * 1000;
```

## Summary

✅ **Fixed "In the future" bug** - Timestamps now display correctly
✅ **Simple solution** - Convert milliseconds to seconds in template
✅ **No breaking changes** - Other parts of the app unaffected
✅ **Consistent behavior** - Follows existing patterns in the codebase
✅ **Both tabs updated** - Activity and System notifications fixed

The notification timestamps now display properly relative time instead of showing "in the future" for all events.
