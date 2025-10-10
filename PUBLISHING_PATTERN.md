# Publishing Pattern Refactor

## Overview

This document describes the new publishing pattern introduced to provide better control over Nostr event publishing while maintaining backwards compatibility with existing code.

## Problem

The previous publishing pattern relied on Angular signals and effects, which led to:

1. **Circular dependency issues** - Services needed to depend on each other to handle publishing
2. **Limited control** - Hard to specify which relays to use for different event types
3. **Missing functionality** - Kind 3 (follow list) events weren't being published to newly followed users' relays, preventing follow notifications
4. **Inefficiency** - No way to target only newly followed users vs. entire follow list

## Solution

A new `PublishService` has been introduced that:

- Provides fine-grained control over publishing options
- Handles special cases (e.g., kind 3 events) automatically
- Avoids circular dependencies by being standalone
- Maintains backwards compatibility with the signal-based pattern

## Architecture

### New Service: `PublishService`

```typescript
interface PublishOptions {
  relayUrls?: string[];           // Explicit relay URLs to use
  useOptimizedRelays?: boolean;   // Whether to optimize relay selection (default: true)
  notifyFollowed?: boolean;       // For kind 3, publish to newly followed users' relays (default: true)
  newlyFollowedPubkeys?: string[]; // Specific pubkeys that were newly followed (for targeted notification)
  timeout?: number;               // Timeout in milliseconds (default: 10000)
}

interface PublishResult {
  success: boolean;
  relayResults: Map<string, { success: boolean; error?: string }>;
  event: Event;
}
```

### Key Methods

#### `publish(event: Event, options?: PublishOptions): Promise<PublishResult>`

Publishes a signed event with full control over options.

```typescript
const result = await publishService.publish(signedEvent, {
  useOptimizedRelays: true,
  notifyFollowed: true  // Only relevant for kind 3 events
});

if (result.success) {
  console.log('Published successfully to', result.relayResults.size, 'relays');
}
```

#### `signAndPublish(event: UnsignedEvent, signFn: Function, options?: PublishOptions): Promise<PublishResult>`

Signs and publishes an unsigned event. Requires a signing function to avoid circular dependencies.

```typescript
const result = await publishService.signAndPublish(
  unsignedEvent,
  (evt) => nostrService.signEvent(evt),
  { useOptimizedRelays: false }
);
```

## Special Handling

### Kind 3 (Follow List) Events

When a kind 3 event is published with `notifyFollowed: true` (default), the service:

1. Publishes to the user's account relays (as usual)
2. **Also publishes to ALL relays of followed users** (not just optimized selection)
3. This ensures followed users receive follow notifications

This is the key improvement - previously, followed users wouldn't be notified of new followers.

### Relay Selection

- **Optimized mode** (default): Uses `RelaysService.getOptimalRelays()` to select the best performing relays
- **Non-optimized mode**: Uses all available relays (important for kind 3 to maximize notification reach)

## Usage Patterns

### 1. Direct Publishing (New Pattern - Recommended)

```typescript
// In a component or service
const publishService = inject(PublishService);
const nostrService = inject(NostrService);

// Sign and publish
const unsignedEvent = nostrService.createEvent(1, 'Hello Nostr!', []);
const signedEvent = await nostrService.signEvent(unsignedEvent);

const result = await publishService.publish(signedEvent, {
  useOptimizedRelays: true
});

if (result.success) {
  // Handle success
} else {
  // Handle failure
}
```

### 2. Signal-Based Publishing (Legacy Pattern - Still Supported)

The old pattern using `accountState.publish` signal is still fully supported:

```typescript
// This still works and uses PublishService internally
const event = nostrService.createEvent(1, 'Hello!', []);
accountState.publish.set(event); // Triggers automatic signing & publishing
```

The `NostrService` has an effect that watches this signal and uses `PublishService` internally with appropriate options.

### 3. Using NostrService Convenience Method

```typescript
const nostrService = inject(NostrService);

// This now uses PublishService internally
const success = await nostrService.signAndPublish(unsignedEvent);
```

## Migration Guide

### Existing Code

No changes required! All existing code using:
- `accountState.publish.set(event)` 
- `nostrService.signAndPublish(event)`

...continues to work exactly as before, but now benefits from:
- Better relay selection
- Proper follow notifications (kind 3)
- Improved error handling

### New Code

For new features, prefer the direct `PublishService` pattern:

```typescript
const publishService = inject(PublishService);

// For regular events
await publishService.publish(signedEvent);

// For follow list with explicit options
await publishService.publish(followListEvent, {
  notifyFollowed: true,
  useOptimizedRelays: false  // Use all relays for maximum reach
});

// For custom relay targeting
await publishService.publish(event, {
  relayUrls: ['wss://custom-relay.example.com'],
  useOptimizedRelays: false
});
```

## Benefits

### 1. No Circular Dependencies

`PublishService` injects its dependencies directly and doesn't create circular reference chains.

### 2. Better Control

You can now:
- Choose specific relays for publishing
- Control relay optimization per publish operation
- Handle results and errors more granularly

### 3. Follow Notifications

Kind 3 events are now properly published to newly followed users' relays (not all users in the follow list), enabling them to receive follow notifications efficiently.

### 4. Testability

The new service is easier to test:
- Mock `signFn` for testing without actual signing
- Verify relay selection logic
- Test special kind handling

### 5. Backwards Compatibility

No breaking changes - all existing code continues to work.

## Implementation Details

### Relay URL Resolution for Kind 3

When publishing kind 3 (follow list) events:

1. Check if `newlyFollowedPubkeys` is provided in options
2. If provided, use only those pubkeys; otherwise extract all `p` tags from the event
3. For each newly followed pubkey, get their relay URLs from `UserRelaysService`
4. Combine with account relays
5. Publish to ALL unique relay URLs (no optimization)

This ensures maximum reach for follow notifications while being efficient by only targeting newly followed users.

### Error Handling

The service returns detailed results per relay:

```typescript
const result = await publishService.publish(event);

// Check overall success
if (!result.success) {
  console.error('Publishing failed');
  
  // Check individual relay results
  result.relayResults.forEach((relayResult, url) => {
    if (!relayResult.success) {
      console.error(`Failed to publish to ${url}: ${relayResult.error}`);
    }
  });
}
```

## Future Enhancements

Potential improvements for the future:

1. **Retry logic** - Automatically retry failed publishes
2. **Priority relays** - Mark certain relays as "must succeed"
3. **Event-specific strategies** - Different publishing strategies per event kind
4. **Metrics** - Track publish success rates per relay
5. **Batch publishing** - Publish multiple events efficiently

## Notes

- The service uses lazy injection of some dependencies to avoid circular references
- For kind 3 events, relay discovery is done in batches of 20 to avoid overwhelming the system
- All relay URLs are normalized and deduplicated before publishing
- The service integrates with existing `RelaysService` for performance tracking

## See Also

- `src/app/services/publish.service.ts` - Main service implementation
- `src/app/services/nostr.service.ts` - Integration with existing patterns
- `src/app/services/relays/` - Relay management services
