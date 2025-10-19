# New Posts Notification Feature

## Overview

This feature adds a "New posts" notification button to each feed column that checks for new events every minute without automatically updating the view. This prevents disruption to the user's current reading position while still keeping them informed about new content.

## Implementation Details

### Feed Service Changes

#### FeedItem Interface Extension

Added new properties to the `FeedItem` interface:

- `pendingEvents?: WritableSignal<Event[]>` - Stores new events that haven't been loaded into the main feed yet
- `lastCheckTimestamp?: number` - Tracks the last time we checked for new events (in seconds)

#### New Event Checking

**Interval Management:**
- Starts a 60-second interval when subscribing to a feed
- Automatically clears the interval when unsubscribing or switching feeds
- Only checks for new events on active, non-paused columns

**Methods Added:**

1. `checkForNewEvents()` - Main method that checks all active columns for new events
2. `checkColumnForNewEvents(columnId)` - Checks a specific column for new events since the last check
3. `fetchNewEventsForFollowing(feedData, sinceTimestamp)` - Fetches new events for following-based feeds
4. `fetchNewEventsForCustom(feedData, sinceTimestamp)` - Fetches new events for custom user feeds
5. `fetchNewEventsFromUsers(pubkeys, feedData, sinceTimestamp)` - Fetches events from specific users using the outbox model
6. `getPendingEventsCount(columnId)` - Returns the count of pending events for a column
7. `loadPendingEvents(columnId)` - Loads pending events into the main feed
8. `getPendingEventsSignal(columnId)` - Returns the reactive signal for pending events

**How It Works:**

1. Every 60 seconds, the service checks for new events using the `since` parameter set to `lastCheckTimestamp`
2. New events are stored in the `pendingEvents` signal without updating the main `events` signal
3. Events are fetched using the same logic as the main feed (following/custom feeds use outbox model)
4. Only fetches 2 events per user to minimize bandwidth and processing
5. Respects PoW minimum difficulty filters if configured

### Component Changes

#### Feeds Component

**New Computed Signal:**

- `pendingEventsCount` - A computed signal that creates a map of column IDs to pending event counts

**New Methods:**

1. `loadNewPosts(columnId)` - Loads pending events into the main feed and shows a notification
2. `getPendingEventsCount(columnId)` - Helper method to get pending count for a specific column

#### Template Changes

Added a notification button that appears at the top of each column when there are pending events:

```html
@if (getPendingEventsCount(column.id) > 0) {
  <div class="new-posts-notification">
    <button mat-raised-button color="primary" (click)="loadNewPosts(column.id)" class="new-posts-button">
      <mat-icon>arrow_upward</mat-icon>
      {{ getPendingEventsCount(column.id) }} new {{ getPendingEventsCount(column.id) === 1 ? 'post' : 'posts' }}
    </button>
  </div>
}
```

#### Styling

Added CSS for the notification button:

- Positioned absolutely at the top center of the column
- Slide-down animation when appearing
- Elevated shadow for visibility
- Hover effect for better UX

## User Experience

1. **Non-Disruptive:** New events don't automatically appear, preserving the user's reading position
2. **Visual Feedback:** A clear button shows how many new posts are available
3. **One-Click Loading:** Users can load new posts with a single click
4. **Automatic Cleanup:** After loading, pending events are cleared and the check timestamp is updated
5. **Per-Column:** Each column independently tracks and displays new posts

## Technical Considerations

### Performance

- Minimal bandwidth usage: Only fetches 2 events per user during checks
- Efficient deduplication: Uses Map to prevent duplicate events
- Reactive updates: Uses Angular signals for efficient change detection
- Paused columns are skipped during checks

### Edge Cases Handled

1. **No Following:** If user has no following, the check gracefully returns no events
2. **Paused Columns:** Columns without active subscriptions are skipped
3. **Feed Switching:** Interval is cleared and restarted when switching feeds
4. **Component Destruction:** Interval is properly cleaned up on unsubscribe

### Nostr Protocol Compliance

- Uses proper timestamp handling (seconds, not milliseconds)
- Respects the `since` filter parameter in Nostr queries
- Works with the outbox model for following and custom feeds
- Properly handles different event kinds (notes, articles, etc.)

## Future Enhancements

Potential improvements for this feature:

1. **Configurable Interval:** Allow users to set their own check interval (30s, 1m, 5m, etc.)
2. **Audio/Visual Notifications:** Optional sound or browser notification when new posts arrive
3. **Auto-Load Option:** Setting to automatically load new posts after a certain threshold
4. **Badge Counter:** Show pending count in the feed tab/header
5. **Preview:** Show a preview of new posts without loading them all
