# True Infinite Scroll Implementation with Pagination

## Summary

Implemented proper pagination support using the Nostr `until` parameter to enable truly infinite scrolling beyond the relay's default event storage limits (previously stopping at ~5 months).

## Problem

After removing the hardcoded time restrictions, infinite scrolling still stopped at approximately 5 months. This was because:

1. The `getEventsByPubkeyAndKind()` method fetched ALL events for a user without pagination parameters
2. Relays typically only return a limited set of recent events (e.g., last 5 months) when no `until` parameter is specified
3. When loading more content, we kept fetching the same set of events from the relay instead of requesting older ones

## Root Cause

The relay query didn't include an `until` parameter, which tells the relay to fetch events OLDER than a specific timestamp. Without this:

```typescript
// OLD - No pagination parameter
const events = await relay.getEventsByPubkeyAndKind(pubkey, kind);
// Returns: Most recent ~5 months of events (relay's default)
```

When scrolling and requesting "more" events, we'd fetch the same ~5 months of events again, filter out duplicates, and have nothing new to display.

## Solution

Implemented proper Nostr pagination using the `until` parameter:

### 1. Added Paginated Method to User Relay Service

**File**: `user-relay.ts`

Added new method `getEventsByPubkeyAndKindPaginated()`:

```typescript
async getEventsByPubkeyAndKindPaginated(
  pubkey: string | string[], 
  kind: number, 
  until?: number,  // ← Key parameter for pagination
  limit = 20
): Promise<Event[]> {
  const authors = Array.isArray(pubkey) ? pubkey : [pubkey];
  const filter = { authors, kinds: [kind], limit };
  
  // Add until parameter if provided for pagination
  if (until !== undefined) {
    (filter as { until?: number }).until = until;
  }
  
  return this.getEventsWithSubscription(relayUrls, filter);
}
```

**How it works**:
- `until` parameter tells relay: "Give me events created BEFORE this timestamp"
- Allows fetching progressively older content on each scroll
- `limit` controls how many events per request

### 2. Added Paginated Method to User Data Service

**File**: `user-data.service.ts`

```typescript
async getEventsByPubkeyAndKindPaginated(
  pubkey: string | string[],
  kind: number,
  until?: number,
  limit = 20,
  options?: CacheOptions & DataOptions,
): Promise<NostrRecord[]> {
  // Fetch directly from relays with pagination support
  const events = await this.userRelayEx.getEventsByPubkeyAndKindPaginated(
    pubkey, 
    kind, 
    until, 
    limit
  );
  
  const records = events.map((event) => this.toRecord(event));
  
  if (options?.save) {
    for (const event of events) {
      await this.storage.saveEvent(event);
    }
  }
  
  return records;
}
```

**Note**: Paginated requests are NOT cached since they depend on the `until` parameter which changes with each request.

### 3. Added Wrapper to OnDemandUserDataService

**File**: `on-demand-user-data.service.ts`

```typescript
getEventsByPubkeyAndKindPaginated(
  pubkey: string, 
  kind: number, 
  until?: number, 
  limit = 20
) {
  return this.userDataService.getEventsByPubkeyAndKindPaginated(
    pubkey, 
    kind, 
    until, 
    limit, 
    { save: true }
  );
}
```

### 4. Updated Feed Service Pagination

**File**: `feed.service.ts`

Modified `fetchOlderEventsFromUsers()` to calculate and use `until` parameter:

```typescript
private async fetchOlderEventsFromUsers(pubkeys: string[], feedData: FeedItem) {
  const eventsPerUser = 3;
  const existingEvents = feedData.events();
  
  // Calculate the oldest timestamp from existing events (in seconds)
  const oldestTimestamp = existingEvents.length > 0
    ? Math.floor(Math.min(...existingEvents.map(e => (e.created_at || 0))) - 1)
    : undefined;

  const fetchPromises = pubkeys.map(async pubkey => {
    // Use paginated fetch with 'until' parameter
    const recordResults = await this.onDemandUserData.getEventsByPubkeyAndKindPaginated(
      pubkey,
      kind,
      oldestTimestamp, // ← Fetch events OLDER than this
      eventsPerUser
    );
    
    const events = recordResults.map((r: { event: Event }) => r.event);
    // ... process events
  });
}
```

## How It Works Now

### Initial Load
1. Fetch most recent events (no `until` parameter)
2. Display events sorted by timestamp
3. Track `lastTimestamp` = oldest event's timestamp

### Scroll Pagination (Load More)
1. User scrolls to bottom
2. Calculate `oldestTimestamp` from current events
3. **Call relay with `until: oldestTimestamp`**
4. Relay returns events OLDER than that timestamp
5. Append to feed and update `lastTimestamp`
6. Repeat indefinitely

### Example Timeline

```
Current feed has events from:
[Jan 2025] → [Aug 2024] ← oldestTimestamp = Aug 2024

User scrolls down → Request with until: Aug 2024

Relay returns events from:
[Jul 2024] → [Feb 2024]

Feed now has:
[Jan 2025] → [Aug 2024] → [Jul 2024] → [Feb 2024] ← new oldestTimestamp

User scrolls more → Request with until: Feb 2024

And so on, infinitely...
```

## Benefits

1. ✅ **True Infinite Scroll**: No arbitrary limits
2. ✅ **Efficient**: Only fetches what's needed
3. ✅ **Relay-Friendly**: Uses standard Nostr pagination (REQ filters with `until`)
4. ✅ **Progressive Loading**: Loads content as user scrolls
5. ✅ **No Duplicates**: `until` parameter ensures we don't re-fetch same events

## Technical Details

### Nostr Filter Parameters

```typescript
{
  authors: ['pubkey1', 'pubkey2'],
  kinds: [1],           // Event kind (1 = short text note)
  until: 1730419200,    // Unix timestamp (seconds)
  limit: 20             // Max events to return
}
```

- **`until`**: Fetch events with `created_at` < this value
- **`since`**: Fetch events with `created_at` > this value  
- **`limit`**: Maximum number of events to return

### Timestamp Handling

**Important**: Nostr uses timestamps in **seconds**, not milliseconds!

```typescript
// Event timestamps are in seconds
event.created_at // e.g., 1730419200

// JavaScript Date.now() is in milliseconds
Date.now() // e.g., 1730419200000

// Conversion
const seconds = Math.floor(Date.now() / 1000);
const milliseconds = event.created_at * 1000;
```

### Why `oldestTimestamp - 1`?

```typescript
const oldestTimestamp = Math.floor(
  Math.min(...existingEvents.map(e => e.created_at || 0)) - 1
);
```

The `-1` ensures we don't re-fetch the last event:
- Without: `until: 1730419200` might include event at exactly 1730419200
- With: `until: 1730419199` excludes events >= 1730419200

## Testing

To verify infinite scroll now works:

1. Open any feed (Following, For You, Custom)
2. Scroll down past the initial load
3. Continue scrolling - observe events older than 5 months loading
4. Keep scrolling - should load progressively older content
5. Only stops when:
   - Relays have no older content
   - Users have no older posts
   - Network error occurs

### Expected Behavior

- **First load**: Most recent events (e.g., last 2-3 months)
- **First scroll**: Events 3-6 months old
- **Second scroll**: Events 6-12 months old
- **Third scroll**: Events 1-2 years old
- **And so on...**

## Performance Considerations

### Network Efficiency
- Small requests (3-20 events per user)
- Only fetches when scrolling to bottom
- Throttled with debouncing (300ms)

### Memory Management
- Events stored in IndexedDB
- Incremental loading prevents large memory spikes
- Virtual scrolling could be added later if needed

### Relay Load
- Standard Nostr pagination (well-supported)
- Relays can efficiently handle `until` queries
- Limits per request prevent overload

## Nostr Protocol Compliance

This implementation follows Nostr NIPs:
- **NIP-01**: Basic protocol with filter specifications
- Uses standard `until` parameter in REQ messages
- Compatible with all Nostr relays

## Comparison

| Approach | Initial Load | Pagination | Relay Queries | Infinite? |
|----------|--------------|------------|---------------|-----------|
| Original (7-day limit) | 7 days | 7-30 days | No `until` | ❌ No |
| Removed limits | All available | All available | No `until` | ❌ Stops at ~5 months |
| **With pagination** | **Recent** | **Progressive** | **With `until`** | **✅ Yes** |

## Related Files

### Modified
- `user-relay.ts`: Added `getEventsByPubkeyAndKindPaginated()`
- `user-data.service.ts`: Added `getEventsByPubkeyAndKindPaginated()`
- `on-demand-user-data.service.ts`: Added pagination wrapper
- `feed.service.ts`: Updated `fetchOlderEventsFromUsers()` to use pagination

### Related Documentation
- `INFINITE_SCROLL_FIX.md`: Initial fix removing time restrictions
- `LAZY_LOADING_REVERT.md`: IntersectionObserver approach (reverted)
- `RELAY_QUERY_OPTIMIZATION.md`: Query consolidation (3 → 1)

## Future Enhancements

### Virtual Scrolling
If feeds grow very large (1000+ events), could implement:
- Angular CDK Virtual Scroll
- Only render visible items in DOM
- Maintain scroll position on navigation

### Pagination Preloading
Could preload next batch:
- When user is 80% through current feed
- Start fetching next page in background
- Seamless infinite scroll experience

### Smart Caching
- Cache paginated results temporarily
- Invalidate when feed refreshes
- Balance memory vs. network

## Migration Notes

**No breaking changes**. Existing feeds continue to work:
- Old method still exists for non-paginated queries
- New paginated method used only for "load more"
- Backward compatible with all relay implementations

Users will immediately notice:
- Can scroll much further back in history
- Truly infinite scrolling
- No more "stuck at 5 months" issue
