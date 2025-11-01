# Infinite Scroll Fix

## Summary

Fixed the infinite scrolling limitation that prevented users from scrolling past ~6-7 days of content by removing hardcoded time restrictions in the feed service.

## Problem

Users reported that continuous scrolling stopped loading older events after reaching events that were approximately 6 days old. The feed would not load any content older than this threshold.

## Root Cause

The feed service had **two hardcoded time restrictions** that prevented loading older content:

### 1. Initial Load Restriction (Line 732-733)
```typescript
const daysBack = isArticlesFeed ? 90 : 7; // Look further back for articles
const timeCutoff = now - daysBack * 24 * 60 * 60; // subtract days in seconds
```

**Impact**: Initial feed load would only fetch events from the last 7 days (90 days for articles).

### 2. Pagination Restriction (Line 994)
```typescript
const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days for older content
```

**Impact**: When scrolling down to load more content, events older than 30 days would be filtered out.

The combination of these restrictions meant:
- Initial load: Only last 7 days of events
- Scroll pagination: Could load up to 30 days back
- **Result**: Users could only scroll through ~7-30 days of history

## Solution

Removed all time-based filtering to enable true infinite scrolling:

### Changes Made

#### 1. `fetchEventsFromUsers()` - Initial Load
**Before**:
```typescript
const daysBack = isArticlesFeed ? 90 : 7;
const timeCutoff = now - daysBack * 24 * 60 * 60;

const events = await this.sharedRelayEx.getMany(
  pubkey,
  {
    authors: [pubkey],
    kinds: feedData.filter?.kinds,
    limit: eventsPerUser,
    since: timeCutoff,  // ← Time restriction
  },
  { timeout: 2500 }
);
```

**After**:
```typescript
// Removed time cutoff to allow infinite scrolling
const filterConfig = {
  authors: [pubkey],
  kinds: feedData.filter?.kinds,
  limit: eventsPerUser,
  // No 'since' filter - allows fetching older content
};

const events = await this.sharedRelayEx.getMany(
  pubkey,
  filterConfig,
  { timeout: 2500 }
);
```

#### 2. `fetchOlderEventsFromUsers()` - Pagination
**Before**:
```typescript
const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

const olderEvents = events
  .filter((event: Event) => {
    const eventTime = (event.created_at || 0) * 1000;
    const eventAge = Date.now() - eventTime;
    return eventTime < feedData.lastTimestamp && eventAge <= maxAge; // ← Age check
  })
  .slice(0, eventsPerUser);
```

**After**:
```typescript
// Removed maxAge limit to allow infinite scrolling

const olderEvents = events
  .filter((event: Event) => {
    const eventTime = (event.created_at || 0) * 1000;
    return eventTime < feedData.lastTimestamp; // Only check if older than current
  })
  .slice(0, eventsPerUser);
```

#### 3. Updated Documentation
Updated method documentation to reflect that feeds now support infinite scrolling with no time restrictions.

## How It Works Now

### Initial Load
1. Fetch most recent events from each user (no time limit)
2. Display events sorted by timestamp
3. Track `lastTimestamp` of oldest event

### Scroll Pagination
1. User scrolls to bottom
2. Fetch events older than `lastTimestamp` (no age restriction)
3. Append to existing events
4. Update `lastTimestamp` with new oldest event
5. Repeat infinitely

### Natural Limitations
The scrolling is now only limited by:
- **Relay availability**: How far back relays store events
- **User content**: When users started posting
- **Performance**: Browser memory for very long feeds

This matches standard social media infinite scroll behavior where users can scroll back through all available history.

## Benefits

1. ✅ **True Infinite Scroll**: Users can scroll through all available historical content
2. ✅ **Better User Experience**: No arbitrary cutoff dates
3. ✅ **Consistency**: Behavior matches user expectations from other social platforms
4. ✅ **Flexibility**: Let relays and content availability determine limits, not hardcoded values

## Testing

To verify the fix works:
1. Open a feed (Following, For You, or Custom)
2. Scroll down continuously
3. Observe that events older than 7 days are now loaded
4. Continue scrolling - should load progressively older content
5. Scrolling only stops when:
   - Relays have no more content
   - Users have no older posts
   - `hasMore` flag is set to false naturally

## Performance Considerations

### Memory Management
Loading very old content could increase memory usage. The feed service handles this through:
- Incremental loading (small batches at a time)
- Event deduplication
- Natural pagination boundaries

### Relay Load
Removed time filters mean more potential relay queries. Mitigated by:
- Existing rate limiting and throttling
- Caching in storage service
- Subscription management
- User-based query optimization (outbox model)

### Browser Performance
Very long feeds might impact browser performance. Users can:
- Refresh page to reset feed
- Use navigation to return to top
- Feeds naturally paginate in chunks

## Alternative Approaches Considered

### Keep Large Time Window
Could have increased limits (e.g., 365 days) instead of removing them entirely.
- **Rejected**: Still arbitrary, would eventually hit limit

### Implement Virtual Scrolling
Could use virtual DOM to render only visible items.
- **Deferred**: Not necessary yet, current approach works well

### Add User Setting
Could let users configure how far back to load.
- **Deferred**: Adds complexity, default infinite scroll is standard

## Related Files

- `feed.service.ts`: Core feed loading logic
- `feeds.component.ts`: UI scroll detection and loading triggers
- `subscription-manager.ts`: Manages relay subscriptions

## Migration Notes

No breaking changes. Existing feeds will automatically support infinite scroll after this update. Users may notice:
- Feeds load slightly differently on initial load (no time restriction)
- Can now scroll much further back in history
- Loading indicators may appear more frequently when scrolling through very old content

## Performance Monitoring

Monitor for:
- Relay response times when fetching very old events
- Browser memory usage with very long feeds  
- User reports of slow scrolling in feeds with 1000+ events

If issues arise, can implement:
- Configurable time windows as user preference
- Virtual scrolling for very long feeds
- Automatic feed truncation after threshold
