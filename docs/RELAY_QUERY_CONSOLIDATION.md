# Live Subscription for Account Data

## Overview
Replaced the initial batch query + separate subscription pattern with a single live subscription that handles both initial data load and real-time updates. This eliminates redundant queries and ensures the app is always connected to fresh data.

## Evolution

### Phase 1: Consolidated Initial Query (Previous)
- Merged 6 separate queries into 1 batch query
- Added real-time subscription for updates
- **Problem**: Still fetching same data twice (once in load(), once in subscription)

### Phase 2: Live Subscription Only (Current)
- Removed redundant initial batch query
- Single subscription handles both initial data AND updates
- Loads cached data from storage first for instant display
- Fresh data arrives via subscription within milliseconds

## Implementation

### Old Approach (Deprecated)
```typescript
async load() {
  // 1. Fetch all 6 kinds in batch query
  const accountEvents = await this.accountRelay.getMany({...});
  
  // 2. Process each event type
  processMetadata(metadataEvent);
  processFollowing(followingEvent);
  // ... etc
  
  // 3. Start subscription (duplicates the same data)
  await this.subscribeToAccountMetadata(pubkey);
}
```

### New Approach (Current)
```typescript
async load() {
  // 1. Load cached data from storage immediately (instant display)
  const storedMetadata = await this.storage.getEventByPubkeyAndKind(...);
  const storedFollowing = await this.storage.getEventByPubkeyAndKind(...);
  // Display cached data instantly
  
  // 2. Start live subscription (fetches fresh data + keeps updated)
  await this.subscribeToAccountMetadata(pubkey);
  // Subscription handles everything:
  // - Fetches latest data from relays
  // - Processes each event type
  // - Saves to storage
  // - Updates UI state
  // - Stays connected for real-time updates
}
```

### Subscription Handler
```typescript
private async subscribeToAccountMetadata(pubkey: string) {
  const filter = {
    kinds: [0, 3, 10000, 10002, 10003, 10063],
    authors: [pubkey],
  };

  const onEvent = async (event: Event) => {
    // Save to storage
    await this.storage.saveEvent(event);
    
    // Process by kind
    switch (event.kind) {
      case kinds.Metadata: /* update profile */
      case kinds.Contacts: /* update following */
      case kinds.Mutelist: /* update mutes */
      // ... etc
    }
  };

  const onEose = () => {
    // Initial data fully loaded from relays
    this.appState.isLoading.set(false);
    this.appState.showSuccess.set(true);
  };

  this.accountSubscription = this.accountRelay.subscribe(filter, onEvent, onEose);
}
```

### Removed Code
- Duplicate relay list fetch from `discoveryRelay.getEventByPubkeyAndKind()`
- Individual `loadAccountFollowing()` call
- Individual `loadAccountMuteList()` call
- Helper methods: `processFollowingList()` and `processMuteList()`
- Redundant batch query in `load()` method
- **BookmarkService**: Changed `initialize()` from relay query to storage-only fetch
- **NostrService**: Changed `getMediaServers()` from relay query to storage-only fetch

## Benefits

### Performance
- **Instant UI**: Cached data displays immediately on load
- **Fresh Data**: Live subscription fetches latest data in parallel
- **No Redundancy**: Data fetched only once via subscription
- **Real-time Updates**: Always connected for instant updates

### Architecture
- **Simpler Code**: Removed helper methods and redundant fetching logic
- **Single Source of Truth**: Subscription is the only data fetcher
- **Better UX**: Shows cached data instantly, updates when fresh data arrives
- **Live Connection**: No need to refresh - updates arrive automatically

## Performance Impact
- **Before Phase 1**: 8 queries (6 initial + 2 duplicates)
- **After Phase 1**: 1 batch query + 1 subscription = 2 fetches
- **After Phase 2 (Current)**: 1 live subscription = **1 persistent connection**
- **Overall Improvement**: 87.5% reduction in queries (8 → 1)
- **Added Benefit**: Real-time updates included at no extra cost

## Data Flow

### On Account Load
1. **Instant Display** (0ms): Load cached data from IndexedDB
2. **Connect** (~50ms): Open subscription to account relay
3. **Stream Events** (~100-500ms): Events arrive as relay responds
4. **EOSE** (~500-1000ms): All initial data received, loading complete
5. **Stay Connected**: Subscription remains open for live updates

### On Data Change (from another client)
1. New event published to relay
2. Subscription receives event immediately
3. Event processed and saved to storage
4. UI state updated automatically
5. User sees change in real-time

## Testing Checklist
- [ ] Profile metadata loads correctly
- [ ] Following list displays properly
- [ ] Mute functionality works
- [ ] Relay list shows correct relays
- [ ] Bookmarks are accessible
- [ ] Media upload uses correct servers
- [ ] Real-time updates work for all event types
- [ ] Storage fallbacks function when events not found

## Files Modified
- `src/app/services/nostr.service.ts`:
  - Simplified `load()` to use storage + subscription only
  - Enhanced `subscribeToAccountMetadata()` to handle all event processing
  - Removed `processFollowingList()` and `processMuteList()` helper methods
  - Moved loading state management into subscription EOSE handler
  
- `src/app/services/bookmark.service.ts`: 
  - Changed to storage-only fetch (data pre-loaded by subscription)
  
- `src/app/services/media.service.ts`:
  - Uses `getMediaServers()` which now reads from storage (data pre-loaded by subscription)
