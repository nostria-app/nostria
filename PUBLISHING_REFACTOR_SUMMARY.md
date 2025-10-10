# Publishing Refactor Summary

## What Was Changed

This refactor introduces a new `PublishService` that provides better control over Nostr event publishing while maintaining full backwards compatibility with existing code.

## New Files Created

1. **`src/app/services/publish.service.ts`** - New service for controlled publishing
2. **`PUBLISHING_PATTERN.md`** - Comprehensive documentation of the new pattern
3. **`docs/PUBLISHING_EXAMPLES.md`** - Practical code examples

## Modified Files

1. **`src/app/services/nostr.service.ts`**
   - Added `PublishService` injection
   - Updated the signal effect to use `PublishService`
   - Updated `signAndPublish()` to use `PublishService`
   - Both changes maintain backwards compatibility

## Key Features

### 1. Better Publishing Control

```typescript
const result = await publishService.publish(signedEvent, {
  relayUrls: ['wss://custom.relay.com'],  // Optional: specific relays
  useOptimizedRelays: false,               // Optional: disable optimization
  notifyFollowed: true,                    // Optional: for kind 3 events
  timeout: 10000                           // Optional: custom timeout
});
```

### 2. Kind 3 (Follow List) Special Handling

**The Problem:** When a user follows someone, the followed user wasn't being notified because the follow event was only published to the follower's relays, not the followed user's relays.

**The Solution:** When `notifyFollowed: true` (default for kind 3):
- Publishes to the user's account relays (as usual)
- **Also publishes to ALL relays of the newly followed user(s)**
- Uses non-optimized relay selection for maximum reach
- Ensures newly followed users receive follow notifications

```typescript
// This event will be published to:
// 1. Current user's account relays
// 2. ALL relays of the newly followed user(s) in the event
await publishService.publish(followListEvent, {
  notifyFollowed: true,      // Publish to newly followed users' relays
  useOptimizedRelays: false, // Use ALL relays, not just optimal ones
  newlyFollowedPubkeys: ['pubkey1', 'pubkey2']  // Specify which users were just followed
});
});
```

### 3. No Circular Dependencies

The new service injects its dependencies directly and doesn't create circular reference chains:

```typescript
@Injectable({ providedIn: 'root' })
export class PublishService {
  private readonly relaysService = inject(RelaysService);
  private readonly pool = inject(RelayPoolService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly userRelaysService = inject(UserRelaysService);
  // ... no circular dependencies
}
```

### 4. Full Backwards Compatibility

**All existing code continues to work without changes:**

```typescript
// Pattern 1: Signal-based (still works)
accountState.publish.set(event);

// Pattern 2: NostrService method (still works)
await nostrService.signAndPublish(event);
```

Both patterns now use `PublishService` internally and benefit from the improvements.

## How It Works

### Publishing Flow

1. **Event Creation** → User creates an unsigned event
2. **Signing** → Event is signed (via NostrService or extension)
3. **Relay Selection** → PublishService determines which relays to use:
   - Explicit relay URLs from options, OR
   - Account relays (from AccountRelayService)
   - For kind 3: Also gets followed users' relays
4. **Optimization** → Optionally applies relay optimization
5. **Publishing** → Uses RelayPoolService to publish to selected relays
6. **Result** → Returns detailed results per relay

### Kind 3 Special Flow

```
Follow Event Created
        ↓
Extract newly followed pubkeys (filtered from existing follows)
        ↓
Get relay URLs for each newly followed user (batched)
        ↓
Combine: Account relays + Newly followed users' relays
        ↓
Publish to ALL relays (no optimization)
        ↓
Newly followed users receive notification
```

## Migration Guide

### For Existing Code

**No changes needed!** All existing patterns continue to work:

```typescript
// These all still work exactly as before
accountState.publish.set(event);
await nostrService.signAndPublish(event);
```

### For New Code

**Use the new PublishService directly for more control:**

```typescript
// Inject the service
private readonly publishService = inject(PublishService);

// Direct publishing with options
const result = await publishService.publish(signedEvent, {
  useOptimizedRelays: true
});

// Check results
if (result.success) {
  console.log('Published successfully');
}
```

## Benefits

1. **✅ Solves Follow Notification Issue** - Kind 3 events now reach newly followed users (not all users in the list)
2. **✅ Better Control** - Choose relays, optimization strategy per publish
3. **✅ No Breaking Changes** - All existing code works unchanged
4. **✅ No Circular Dependencies** - Clean service architecture
5. **✅ Better Error Handling** - Detailed per-relay results
6. **✅ Testability** - Easier to test and mock
7. **✅ Future-Proof** - Easy to add new features (retry logic, metrics, etc.)
8. **✅ Efficient** - Only publishes to newly followed users' relays, not entire follow list

## Testing Recommendations

### Test Kind 3 Publishing

1. Create a follow list event
2. Publish using `publishService.publish(event, { notifyFollowed: true })`
3. Verify event is published to:
   - Account relays
   - All relays of all followed users

### Test Backwards Compatibility

1. Use existing `accountState.publish.set(event)` pattern
2. Verify it still works as expected
3. Check that kind 3 events properly notify followed users

### Test Custom Relay Selection

1. Publish with explicit `relayUrls` option
2. Verify event only goes to specified relays
3. Check optimization is skipped when `useOptimizedRelays: false`

## Performance Considerations

- **Batch Processing**: Followed user relay discovery is done in batches of 20
- **Caching**: Uses existing `UserRelaysService` cache for relay URLs
- **Deduplication**: All relay URLs are deduplicated before publishing
- **Concurrency**: Publishing to multiple relays happens in parallel

## Future Enhancements

Potential improvements that can be added:

1. **Retry Logic** - Automatically retry failed publishes with backoff
2. **Priority Relays** - Mark certain relays as critical (must succeed)
3. **Event Strategies** - Different publishing strategies per event kind
4. **Metrics** - Track publish success rates, latency per relay
5. **Batch Publishing** - Efficiently publish multiple events together
6. **User Preferences** - Let users configure their own publish strategies

## Technical Notes

- Service uses Angular's `inject()` function for dependency injection
- All relay URLs are normalized before publishing
- For kind 3 events, relay discovery has a 20-pubkey batch limit
- Service integrates with existing `RelaysService` for performance tracking
- Error handling returns detailed per-relay results
- Timeout defaults to 10 seconds, configurable per publish

## Documentation

- **`PUBLISHING_PATTERN.md`** - Complete pattern documentation
- **`docs/PUBLISHING_EXAMPLES.md`** - Code examples for various scenarios
- **`src/app/services/publish.service.ts`** - Inline code documentation

## Questions?

For questions about the new publishing pattern:

1. Check `PUBLISHING_PATTERN.md` for detailed documentation
2. See `docs/PUBLISHING_EXAMPLES.md` for code examples
3. Review `publish.service.ts` for implementation details
4. Look at `nostr.service.ts` for integration with existing patterns
