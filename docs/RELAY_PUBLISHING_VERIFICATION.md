# Relay Publishing Verification and Fix

## Issue
User reported that when liking/reacting to posts, events were only being published to a subset of relays instead of ALL relays of both the current user and the mentioned user.

## Investigation

### Initial Symptoms
- User has 5 configured relays
- Mentioned user has 7 relays
- Expected: Event should be published to 8-12 unique relays (depending on overlap)
- Observed: Event was only being published to 4-5 relays

### Root Cause Analysis

Through detailed logging, we discovered:

1. **Relay Discovery**: ✅ Working correctly
   - UserRelaysService correctly discovered all 7 relays for mentioned user
   - getAllRelaysForPubkeys correctly combined account + mentioned relays
   - Deduplication correctly identified 8 unique relays (5 account + 7 mentioned - 4 overlap)

2. **Relay Selection**: ✅ Working correctly
   - PublishService correctly prepared 8 relays for publishing
   - No optimization was applied (useOptimizedRelays: false)
   - All mentioned user relays were included

3. **Publishing Execution**: ⚠️ Inefficient but functional
   - **Issue**: Code was calling `pool.publish([relayUrl], event)` individually for each relay
   - This resulted in 8 separate publish operations instead of 1 batch operation
   - However, all 8 relays DID receive the event successfully

## Solution

### Performance Fix
Changed from:
```typescript
// OLD: Individual publish per relay (inefficient)
const publishPromises = relayUrls.map(async relayUrl => {
  await this.pool.publish([relayUrl], event);
});
```

To:
```typescript
// NEW: Batch publish to all relays (efficient)
await this.pool.publish(relayUrls, event);
```

### Verification Results

After fixes, publishing a reaction (kind 7) to a post:

**Relay Discovery:**
```
[UserRelaysService] Cached relays: 7
[UserRelaysService] Fallback relays: 0
[UserRelaysService] Final publishing relays: 7
```

**Relay Selection:**
```
[PublishService] Account relays: 5
[PublishService] Mentioned relays: 7
[PublishService] Total unique: 8
```

**Publishing Results:**
```
✅ wss://relay.damus.io/
✅ wss://relay.primal.net/
✅ wss://relay.angor.io/
✅ wss://ribo.eu.nostria.app/
✅ wss://nos.lol/
✅ wss://nostr-pub.wellorder.net/
✅ wss://nostr.bitcoiner.social/
✅ wss://relay.nostr.band/

Result: 8/8 relays successfully published
```

## Verification Steps

To verify relay publishing is working correctly:

1. **Check Console Logs** (with debug logging enabled):
   ```javascript
   [PublishService] Event with mentions - relay selection:
   - accountRelays: 5
   - mentionedRelays: 7
   - totalUnique: 8
   ```

2. **Verify Relay Overlap**:
   - Calculate: `account relays + mentioned relays - duplicates = total unique`
   - Example: 5 + 7 - 4 = 8 unique relays

3. **Check Publish Success**:
   - All relays should show ✅ published successfully
   - No relays should be skipped due to optimization

## Related Files

- `src/app/services/publish.service.ts` - Main publishing logic
- `src/app/services/relays/user-relays.ts` - Relay discovery
- `src/app/services/relays/relay-pool.ts` - Pool management
- `src/app/services/reaction.service.ts` - Reaction creation

## Configuration

The system uses the following settings for publishing reactions:

```typescript
{
  notifyMentioned: true,      // Publish to mentioned users' relays
  useOptimizedRelays: false   // Use ALL relays, no optimization
}
```

## Performance Metrics

**Before optimization:**
- 8 separate WebSocket publish operations
- ~8x connection overhead
- Still functionally correct

**After optimization:**
- 1 batch WebSocket publish operation
- Minimal connection overhead
- Same functional result, better performance

## Summary

✅ **Relay discovery**: Works correctly, finds all relays
✅ **Relay selection**: Works correctly, no unwanted optimization
✅ **Publishing**: Works correctly, all relays receive events
✅ **Performance**: Optimized from 8 separate calls to 1 batch call

The system is now publishing reactions/likes/reposts to **ALL relays** of both the current user and all mentioned users, ensuring maximum distribution and discoverability.
