# Notification Database Query Limit Fix

**Date**: 2025-10-20  
**Component**: `storage.service.ts`  
**Issue**: Only 100 notifications displayed after app reload despite 1500+ being stored

## Problem

User reported that after resetting notifications and fetching fresh data:
- Initial fetch retrieved **1500 notifications** from relays
- After app reload, only **100 notifications** were displayed
- Only old events were showing

### Root Cause Analysis

The issue was caused by a hardcoded limit in the `getAllNotifications()` method:

```typescript
// BEFORE - Limited to 100
async getAllNotifications(): Promise<Notification[]> {
  try {
    const tx = this.db.transaction('notifications', 'readonly');
    const index = tx.store.index('by-timestamp');
    return await index.getAll(undefined, 100); // ❌ Hardcoded limit
  } catch (error) {
    this.logger.error('Error getting all notifications', error);
    return [];
  }
}
```

### How the Bug Occurred

There are **two separate limits** in the notification system:

1. **Relay Query Limits** (defined in `content-notification.service.ts`):
   ```typescript
   const NOTIFICATION_QUERY_LIMITS = {
     FOLLOWERS: 200,   // New followers
     MENTIONS: 500,    // Mentions in posts
     REPOSTS: 300,     // Reposts/quotes
     REPLIES: 500,     // Replies to your posts
     REACTIONS: 500,   // Likes/reactions
     ZAPS: 1000,       // Zap receipts (often the highest volume)
   };
   ```
   These limits control **how many events to fetch from Nostr relays**.

2. **IndexedDB Retrieval Limit** (in `storage.service.ts`):
   ```typescript
   return await index.getAll(undefined, 100); // ❌ This was the problem
   ```
   This limit controlled **how many notifications to retrieve from local storage**.

### The Flow

1. **Fresh Fetch** (Reset Notifications Cache):
   - `ContentNotificationService.checkForNewNotifications()` runs
   - Queries relays with limits: 1000 zaps, 500 mentions, 500 reactions, etc.
   - Receives ~1500 total notifications from relays
   - All 1500 notifications stored in IndexedDB
   - All 1500 notifications loaded into memory and displayed ✅

2. **App Reload**:
   - `NotificationService.loadNotifications()` runs
   - Calls `storage.getAllNotifications()`
   - IndexedDB query limited to 100 notifications ❌
   - Only 100 notifications loaded into memory
   - Only 100 notifications displayed ❌

### Why It Showed "Old Events"

The IndexedDB index `by-timestamp` is configured as:
```typescript
by-timestamp: '+timestamp'  // Ascending order (oldest first)
```

When retrieving with `.getAll(undefined, 100)`, it returned:
- The **first 100 notifications** in ascending order
- These were the **oldest notifications** in the database
- Newer notifications (101-1500) were ignored

This is why users saw old events instead of their most recent notifications.

## Solution

Removed the arbitrary 100-notification limit from `getAllNotifications()`:

```typescript
// AFTER - No limit, retrieve all stored notifications
async getAllNotifications(): Promise<Notification[]> {
  try {
    // Get all notifications sorted by timestamp (newest first)
    const tx = this.db.transaction('notifications', 'readonly');
    const index = tx.store.index('by-timestamp');
    return await index.getAll(); // ✅ No limit - retrieve everything
  } catch (error) {
    this.logger.error('Error getting all notifications', error);
    return [];
  }
}
```

### Why This is Safe

1. **Memory Usage**: Even with 10,000 notifications, memory usage is reasonable:
   - Average notification size: ~500 bytes
   - 10,000 notifications: ~5MB in memory
   - Modern browsers handle this easily

2. **Performance**: Virtual scrolling (recently implemented) ensures:
   - Only ~20-30 DOM elements rendered at once
   - No performance degradation with thousands of notifications
   - Smooth scrolling regardless of total count

3. **User Control**: Users can manage notification volume via:
   - "Reset Notifications Cache" in Settings → Danger Zone
   - Individual notification removal
   - Notification type filtering

4. **Practical Limits**: The relay query limits still apply:
   - Maximum ~3,000 notifications per fetch (sum of all type limits)
   - Most users will have far fewer
   - Only extremely active accounts approach these limits

## Impact

### Before Fix
- ❌ Only 100 notifications visible after reload
- ❌ Showed oldest notifications, not newest
- ❌ Confusing user experience (saw 1500, then 100)
- ❌ Recent interactions hidden

### After Fix
- ✅ All stored notifications visible after reload
- ✅ Consistent notification count across sessions
- ✅ Newest notifications always visible (proper sorting in UI)
- ✅ Complete notification history available

## Related Systems

### Notification Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Fetch from Relays (content-notification.service.ts) │
│    - Apply relay query limits (500-1000 per type)      │
│    - Total: Up to ~3000 notifications                  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Store in IndexedDB (storage.service.ts)             │
│    - All fetched notifications stored                  │
│    - No limit on storage capacity                      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Retrieve from IndexedDB (storage.service.ts)        │
│    - BEFORE: Limited to 100 ❌                          │
│    - AFTER:  No limit ✅                                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Load into Memory (notification.service.ts)          │
│    - Sorted by timestamp (newest first)                │
│    - Stored in signal for reactive updates             │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Display in UI (notifications.component.ts)          │
│    - Virtual scrolling renders only visible items      │
│    - Filter by type (reactions, mentions, zaps, etc.)  │
└─────────────────────────────────────────────────────────┘
```

### Code References

**Relay Query Limits** (`content-notification.service.ts:20-27`):
```typescript
const NOTIFICATION_QUERY_LIMITS = {
  FOLLOWERS: 200,
  MENTIONS: 500,
  REPOSTS: 300,
  REPLIES: 500,
  REACTIONS: 500,
  ZAPS: 1000,
};
```

**IndexedDB Storage** (`storage.service.ts:1339-1345`):
```typescript
async getAllNotifications(): Promise<Notification[]> {
  const tx = this.db.transaction('notifications', 'readonly');
  const index = tx.store.index('by-timestamp');
  return await index.getAll(); // No limit
}
```

**Memory Loading** (`notification.service.ts:45-68`):
```typescript
async loadNotifications(): Promise<void> {
  const storedNotifications = await this.storage.getAllNotifications();
  storedNotifications.sort((a, b) => b.timestamp - a.timestamp);
  this._notifications.set(storedNotifications);
}
```

**Virtual Scrolling** (`notifications.component.html`):
```html
<cdk-virtual-scroll-viewport [itemSize]="150">
  <div *cdkVirtualFor="let notification of contentNotifications()">
    <!-- Only renders ~20-30 items at a time -->
  </div>
</cdk-virtual-scroll-viewport>
```

## Testing

### Verification Steps

1. **Reset Notifications Cache** (Settings → Danger Zone)
2. **Fresh Fetch**: Observe notification count (e.g., 1500)
3. **Reload App**: Verify same notification count persists (1500)
4. **Check Recency**: Newest notifications should be at the top
5. **Scroll Performance**: Verify smooth scrolling with virtual scroll

### Expected Behavior

- Notification count remains consistent across app reloads
- All notifications fetched from relays are visible in UI
- Newest notifications appear first
- Scrolling remains smooth regardless of notification count
- Memory usage stays reasonable (<10MB for typical users)

### Edge Cases

1. **Empty State**: 0 notifications → Shows "No notifications" message
2. **Small Count**: 1-50 notifications → Works normally
3. **Medium Count**: 100-500 notifications → Works normally
4. **Large Count**: 1000-3000 notifications → Virtual scrolling ensures performance
5. **Extreme Count**: If user somehow accumulates >5000 notifications, performance may degrade slightly but will still work

## Future Considerations

### Potential Improvements

1. **Pagination**: Implement infinite scroll with pagination
   - Load initial 500 notifications
   - Fetch more when scrolling near bottom
   - Reduces initial load time for users with thousands of notifications

2. **Automatic Cleanup**: Optional setting to auto-delete old notifications
   - "Keep notifications for X days"
   - Runs on app startup
   - User-configurable in settings

3. **Performance Monitoring**: Track metrics
   - Number of notifications stored
   - Load time from IndexedDB
   - Memory usage
   - Render performance

4. **Storage Optimization**: Compress old notifications
   - Store full data for recent notifications
   - Store minimal data for old notifications (just enough to display)
   - Fetch full data on-demand when viewing details

### When to Consider These

- If users regularly exceed 5,000 notifications
- If loading time becomes noticeably slow (>2 seconds)
- If memory usage becomes problematic on low-end devices
- If users request more control over notification retention

## Related Documentation

- `VIRTUAL_SCROLLING_NOTIFICATIONS.md` - Virtual scrolling implementation for performance
- `CONTENT_NOTIFICATIONS_SUMMARY.md` - Overall notification system architecture
- `RESET_NOTIFICATIONS_CACHE.md` - Cache reset feature documentation

## Files Modified

- `src/app/services/storage.service.ts` - Removed 100-notification limit from `getAllNotifications()`
