# Publishing Fix: Targeted Follow Notifications

## Issue Identified

The initial implementation was publishing kind 3 (follow list) events to **ALL followed users' relays**, which would be:
- **Inefficient** - Publishing to potentially hundreds or thousands of relays
- **Unnecessary** - Only newly followed users need to be notified
- **Potentially problematic** - Could cause rate limiting or performance issues

## Fix Applied

Updated the publishing mechanism to only publish to **newly followed users' relays**.

### Changes Made

#### 1. Added `newlyFollowedPubkeys` to `PublishOptions`

```typescript
interface PublishOptions {
  relayUrls?: string[];
  useOptimizedRelays?: boolean;
  notifyFollowed?: boolean;
  newlyFollowedPubkeys?: string[];  // NEW: Specific pubkeys that were newly followed
  timeout?: number;
}
```

#### 2. Updated `getFollowedUsersRelays()` Method

The method now accepts an optional `newlyFollowedPubkeys` parameter:
- If provided, uses only those specific pubkeys
- If not provided, falls back to all p tags in the event (backwards compatible)

```typescript
private async getFollowedUsersRelays(
  event: Event, 
  newlyFollowedPubkeys?: string[]
): Promise<string[]>
```

#### 3. Added Signal to Track Newly Followed Users

In `AccountStateService`:

```typescript
// Signal to store newly followed pubkeys for the current publish operation
newlyFollowedPubkeys = signal<string[]>([]);
```

#### 4. Updated `follow()` Method

Now stores the newly followed pubkeys before publishing:

```typescript
// Store the newly followed pubkeys for the publish operation
this.newlyFollowedPubkeys.set(newPubkeys);

// Publish the event
this.publish.set(followingEvent);
```

#### 5. Updated NostrService Effect

The publish effect now passes the newly followed pubkeys to the PublishService:

```typescript
const newlyFollowedPubkeys = signedEvent.kind === kinds.Contacts 
  ? this.accountState.newlyFollowedPubkeys()
  : undefined;

const options = signedEvent.kind === kinds.Contacts
  ? { 
      notifyFollowed: true, 
      useOptimizedRelays: false,
      newlyFollowedPubkeys  // Pass the newly followed pubkeys
    }
  : { useOptimizedRelays: true };
```

After publishing, the signal is cleared:

```typescript
untracked(() => {
  this.accountState.publish.set(undefined);
  this.accountState.newlyFollowedPubkeys.set([]);  // Clear after publish
});
```

## Example Usage

### Using the Signal Pattern (Backwards Compatible)

```typescript
// In AccountStateService.follow()
const newPubkeys = ['pubkey1', 'pubkey2'];

// Store newly followed pubkeys
this.newlyFollowedPubkeys.set(newPubkeys);

// Publish - automatically uses newlyFollowedPubkeys
this.publish.set(followingEvent);
```

### Using PublishService Directly

```typescript
const result = await publishService.publish(followListEvent, {
  notifyFollowed: true,
  useOptimizedRelays: false,
  newlyFollowedPubkeys: ['pubkey1', 'pubkey2']  // Explicit list
});
```

## Benefits

1. **Efficient** - Only publishes to newly followed users' relays
2. **Targeted** - Notifications only go to users who were just followed
3. **Backwards Compatible** - Falls back to all p tags if not specified
4. **Scalable** - Works well even with large follow lists
5. **Clear Intent** - Explicitly shows which users should be notified

## Example Scenarios

### Scenario 1: Following 1 New User (with 200 existing follows)

**Before:** Publishes to ~2000+ relays (200 users × ~10 relays each)
**After:** Publishes to ~10 relays (1 user × ~10 relays)
**Improvement:** 200x reduction in relay publishes

### Scenario 2: Following 5 New Users (with 200 existing follows)

**Before:** Publishes to ~2000+ relays (200 users × ~10 relays each)
**After:** Publishes to ~50 relays (5 users × ~10 relays)
**Improvement:** 40x reduction in relay publishes

### Scenario 3: First-Time Follow (no existing follows)

**Before:** Publishes to ~10 relays (1 user × ~10 relays)
**After:** Publishes to ~10 relays (1 user × ~10 relays)
**Improvement:** No change (already optimal)

## Testing Recommendations

1. **Test Single Follow**
   - Follow one new user
   - Verify event is published to only that user's relays

2. **Test Multiple Follows**
   - Follow multiple new users at once
   - Verify event is published to all newly followed users' relays

3. **Test with Large Follow List**
   - User has 500+ existing follows
   - Follow 1 new user
   - Verify only the new user's relays are used (not all 500+)

4. **Test Backwards Compatibility**
   - Call PublishService without `newlyFollowedPubkeys`
   - Verify it falls back to all p tags in event

## Documentation Updated

All documentation has been updated to reflect this change:
- ✅ `PUBLISHING_REFACTOR_SUMMARY.md`
- ✅ `PUBLISHING_PATTERN.md`
- ✅ `PUBLISHING_QUICK_REFERENCE.md`

## Migration Notes

**No migration required!** This is a fully backwards-compatible improvement:
- Existing code continues to work
- Signal-based publishing automatically uses the new efficient approach
- Direct PublishService calls can optionally specify `newlyFollowedPubkeys`
