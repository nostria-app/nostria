# List Cache Invalidation Fix

## Problem
After editing a list, the UI would sometimes show the old event instead of the updated one, even after a page reload. This happened because:

1. The `UserDataService.getEventByPubkeyAndKind()` method uses an in-memory cache
2. When saving an event directly with `storage.saveEvent()`, the cache wasn't invalidated
3. On page reload, `loadAllLists()` would call `getEventByPubkeyAndKind()` with `cache: true`, which would return the stale cached data

## Root Cause
The caching flow worked like this:
- **Save**: `storage.saveEvent(event)` → Updates IndexedDB but doesn't touch `UserDataService` cache
- **Load**: `data.getEventByPubkeyAndKind(..., { cache: true })` → Returns stale cached data

The cache key is `${pubkey}-${kind}`, and it was never invalidated when a new event was saved.

## Solution

### 1. Remove Redundant Reload
Removed the `await this.loadAllLists()` call after saving, since:
- We already do an optimistic UI update before saving
- We save the event to storage immediately
- Reloading with `cache: true` would just get stale cached data

### 2. Invalidate Cache After Save
After saving the event to storage, we now explicitly invalidate the cache:

```typescript
// Also save to local database immediately
await this.storage.saveEvent(signedEvent);

// Invalidate cache so next load gets the fresh data
await this.data.getEventByPubkeyAndKind(pubkey, listType.kind, {
  cache: true,
  invalidateCache: true,
} as Parameters<typeof this.data.getEventByPubkeyAndKind>[2]);
```

The `invalidateCache: true` option tells `UserDataService` to:
1. Remove the old cached entry for this `pubkey-kind` combination
2. Fetch the fresh data from storage
3. Cache the new data

### Type Casting Note
We use `as Parameters<typeof...>[2]` to work around a TypeScript issue where the `CacheOptions & DataOptions` intersection type doesn't properly expose the `invalidateCache` property from `DataOptions`.

## Testing
To verify the fix:
1. Edit a list (e.g., DM Relays)
2. Add/remove items and save
3. The UI should immediately show the changes (optimistic update)
4. Reload the page
5. The updated list should still show the correct data (cache invalidated)

## Related Code
- `lists.component.ts`: Fixed `saveList()` method
- `user-data.service.ts`: Contains cache logic with `invalidateCache` support
- `storage.service.ts`: Handles replaceable event storage (already correct)

## Date
January 16, 2025
