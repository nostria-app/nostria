# Publishing to Thread Participants' Relays

## Overview

Enhanced the event publishing logic to ensure that replies, reactions, and reposts are published to **ALL relays** of all thread participants, not just the current user's relays. This is critical for ensuring that authors receive notifications and can see engagement on their content.

## Problem Statement

Previously, when users:
- Replied to someone
- Liked/reacted to a post
- Reposted content

The event was only published to the **user's own account relays**. This meant:
- ❌ Original authors might not see replies to their posts
- ❌ Thread participants might not get notified of new messages  
- ❌ Reactions/likes might not appear for the author
- ❌ Reposts might not be visible on the author's relays

## Solution

Now, the publishing logic automatically identifies all thread participants and publishes to **ALL** of their relays:

### For Replies (Kind 1 with p-tags)
Publishes to:
1. **User's own relays** (account relays)
2. **All p-tagged users' relays** (everyone mentioned in the reply chain)
   - Root thread author
   - Immediate parent author
   - Any other mentioned participants

### For Reactions (Kind 7)
Publishes to:
1. **User's own relays**
2. **Reacted event author's relays** (p-tag)

### For Reposts (Kind 6/16)
Publishes to:
1. **User's own relays**
2. **Reposted event author's relays** (p-tag)

### For Follow Lists (Kind 3)
Publishes to:
1. **User's own relays**
2. **Newly followed users' relays** (to notify them)

## Implementation Details

### Key Principle: ALL Relays, No Optimization

**For Publishing**: Uses **ALL** discovered relays without optimization
- Optimal relay selection is for **reading** only
- Publishing requires maximum distribution
- No limits on relay count for publishing

**For Reading**: Uses optimized relay selection
- Limited to top 3-10 relays based on performance
- Prioritizes connected and responsive relays
- Reduces bandwidth and connection overhead

### Code Changes

#### 1. PublishService (`publish.service.ts`)

**New Option**: `notifyMentioned`
```typescript
export interface PublishOptions {
  /** For replies, reactions, reposts: whether to publish to mentioned users' relays (default: true) */
  notifyMentioned?: boolean;
  
  /** Whether to use optimized relay selection (default: false for publishing) */
  useOptimizedRelays?: boolean;
  
  // ... other options
}
```

**New Method**: `getMentionedUsersRelays()`
```typescript
private async getMentionedUsersRelays(mentionedPubkeys: string[]): Promise<string[]> {
  // Returns ALL relays for all mentioned users
  return await this.getAllRelaysForPubkeys(mentionedPubkeys);
}
```

**New Method**: `getAllRelaysForPubkeys()`
```typescript
private async getAllRelaysForPubkeys(pubkeys: string[]): Promise<string[]> {
  // Processes in batches of 20
  // Uses userRelaysService.getUserRelaysForPublishing() - returns ALL relays
  // No optimization, no limits
}
```

**Updated**: `getRelayUrlsForPublish()`
```typescript
// Now detects kinds 1, 6, 7, 16 with p-tags
// Extracts all mentioned pubkeys
// Fetches ALL their relays
// Combines with account relays
// Returns complete set without optimization
```

#### 2. UserRelaysService (`user-relays.ts`)

**Method Used**: `getUserRelaysForPublishing()`
```typescript
async getUserRelaysForPublishing(pubkey: string): Promise<string[]> {
  // 1. Gets relays from cache (discovery service results)
  // 2. Gets relays from observed relay hints
  // 3. Removes duplicates and normalizes URLs
  // 4. Returns ALL relays (no limiting or optimization)
}
```

#### 3. NostrService (`nostr.service.ts`)

**Updated**: `signAndPublish()`
```typescript
const options = signedEvent.kind === kinds.Contacts
  ? { notifyFollowed: true, useOptimizedRelays: false }
  : { notifyMentioned: true, useOptimizedRelays: false };
```

Now automatically enables `notifyMentioned` for all non-follow events.

## How It Works

### Example: Replying in a Thread

1. **User A** creates a post
2. **User B** replies to User A
3. **User C** replies to User B (in the thread)

When User C publishes their reply:

**Tags in Event**:
```json
{
  "tags": [
    ["e", "root_event_id", "", "root"],
    ["e", "parent_event_id", "", "reply"],
    ["p", "user_a_pubkey"],
    ["p", "user_b_pubkey"]
  ]
}
```

**Publishing Process**:
1. Extract p-tags: `["user_a_pubkey", "user_b_pubkey"]`
2. Get User A's relays: `await getUserRelaysForPublishing("user_a_pubkey")`
3. Get User B's relays: `await getUserRelaysForPublishing("user_b_pubkey")`
4. Get User C's relays: `accountRelay.getRelayUrls()`
5. Combine all relays (deduplicated)
6. Publish to **ALL** relays in the combined set

**Result**:
- ✅ User A sees the reply on their relays
- ✅ User B sees the reply on their relays
- ✅ User C's reply is on their own relays
- ✅ All participants can discover the full thread

### Example: Liking a Post

1. **User A** creates a post
2. **User B** likes the post

When User B publishes their reaction:

**Tags in Event**:
```json
{
  "kind": 7,
  "tags": [
    ["e", "post_event_id"],
    ["p", "user_a_pubkey"]
  ],
  "content": "+"
}
```

**Publishing Process**:
1. Extract p-tags: `["user_a_pubkey"]`
2. Get User A's relays: `await getUserRelaysForPublishing("user_a_pubkey")`
3. Get User B's relays: `accountRelay.getRelayUrls()`
4. Combine and publish to **ALL**

**Result**:
- ✅ User A sees the like on their relays
- ✅ User B's like is recorded on their relays
- ✅ Like count updates correctly for User A

## Relay Discovery Process

For each mentioned user, the system:

1. **Checks cache** (5-minute TTL)
2. **If not cached, discovers** via:
   - Discovery relays (NIP-65 kind 10002)
   - Contact lists (kind 3)
   - Fallback relays
   - Observed relay hints
3. **Returns ALL found relays** (not optimized)
4. **Caches for future use**

## Performance Considerations

### Batching
- Processes users in batches of 20
- Prevents overwhelming the system
- Parallel async operations within batches

### Caching
- 5-minute cache for relay lists
- Prevents redundant discovery calls
- In-flight request deduplication

### Publishing
- Uses Promise.allSettled for parallel publishing
- 10-second timeout (configurable)
- Continues even if some relays fail
- Success if at least one relay accepts

## Logging

Comprehensive debug logging at each step:

```javascript
'[PublishService] Event with mentions - publishing to account + mentioned users relays', {
  kind: event.kind,
  accountRelays: accountRelayUrls.length,
  mentionedUsers: mentionedPubkeys.length,
  mentionedRelays: mentionedRelayUrls.length,
  totalUnique: allRelayUrls.size,
}
```

## Benefits

1. **Improved Discoverability**: Events reach all relevant parties
2. **Better Notifications**: Authors see all interactions
3. **Thread Continuity**: Complete threads visible to all participants
4. **Network Effects**: Wider distribution leads to more engagement
5. **Decentralization**: No single point of failure
6. **User Experience**: Things "just work" as expected

## Backwards Compatibility

- ✅ Fully backwards compatible
- ✅ Defaults to including mentioned users' relays
- ✅ Can be disabled with `notifyMentioned: false`
- ✅ Existing code continues to work

## Testing

To verify the implementation:

1. **Create a thread**:
   - User A posts
   - User B replies
   - User C replies to User B

2. **Check published relays**:
   - Look at debug logs
   - Verify all participants' relays are included

3. **Verify visibility**:
   - Check User A sees the reply on their client
   - Check User B sees the reply on their client
   - Thread appears complete for all

4. **Test reactions**:
   - Like a post from a different user
   - Verify reaction appears on author's relays

## Configuration

**Default Behavior**: `notifyMentioned: true`

**To Disable** (not recommended):
```typescript
await publishService.publish(event, {
  notifyMentioned: false,
  useOptimizedRelays: false
});
```

**Custom Relay URLs** (overrides all auto-discovery):
```typescript
await publishService.publish(event, {
  relayUrls: ['wss://relay1.com', 'wss://relay2.com']
});
```

## Future Enhancements

Potential improvements:

1. **Relay Hints in e-tags**: Use relay hints from event tags
2. **Configurable Batch Size**: Allow tuning batch processing
3. **Priority Relays**: Mark certain relays as high-priority
4. **Publishing Analytics**: Track which relays accept/reject events
5. **Retry Logic**: Automatic retry for failed relays
6. **Relay Health Checks**: Skip known-offline relays
7. **User Preferences**: Allow users to configure relay publishing behavior

## Related NIPs

- **NIP-01**: Basic protocol, event kinds
- **NIP-10**: Conventions for clients' use of e and p tags in text events
- **NIP-18**: Reposts (kind 6 and 16)
- **NIP-25**: Reactions (kind 7)
- **NIP-65**: Relay List Metadata (kind 10002)

## Summary

This implementation ensures that **all thread participants receive events on ALL their configured relays**, dramatically improving the reliability and user experience of Nostr interactions. The system intelligently identifies all relevant parties and distributes events widely while maintaining performance through caching and batching.
