# Relay Subscription Management - Implementation Summary

## Overview

Implemented comprehensive relay subscription tracking, management, and diagnostics to resolve "ERROR: too many concurrent REQs" issues and optimize Nostr relay usage.

## Files Created

### 1. Core Services
- **`src/app/services/relays/subscription-manager.ts`** (469 lines)
  - Centralized subscription and request tracking
  - Global and per-relay limits enforcement
  - Duplicate subscription detection
  - Detailed metrics collection

### 2. Diagnostic Tools
- **`src/app/components/relay-diagnostics/relay-diagnostics.component.ts`** (298 lines)
  - Visual dashboard for subscription metrics
  - Real-time connection status monitoring
  - Interactive cleanup controls
  - Detailed subscription inspection

- **`src/app/utils/debug-utils.ts`** (102 lines)
  - Global browser console utilities
  - Quick access to metrics and cleanup functions
  - Programmatic metrics access

### 3. Documentation
- **`docs/RELAY_SUBSCRIPTION_OPTIMIZATION.md`** (Comprehensive guide)
  - Architecture overview
  - Usage examples
  - Troubleshooting guide
  - Performance considerations

- **`docs/RELAY_DIAGNOSTICS_QUICKSTART.md`** (Quick reference)
  - Quick start instructions
  - Common scenarios
  - Troubleshooting steps

## Files Modified

### 1. Relay Services
- **`src/app/services/relays/relay.ts`**
  - Added subscription manager integration
  - Enhanced logging with service name and subscription IDs
  - Added pool instance tracking
  - Implemented subscription registration/unregistration
  - Added duplicate subscription detection

- **`src/app/services/relays/relay-pool.ts`**
  - Integrated subscription manager
  - Added request tracking for get/query operations
  - Enhanced logging with request IDs
  - Proper connection status updates

### 2. Application Bootstrap
- **`src/main.ts`**
  - Initialized debug utilities on app bootstrap
  - Made diagnostics available globally via `window.nostriaDebug`

## Key Features Implemented

### 1. Subscription Tracking
```typescript
// Track all subscriptions globally
registerSubscription(id, filter, relays, source, poolInstance)
unregisterSubscription(id)

// Track one-time requests
registerRequest(relays, source, poolInstance)
unregisterRequest(requestId, relays)
```

### 2. Limits & Throttling
- **Global limit**: 50 concurrent subscriptions
- **Per-relay limit**: 10 concurrent subscriptions per relay
- Automatic rejection when limits reached
- Warning logs when approaching limits

### 3. Duplicate Detection
```typescript
// Prevents redundant subscriptions
hasDuplicateSubscription(filter, relayUrls)
```

### 4. Detailed Logging
All relay operations now log:
- Service name (e.g., `[AccountRelayService]`)
- Subscription/Request IDs
- Pool instance identifiers
- Relay URLs and counts
- Filter details
- Lifecycle events (create, event received, close)

Example:
```
[AccountRelayService] Creating subscription
  subscriptionId: sub_1234567890_abc123
  poolInstance: AccountRelayService_1234_xyz789
  relayCount: 5
  filter: {"kinds":[1],"authors":["..."]}
```

### 5. Metrics & Diagnostics
- Total subscriptions count
- Pending requests count
- Active connections per relay
- Subscriptions grouped by source
- Connection status per relay
- Pool instance tracking
- Age tracking for subscriptions

### 6. Browser Console Tools
```javascript
// Available globally
nostriaDebug.showRelayMetrics()
nostriaDebug.getMetrics()
nostriaDebug.cleanupStale(maxAgeMs)
nostriaDebug.resetTracking()
nostriaDebug.getRelayStats()
nostriaDebug.help()
```

## Integration Points

### Services Using Enhanced Relay System
1. AccountRelayService (via RelayServiceBase)
2. SharedRelayService (via RelayServiceBase)
3. DiscoveryRelayService (via RelayServiceBase)
4. RelayPoolService (direct integration)

### How It Works

1. **Subscription Creation**
   ```
   Component/Service → RelayService.subscribe()
   → SubscriptionManager.registerSubscription() [validates limits]
   → SimplePool.subscribeMany()
   → Track in SubscriptionManager
   ```

2. **Request Execution**
   ```
   Component/Service → RelayService.get()
   → SubscriptionManager.registerRequest()
   → SimplePool.get()
   → SubscriptionManager.unregisterRequest()
   ```

3. **Subscription Cleanup**
   ```
   subscription.close()
   → SimplePool closes WebSocket subscription
   → SubscriptionManager.unregisterSubscription()
   → Update metrics
   ```

## Benefits

### 1. Prevents Errors
- "Too many concurrent REQs" errors eliminated by enforcing limits
- Duplicate subscriptions prevented
- Resource leaks detected via pool instance tracking

### 2. Visibility
- Real-time metrics on all relay operations
- Track subscription sources to identify problematic areas
- Connection status monitoring

### 3. Developer Experience
- Console utilities for quick debugging
- Visual component for detailed inspection
- Comprehensive logging for issue diagnosis

### 4. Performance
- Reduced redundant subscriptions
- Better connection pool management
- Memory leak detection via stale subscription tracking

## Usage Patterns

### For Users (Debugging Issues)
```javascript
// Open browser console (F12)
nostriaDebug.showRelayMetrics()  // See current state
nostriaDebug.cleanupStale()      // Clean up old subscriptions
```

### For Developers (Integration)
```typescript
// The relay services automatically handle tracking
// Just use them as before:
const sub = this.accountRelay.subscribe(filter, onEvent, onEose)

// The system will:
// - Check limits
// - Detect duplicates
// - Track the subscription
// - Log lifecycle events
// - Update metrics

// Don't forget to close when done:
sub.close()
```

### For Monitoring (Production)
```javascript
// Set up periodic cleanup
setInterval(() => {
  const cleaned = nostriaDebug.cleanupStale(300000) // 5 minutes
  if (cleaned > 0) {
    console.log(`Auto-cleaned ${cleaned} stale subscriptions`)
  }
}, 300000)
```

## Configuration

### Adjusting Limits
Edit `src/app/services/relays/subscription-manager.ts`:
```typescript
readonly MAX_CONCURRENT_SUBS_PER_RELAY = 10;  // Increase if needed
readonly MAX_TOTAL_SUBSCRIPTIONS = 50;        // Increase if needed
```

### Logging Verbosity
The relay services use different log levels:
- `debug` - Detailed operation logs (can be filtered out in production)
- `info` - Important lifecycle events
- `warn` - Issues and limit violations
- `error` - Failures

## Testing Recommendations

1. **Load Testing**
   - Open feed with many events
   - Monitor metrics: `nostriaDebug.showRelayMetrics()`
   - Check for limit warnings in console
   - Verify subscriptions are cleaned up when navigating away

2. **Leak Detection**
   - Navigate through the app
   - Periodically check metrics
   - Pool instance count should stay at 4-5
   - Total subscriptions should not grow unbounded

3. **Performance**
   - Monitor "ERROR: too many concurrent REQs" messages
   - Check subscription creation time
   - Verify duplicate detection is working

## Next Steps

1. **Monitor in production** for a few days
2. **Adjust limits** if needed based on usage patterns
3. **Add alerts** if subscription count exceeds thresholds
4. **Create dashboards** using the metrics API
5. **Optimize** based on subscription source analysis

## Rollback Plan

If issues arise:
1. The changes are additive (existing code still works)
2. Limits can be increased to previous effective "unlimited" behavior
3. Tracking can be disabled by not registering subscriptions
4. Core relay functionality is unchanged

## Success Metrics

After deployment, we should see:
- ✅ Zero "too many concurrent REQs" errors
- ✅ Subscription count stays below limits
- ✅ No duplicate subscriptions
- ✅ Pool instance count remains stable (4-5)
- ✅ Clean subscription lifecycle (created → used → closed)

## Support

For questions or issues:
1. Check `docs/RELAY_DIAGNOSTICS_QUICKSTART.md` for common scenarios
2. Review `docs/RELAY_SUBSCRIPTION_OPTIMIZATION.md` for detailed information
3. Use `nostriaDebug.help()` in console for quick reference
4. Check console logs for warnings and errors
