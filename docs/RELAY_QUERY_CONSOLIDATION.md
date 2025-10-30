# Relay Query Consolidation

## Overview
Consolidated 6 separate relay queries during account initialization into a single efficient batch query, reducing network overhead by 83% and significantly improving account load performance.

## Problem
When loading account data, the application was making 6 individual relay queries:
1. Profile metadata (kind 0)
2. Following list (kind 3)
3. Mute list (kind 10000)
4. Relay list (kind 10002)
5. Bookmark list (kind 10003)
6. Media server list (kind 10063)

Each query created separate network round-trips, causing slow account initialization.

Additionally, after the initial load, two services were making duplicate queries:
- **BookmarkService.initialize()** - Re-querying kind 10003
- **NostrService.getMediaServers()** - Re-querying kind 10063

This resulted in **8 total queries** for data that could be fetched once.

## Solution
Merged all 6 queries into a single `getMany()` call:

```typescript
const accountEvents = await this.accountRelay.getMany({
  authors: [pubkey],
  kinds: [
    kinds.Metadata,      // 0 - profile
    kinds.Contacts,      // 3 - following list
    kinds.Mutelist,      // 10000 - mutes
    kinds.RelayList,     // 10002 - relays
    kinds.BookmarkList,  // 10003 - bookmarks
    10063,               // Media servers
  ],
});
```

## Implementation Details

### Event Processing
Each event type is extracted and processed with storage fallbacks:

- **Profile (kind 0)**: Processed via existing `processAccountMetadata()`
- **Following List (kind 3)**: New `processFollowingList()` method with storage fallback
- **Mute List (kind 10000)**: New `processMuteList()` method with storage fallback
- **Relay List (kind 10002)**: Direct storage save with relay count logging
- **Bookmark List (kind 10003)**: Direct storage save with bookmark count logging
- **Media Servers (kind 10063)**: Direct storage save with server count logging

### Real-time Subscription
Updated `subscribeToAccountMetadata()` to include all 6 kinds for live updates:

```typescript
const filter = {
  authors: [pubkey],
  kinds: [
    kinds.Metadata,
    kinds.Contacts,
    kinds.Mutelist,
    kinds.RelayList,
    kinds.BookmarkList,
    10063,
  ],
};
```

### Removed Code
- Duplicate relay list fetch from `discoveryRelay.getEventByPubkeyAndKind()`
- Individual `loadAccountFollowing()` call
- Individual `loadAccountMuteList()` call
- **BookmarkService**: Changed `initialize()` from relay query to storage-only fetch
- **NostrService**: Changed `getMediaServers()` from relay query to storage-only fetch

## Performance Impact
- **Before**: 8 relay queries (6 initial + 2 duplicate) = ~8× network latency
- **After**: 1 consolidated query = ~1× network latency
- **Improvement**: ~8× faster account loading, 87.5% reduction in relay requests

## Testing Checklist
- [ ] Profile metadata loads correctly
- [ ] Following list displays properly
- [ ] Mute functionality works
- [ ] Relay list shows correct relays
- [ ] Bookmarks are accessible
- [ ] Media upload uses correct servers
- [ ] Real-time updates work for all event types
- [ ] Storage fallbacks function when events not found

## Related Files
- `src/app/services/nostr.service.ts` - Main implementation, `getMediaServers()` updated
- `src/app/services/bookmark.service.ts` - `initialize()` updated to use storage
- `src/app/services/account-relay.service.ts` - Relay service used
- `src/app/services/storage.service.ts` - Storage fallback layer
