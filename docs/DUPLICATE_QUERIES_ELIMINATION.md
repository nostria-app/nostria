# Duplicate Query Elimination

## Overview
Eliminated duplicate queries for kinds 10003 (BookmarkList) and 10063 (Media servers) that were being fetched twice - once in the consolidated account query and again by individual services.

## Problem Identified
After consolidating the initial 6 account queries into a single batch query, two services were still making redundant relay queries:

1. **BookmarkService.initialize()**
   - Was querying relay for kind 10003 (BookmarkList)
   - This data was already fetched in the consolidated query

2. **NostrService.getMediaServers()**
   - Was querying relay for kind 10063 (Media server list)
   - This data was already fetched in the consolidated query

## Solution

### BookmarkService Changes
**Before:**
```typescript
async initialize() {
  const bookmarksEvent = await this.accountRelay.get({
    authors: [this.accountState.pubkey()!],
    kinds: [kinds.BookmarkList],
  });
  this.bookmarkEvent.set(bookmarksEvent);
}
```

**After:**
```typescript
async initialize() {
  // Bookmark list (kind 10003) is already fetched in the consolidated account query
  // in nostr.service.ts, so we just load from storage
  const bookmarksEvent = await this.storage.getEventByPubkeyAndKind(
    this.accountState.pubkey()!,
    kinds.BookmarkList
  );
  this.bookmarkEvent.set(bookmarksEvent);
}
```

### NostrService Changes
**Before:**
```typescript
async getMediaServers(pubkey: string): Promise<Event | null> {
  // CRITICAL: Fetch from relay first to get latest media server list
  let event = await this.accountRelay.getEventByPubkeyAndKind(pubkey, 10063);

  if (event) {
    this.storage.saveEvent(event as Event);
    this.logger.info('Loaded fresh media servers from relay');
  } else {
    this.logger.warn('Could not fetch media servers from relay, falling back to storage');
    event = await this.storage.getEventByPubkeyAndKind(pubkey, 10063);
  }

  return event;
}
```

**After:**
```typescript
async getMediaServers(pubkey: string): Promise<Event | null> {
  // Media server list (kind 10063) is already fetched in the consolidated account query
  // in the load() method, so we just retrieve from storage
  const event = await this.storage.getEventByPubkeyAndKind(pubkey, 10063);
  
  if (!event) {
    this.logger.warn('No media server list found in storage for pubkey:', pubkey);
  }

  return event;
}
```

## Key Changes
1. **BookmarkService**: Added `StorageService` injection
2. **BookmarkService.initialize()**: Changed from relay query to storage-only fetch
3. **NostrService.getMediaServers()**: Simplified to storage-only fetch, removed relay fallback logic

## Data Freshness
Both services now rely on the consolidated query in `nostr.service.ts` which:
- Fetches fresh data on account load
- Has real-time subscription updates for changes
- Saves all events to storage immediately

This ensures services get the latest data without redundant queries.

## Performance Impact
- **Before**: 8 total queries (6 consolidated + 2 duplicates)
- **After**: 1 consolidated query
- **Additional Improvement**: 25% further reduction (2 → 0 duplicate queries)
- **Combined Total**: 87.5% reduction in relay requests (8 → 1)

## Files Modified
- `src/app/services/bookmark.service.ts` - Updated initialize() method
- `src/app/services/nostr.service.ts` - Simplified getMediaServers() method
- `docs/RELAY_QUERY_CONSOLIDATION.md` - Updated documentation

## Testing Notes
- Verify bookmarks still load correctly after account login
- Verify media uploads still use correct servers
- Confirm no "CRITICAL: Fetch from relay first" logs appear
- Check that storage fallback works when data is missing
