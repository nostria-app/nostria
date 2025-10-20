# Critical Data Synchronization Fix - Relay-First Pattern

## Issue Description

When starting the app or switching accounts, Nostria was loading critical user data (profile, following list, mute list) from local IndexedDB storage **first**, only fetching from relays as a secondary/background operation. This created a **DATA LOSS scenario** where:

1. User follows someone in Nostria instance A → publishes to relays
2. User opens Nostria instance B → loads stale following list from local storage
3. User follows someone else in instance B → publishes combined list
4. **Result**: The follow from instance A gets overwritten/lost

## Root Cause

The original pattern treated local storage as the primary data source with relays as a backup:
```typescript
// OLD PATTERN (INCORRECT)
let data = await storage.get();
if (!data) {
  data = await relay.get();
} else {
  // Queue background refresh but use stale data immediately
}
```

This violated the Nostr protocol principle that **relays are the source of truth**, not local caches.

## Solution

Inverted the loading pattern to fetch from relays **first** during initialization and any modification operations, falling back to storage only if relay connection fails:

```typescript
// NEW PATTERN (CORRECT)
let data = await relay.get();
if (data) {
  await storage.save(data);
} else {
  // Fallback to storage only if relay unreachable
  data = await storage.get();
}
```

## Files Modified

### 1. `nostr.service.ts`

**Modified Methods:**
- `loadAccountFollowing()` - Now fetches following list (kind 3) from relay first
- `loadAccountMuteList()` - Now fetches mute list (kind 10000) from relay first
- `load()` metadata section - Enhanced with explicit storage fallback and logging
- `getMediaServers()` - Now fetches media server list (kind 10063) from relay first

**Key Changes:**
```typescript
// Before: storage → relay
let followingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
if (!followingEvent) {
  followingEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
}

// After: relay → storage fallback
let followingEvent = await this.accountRelay.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
if (followingEvent) {
  await this.storage.saveEvent(followingEvent);
  this.logger.info('Loaded fresh following list from relay');
} else {
  this.logger.warn('Could not fetch following list from relay, falling back to storage');
  followingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
}
```

### 2. `account-state.service.ts`

**New Import:**
```typescript
import { AccountRelayService } from './relays/account-relay';
```

**New Injection:**
```typescript
private readonly accountRelay = inject(AccountRelayService);
```

**Modified Methods:**
- `follow()` - Now fetches current following list from relay before adding new follows
- `unfollow()` - Now fetches current following list from relay before removing follows

**Critical Fix:**
These methods previously loaded from storage when modifying the following list, which meant they could overwrite changes made in other instances. Now they always fetch fresh data from relays first.

### 3. `settings/relays/relays.component.ts`

**Modified Methods:**
- `checkFollowingListForRelays()` - Now fetches from relay first when checking for deprecated relay URLs
- `cleanFollowingListFromRelays()` - Now fetches from relay first before cleaning deprecated relays

## Architecture Pattern

### Data Flow Hierarchy
1. **Relay (Source of Truth)** - Always fetch first during initialization/modifications
2. **Local Storage (Offline Cache)** - Only used when relay is unreachable
3. **Live Subscriptions** - Keep data fresh with real-time updates

### When Each Pattern Applies

**Relay-First (Critical):**
- App startup/initialization
- Account switching
- Any operation that modifies data (follow/unfollow/profile updates)
- Settings pages that modify data

**Storage-First (Acceptable):**
- Read-only display operations (viewing posts, profiles)
- Data that doesn't need to be current (historical events)
- Offline-first features

**Subscription-Based (Real-time):**
- Live updates for current user's events (kind 0, 3, 10000)
- Real-time notifications
- Feed updates

## Testing Recommendations

1. **Multi-Instance Test:**
   - Open Nostria in two different browsers/profiles
   - Follow someone in instance A
   - Immediately open instance B
   - Verify instance B shows the new follow
   - Follow someone else in instance B
   - Verify both follows are preserved

2. **Offline Fallback Test:**
   - Disconnect network
   - Restart app
   - Verify it loads cached data
   - Reconnect network
   - Verify it fetches fresh data on next operation

3. **Race Condition Test:**
   - Follow multiple people quickly across instances
   - Verify all follows are preserved (no overwrites)

## Benefits

1. **Data Consistency** - Multiple instances always work with latest data
2. **No Data Loss** - Changes in one instance won't be overwritten by another
3. **Proper Nostr Protocol** - Relays are source of truth, as intended
4. **Better Logging** - Clear messages about data source (relay vs storage)
5. **Offline Support** - Storage fallback ensures app works without connection

## Lint Notes

Pre-existing lint errors remain in the codebase (unrelated to this fix):
- `any` type usage in various places
- Unused variables in catch blocks
- Empty lifecycle methods

These are technical debt that should be addressed separately.

## Related NIPs

- **NIP-01** - Basic protocol events and relay communication
- **NIP-02** - Contact List and Petnames (kind 3)
- **NIP-51** - Lists (kind 10000 for mute list)
- **NIP-65** - Relay List Metadata (kind 10002)

## Future Improvements

1. Add exponential backoff for relay connection failures
2. Implement optimistic updates with rollback on conflict
3. Add conflict resolution UI for simultaneous edits
4. Cache relay responses with TTL for better performance
5. Implement delta synchronization to reduce bandwidth
