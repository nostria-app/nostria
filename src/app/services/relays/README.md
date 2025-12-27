# Relay Services Architecture

## Overview

This folder contains all services related to Nostr relay connections, subscriptions, and management.

## Service Hierarchy

```
RelayServiceBase (relay.ts)
├── AccountRelayService (account-relay.ts)
├── SharedRelayService (shared-relay.ts)
└── DiscoveryRelayService (discovery-relay.ts)

RelayPoolService (relay-pool.ts) - Independent shared pool

SubscriptionManagerService (subscription-manager.ts) - Global coordination

RelaysService (relays.ts) - Relay statistics and configuration
```

## Core Services

### RelayServiceBase (`relay.ts`)
Abstract base class for relay services. Provides:
- WebSocket connection pooling via `SimplePool`
- Subscription management with lifecycle tracking
- One-time query methods (`get`, `getMany`)
- Publishing capabilities
- Concurrency control
- Integration with `SubscriptionManagerService`

**Key Methods:**
- `get(filter)` - Fetch a single event
- `getMany(filter)` - Fetch multiple events
- `subscribe(filter, onEvent, onEose)` - Create a subscription
- `publish(event)` - Publish an event

### AccountRelayService (`account-relay.ts`)
Manages connections to the authenticated user's personal relays.

**Initialization:**
```typescript
await accountRelay.setAccount(pubkey)
// Loads relay list from storage or discovers via bootstrap relays
```

**Use Case:** Personal feed, mentions, DMs, user-specific queries

### SharedRelayService (`shared-relay.ts`)
Provides access to other users' relay lists without managing persistent connections.

**Features:**
- Request deduplication
- Higher concurrency limits (50 concurrent requests)
- Automatic relay discovery per user
- Caching layer

**Use Case:** Fetching profiles, posts from other users, general discovery

### DiscoveryRelayService (`discovery-relay.ts`)
Connects to bootstrap/discovery relays to find user relay lists.

**Default Relays:** `wss://discovery.eu.nostria.app/`

**Use Case:** Finding where a user publishes (relay list discovery)

### RelayPoolService (`relay-pool.ts`)
Shared connection pool for general-purpose relay operations.

**Features:**
- Single shared `SimplePool` instance
- Generic query and subscription methods
- Relay statistics tracking

**Use Case:** Shared utility queries, cross-service operations

### SubscriptionManagerService (`subscription-manager.ts`)
Global coordinator for all relay subscriptions and requests.

**Features:**
- Tracks all active subscriptions across services
- Enforces global and per-relay limits
- Detects duplicate subscriptions
- Provides detailed metrics
- Connection status monitoring

**Limits:**
- Maximum 50 total subscriptions
- Maximum 10 subscriptions per relay

### RelaysService (`relays.ts`)
Manages relay metadata and statistics.

**Features:**
- Relay connection status tracking
- Event count statistics
- Connection retry tracking
- Optimal relay selection
- Relay information (NIP-11)

## Usage Patterns

### Querying User's Own Relays
```typescript
const accountRelay = inject(AccountRelayService);

// One-time query
const event = await accountRelay.get({ kinds: [0], authors: [pubkey] });

// Subscription
const sub = accountRelay.subscribe(
  { kinds: [1], authors: [pubkey] },
  (event) => console.log('Received:', event),
  () => console.log('EOSE')
);

// Don't forget to close!
sub.close();
```

### Querying Another User's Data
```typescript
const sharedRelay = inject(SharedRelayService);

// Automatically discovers and uses target user's relays
const profile = await sharedRelay.get(
  targetPubkey,
  { kinds: [0], authors: [targetPubkey] }
);
```

### Discovering Relay Lists
```typescript
const discoveryRelay = inject(DiscoveryRelayService);

// Get relay URLs for a user (prioritizes WRITE relays per NIP-65)
const relayUrls = await discoveryRelay.getUserRelayUrls(pubkey);
```

## NIP-65 Relay List Prioritization

When fetching events FROM a user, the system prioritizes WRITE relays as per NIP-65:

- **No marker**: Relay is both READ and WRITE (prioritized)
- **"write" marker**: Write-only relay (highest priority for fetching)
- **"read" marker**: Read-only relay (for receiving mentions, lowest priority for fetching)

The `utilities.getOptimalRelayUrlsForFetching()` method returns relays in this order:
1. Write-only relays
2. Read-write relays (no marker)
3. Read-only relays (fallback)

This ensures we connect to relays where the user actually publishes their events.

### Publishing Events
```typescript
const accountRelay = inject(AccountRelayService);

// Publishes to user's configured relays
await accountRelay.publish(signedEvent);
```

## Subscription Lifecycle

1. **Creation**
   - Service calls `subscribe(filter, onEvent, onEose)`
   - `SubscriptionManagerService` validates against limits
   - `SimplePool` opens WebSocket subscription
   - Subscription ID registered

2. **Active**
   - Events received via `onEvent` callback
   - Connection status tracked
   - Event counts incremented
   - Activity timestamp updated

3. **Cleanup**
   - Component/service calls `subscription.close()`
   - WebSocket subscription closed
   - Subscription unregistered from manager
   - Metrics updated

## Monitoring & Debugging

### Console Utilities
```javascript
// Show metrics
nostriaDebug.showRelayMetrics()

// Clean up stale subscriptions
nostriaDebug.cleanupStale()

// Get metrics programmatically
const metrics = nostriaDebug.getMetrics()
```

### Key Metrics to Watch
- **Total Subscriptions** - Should stay well below 50
- **Subscriptions per Relay** - Should stay below 10
- **Pool Instances** - Should be 4-5 (one per service + shared)
- **Pending Requests** - Should be low and transient

### Logging
All services log with their class name prefix:
```
[AccountRelayService] Creating subscription...
[SharedRelayService] Executing query...
[DiscoveryRelayService] Getting relay URLs...
```

Use browser console filters to focus on specific services.

## Best Practices

### 1. Always Close Subscriptions
```typescript
// In component
ngOnDestroy() {
  this.subscription?.close();
}

// Or use effect with cleanup
effect((onCleanup) => {
  const sub = accountRelay.subscribe(filter, onEvent);
  onCleanup(() => sub.close());
});
```

### 2. Use Appropriate Service
- **AccountRelay** - User's own data
- **SharedRelay** - Other users' data
- **DiscoveryRelay** - Finding relay lists
- **RelayPool** - Generic/shared operations

### 3. Handle Errors Gracefully
```typescript
const event = await accountRelay.get(filter);
if (!event) {
  // Handle not found
}
```

### 4. Avoid Duplicate Subscriptions
The `SubscriptionManager` will detect and warn about duplicates, but it's better to avoid creating them:
- Reuse existing subscriptions when possible
- Check if a subscription already exists before creating
- Close subscriptions when navigating away

### 5. Optimize Filters
```typescript
// Good - specific
{ kinds: [1], authors: [pubkey], limit: 20 }

// Bad - too broad
{ kinds: [1] } // No authors filter!
```

## Configuration

### Discovery Relays
Set custom discovery relays:
```typescript
discoveryRelay.setDiscoveryRelays([
  'wss://relay1.example.com',
  'wss://relay2.example.com'
]);
```

### Subscription Limits
Edit `subscription-manager.ts`:
```typescript
readonly MAX_CONCURRENT_SUBS_PER_RELAY = 10;
readonly MAX_TOTAL_SUBSCRIPTIONS = 50;
```

### Concurrency Limits
Edit `relay.ts` (per-service):
```typescript
protected readonly maxConcurrentRequests = 2;
```

## Common Issues

### "Too many concurrent REQs"
- Check metrics: `nostriaDebug.showRelayMetrics()`
- Look for subscription leaks
- Verify subscriptions are being closed
- Run cleanup: `nostriaDebug.cleanupStale()`

### Subscriptions Not Receiving Events
- Check relay connection status in metrics
- Verify relay URLs are correct
- Check filter specificity
- Look for expired events (NIP-40)

### Multiple Pool Instances
- Should be 4-5 normally
- Check for services creating new pools unnecessarily
- Verify `destroy()` is called on cleanup

## Related Documentation

- **Full Implementation Details**: `docs/RELAY_SUBSCRIPTION_OPTIMIZATION.md`
- **Quick Start Guide**: `docs/RELAY_DIAGNOSTICS_QUICKSTART.md`
- **Implementation Summary**: `docs/RELAY_OPTIMIZATION_SUMMARY.md`

## Architecture Decisions

### Why Multiple Services?
- **Separation of Concerns**: Different use cases have different requirements
- **Optimization**: Account relays can be persistent, shared relays can be cached
- **Flexibility**: Easy to add new relay types or behaviors

### Why SubscriptionManager?
- **Global Coordination**: Prevents any single service from creating too many subscriptions
- **Visibility**: Centralized metrics and monitoring
- **Limits Enforcement**: Protects against relay overload

### Why Not One Pool?
- Different services have different relay sets
- Account relays are user-specific and persistent
- Discovery relays are global and temporary
- Separation allows for different configurations and behaviors

## Future Enhancements

Potential improvements:
- Automatic relay performance tracking
- Smart relay selection based on latency
- Subscription batching
- Priority queuing
- Circuit breaker patterns
- Automatic failover
