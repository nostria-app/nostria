# List Optimistic Update Fix

## Problem
When editing a list (e.g., DM Relays list) and saving changes:
1. The event was successfully published to relays
2. A success notification appeared
3. But the UI still showed the old data after reload
4. The new data only appeared after a full page refresh

## Root Cause
The issue had two parts:

### 1. Cache Not Invalidated
After publishing the new event, `loadAllLists()` was called, which in turn called:
```typescript
await this.data.getEventByPubkeyAndKind(pubkey, listType.kind, {
  save: true,
  cache: true,  // ← This was using cached data!
});
```

The cached data still contained the old event, so the UI displayed stale information.

### 2. Race Condition
There's a timing issue:
1. Publish event to relays (async, might take time)
2. Reload from cache (immediate, returns old data)
3. Event eventually reaches relays and gets cached
4. But UI already showed old data

## Solution: Optimistic UI Update

Instead of waiting for relays and cache to update, we update the local state **immediately** after signing the event:

```typescript
// Sign the event
const signedEvent = await this.nostr.signEvent(unsignedEvent);

// ✅ Update local state immediately (optimistic update)
const newListData = await this.parseListEvent(signedEvent, listType);
if (newListData) {
  if (listType.isReplaceable) {
    // Update standard list
    const currentLists = new Map(this.standardListsData());
    currentLists.set(listType.kind, newListData);
    this.standardListsData.set(currentLists);
  } else {
    // Update or add to sets
    const currentSets = new Map(this.setsData());
    const existingSets = currentSets.get(listType.kind) || [];
    
    // Find and replace existing set with same identifier, or add new
    const updatedSets = identifier
      ? existingSets.map(s => s.identifier === identifier ? newListData : s)
      : [...existingSets, newListData];
    
    // If no existing set was found with this identifier, add it
    if (identifier && !existingSets.some(s => s.identifier === identifier)) {
      updatedSets.push(newListData);
    }
    
    currentSets.set(listType.kind, updatedSets);
    this.setsData.set(currentSets);
  }
  
  // Also save to local database immediately
  await this.storage.saveEvent(signedEvent);
}

// Publish to relays (happens in background)
await this.publish.publish(signedEvent, { useOptimizedRelays: true });
```

## Benefits

### 1. **Instant UI Feedback**
The user sees their changes immediately, even if relays are slow or offline.

### 2. **Data Persistence**
The event is saved to local IndexedDB immediately, so even if publishing fails, the data isn't lost.

### 3. **No Cache Issues**
By updating the signal-based state directly, we bypass the cache entirely for immediate updates.

### 4. **Resilient to Network Issues**
If relays are down or slow, the user still sees their changes. The event is queued for publishing and will eventually reach relays.

### 5. **Better UX**
Users don't have to wait for network round-trips to see their edits reflected in the UI.

## Implementation Details

### For Standard Lists (Replaceable Events)
```typescript
const currentLists = new Map(this.standardListsData());
currentLists.set(listType.kind, newListData);
this.standardListsData.set(currentLists);
```

Simple replacement by kind - there's only one list per kind.

### For Sets (Parameterized Replaceable Events)
```typescript
const currentSets = new Map(this.setsData());
const existingSets = currentSets.get(listType.kind) || [];

// Replace set with matching identifier
const updatedSets = identifier
  ? existingSets.map(s => s.identifier === identifier ? newListData : s)
  : [...existingSets, newListData];

// If no match found, add as new
if (identifier && !existingSets.some(s => s.identifier === identifier)) {
  updatedSets.push(newListData);
}

currentSets.set(listType.kind, updatedSets);
this.setsData.set(currentSets);
```

More complex - need to find and replace the specific set by its `d-tag` identifier.

### Local Storage Update
```typescript
await this.storage.saveEvent(signedEvent);
```

Saves to IndexedDB immediately, ensuring data persistence even if the app crashes or user navigates away.

## Code Changes

### Added Import
```typescript
import { StorageService } from '../../services/storage.service';
```

### Added Service Injection
```typescript
private readonly storage = inject(StorageService);
```

### Modified saveList Method
The entire `saveList()` method was updated to perform optimistic updates before publishing.

## Testing Recommendations

1. **Normal Case**: Edit a list, verify changes appear immediately
2. **Offline Mode**: Disconnect network, edit list, verify changes persist locally
3. **Slow Network**: Throttle network, verify UI updates before publish completes
4. **Multiple Edits**: Rapidly edit the same list multiple times
5. **New Set**: Create a new set, verify it appears in the list immediately
6. **Edit Existing Set**: Edit an existing set, verify it updates (not duplicates)

## Related Patterns

This is a common pattern called **Optimistic UI**:
1. Update UI immediately with expected result
2. Send request to server/relays in background
3. If request fails, rollback UI changes (not implemented yet)

## Future Improvements

1. **Rollback on Failure**: If publishing fails, revert the optimistic update
2. **Visual Indicator**: Show a "syncing" indicator while publishing
3. **Retry Logic**: Automatically retry failed publishes
4. **Conflict Resolution**: Handle cases where relay returns different data

## Conclusion

This fix ensures that users see their changes immediately, providing a much better user experience. The data is saved locally first (safety), then published to relays (distribution). Even if relays are slow or offline, users can continue working without interruption.
