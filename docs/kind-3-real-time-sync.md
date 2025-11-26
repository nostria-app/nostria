# Kind 3 Event Real-time Synchronization

## Overview

This implementation ensures that when a user follows or unfollows accounts on one device, the changes are immediately reflected on all other devices running Nostria without requiring a reload.

## How It Works

### 1. Subscription to Kind 3 Events

The `NostrService` subscribes to kind 3 (contact list) events for the current user's account:

```typescript
// nostr.service.ts - subscribeToAccountMetadata()
const filter = {
  kinds: [kinds.Contacts], // kind 3
  authors: [pubkey],
};
```

### 2. Processing Received Events

When a kind 3 event is received via subscription:

```typescript
// nostr.service.ts
case kinds.Contacts: {
  // Uses parseFollowingList to detect if list actually changed
  await this.accountState.parseFollowingList(event);
  break;
}
```

The `parseFollowingList` method checks if the list has changed before updating:

```typescript
// account-state.service.ts
async parseFollowingList(event: Event) {
  const followingTags = this.utilities.getTags(event, 'p');
  const currentFollowingList = this.followingList();
  
  // Only update if list has actually changed
  const hasChanged = !this.utilities.arraysEqual(currentFollowingList, followingTags);
  if (hasChanged) {
    this.followingList.set(followingTags);
    await this.storage.saveEvent(event);
  }
}
```

### 3. Incremental Profile Updates

The `FollowingService` watches for changes to the `followingList` signal and performs incremental updates:

```typescript
// following.service.ts
constructor() {
  effect(() => {
    const followingList = this.accountState.followingList();
    
    if (isInitialLoad) {
      // Load all profiles on first load
      this.loadProfiles(followingList);
    } else {
      // Incremental update - only add/remove changed profiles
      this.handleIncrementalUpdate(followingList);
    }
  });
}
```

The incremental update:
- Calculates the difference between old and new following lists
- Removes unfollowed profiles from the cache
- Adds newly followed profiles to the cache

## Benefits

1. **Immediate Synchronization**: Changes are reflected immediately without requiring a reload
2. **Efficient**: Only updates the profiles that changed, not the entire list
3. **Fresh Data**: New profiles are fetched from relays to ensure up-to-date information
4. **Persistent**: Events are saved to storage for offline access

## Example Scenario

1. User follows Alice on Device A
2. Device A publishes a kind 3 event with Alice's pubkey
3. Device B receives the kind 3 event via subscription
4. Device B detects Alice's pubkey was added
5. Device B fetches Alice's profile from relays
6. Alice's profile appears in Device B's following list immediately

## Technical Details

- **Event Type**: Kind 3 (Contact List)
- **Tags**: `p` tags containing followed pubkeys
- **Subscription**: Persistent subscription to user's own kind 3 events
- **Storage**: Events are saved to IndexedDB for persistence
- **Caching**: Profiles are cached in the FollowingService for fast access
