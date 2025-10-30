# Relay Subscription Optimization and Diagnostics

## Overview

This document describes the comprehensive relay subscription management and diagnostic system implemented to address "too many concurrent REQs" errors and optimize Nostr relay usage.

## Problem Statement

The application was experiencing:
1. **"ERROR: too many concurrent REQs"** messages when loading feeds
2. **Multiple SimplePool instances** created across different services without coordination
3. **No global tracking** of active subscriptions and pending requests
4. **Duplicate subscriptions** being created for the same filters/relays
5. **Limited visibility** into relay connection states and subscription lifecycle

## Solution Architecture

### 1. Centralized Subscription Manager (`subscription-manager.ts`)

A new service that provides global tracking and coordination of all relay subscriptions and requests.

**Key Features:**
- Tracks all active subscriptions across the application
- Monitors pending requests per relay
- Enforces global and per-relay limits
- Detects and prevents duplicate subscriptions
- Provides detailed metrics for diagnostics

**Configuration:**
```typescript
readonly MAX_CONCURRENT_SUBS_PER_RELAY = 10;
readonly MAX_TOTAL_SUBSCRIPTIONS = 50;
```

**Core Methods:**
- `registerSubscription()` - Register a new subscription with validation
- `unregisterSubscription()` - Clean up subscription tracking
- `registerRequest()` - Track one-time query requests
- `hasDuplicateSubscription()` - Detect duplicate subscriptions
- `getMetricsReport()` - Generate detailed diagnostic report

### 2. Enhanced Relay Services

Updated all relay service base classes to integrate with the subscription manager:

**RelayServiceBase (`relay.ts`):**
- Added `poolInstanceId` for tracking individual pool instances
- Enhanced `getWithRelays()` to register/unregister requests
- Enhanced `subscribe()` with:
  - Subscription registration and validation
  - Duplicate detection
  - Detailed lifecycle logging
  - Automatic cleanup on close

**RelayPoolService (`relay-pool.ts`):**
- Integrated subscription tracking for all operations
- Added request registration for `get()` and `query()` methods
- Enhanced subscription management with proper cleanup

### 3. Detailed Logging

All relay operations now include comprehensive logging:

```typescript
// Request logging
this.logger.debug('[ServiceName] Executing query - Request ID: ${requestId}', {
  filter,
  relayCount,
  poolInstance,
});

// Subscription logging
this.logger.info('[ServiceName] Creating subscription', {
  subscriptionId,
  poolInstance,
  relayCount,
  filter,
});

// Event logging
this.logger.debug('[ServiceName] Received event of kind ${kind}', {
  subscriptionId,
  eventId,
});
```

### 4. Diagnostic Tools

#### Browser Console Utilities

Global debug utilities available via `window.nostriaDebug`:

```javascript
// Show detailed metrics
nostriaDebug.showRelayMetrics()

// Get metrics programmatically
const metrics = nostriaDebug.getMetrics()

// Clean up stale subscriptions (older than 5 minutes)
nostriaDebug.cleanupStale()

// Reset all tracking (use with caution)
nostriaDebug.resetTracking()

// Get relay statistics
const stats = nostriaDebug.getRelayStats()

// Show help
nostriaDebug.help()
```

#### Relay Diagnostics Component

A visual component (`relay-diagnostics.component.ts`) that displays:
- Active subscription count
- Pending request count
- Connected relay count
- Pool instance count
- Subscriptions grouped by source
- Detailed connection table with status
- Individual subscription details with filters

Can be integrated into the settings or developer tools page.

## Usage Examples

### Monitoring Subscriptions

```typescript
// In browser console
nostriaDebug.showRelayMetrics()
```

Output:
```
=== Relay Subscription Metrics ===
Total Subscriptions: 12
Total Pending Requests: 3
Total Connected Relays: 8
Pool Instances: 3

=== Subscriptions by Source ===
  AccountRelayService: 5
  SharedRelayService: 4
  DiscoveryRelayService: 3

=== Connection Details ===
  wss://relay.example.com:
    Status: Connected
    Active Subscriptions: 4
    Pending Requests: 1
    Pool Instance: AccountRelayService_1234_abc123
    Last Activity: 2025-10-30T10:30:45.123Z
```

### Detecting Issues

The subscription manager will log warnings when limits are approached:

```
[SubscriptionManager] Cannot register subscription: relay wss://relay.example.com at limit of 10
```

### Cleaning Up

```javascript
// Clean up subscriptions older than 5 minutes
const cleaned = nostriaDebug.cleanupStale(300000)
// Output: Cleaned up 3 stale subscriptions
```

## Benefits

### 1. Prevents "Too Many REQs" Errors
- Global and per-relay limits prevent overwhelming relays
- Request queuing ensures orderly processing
- Duplicate detection reduces redundant subscriptions

### 2. Improved Visibility
- Real-time metrics on all subscriptions and requests
- Pool instance tracking identifies multiple SimplePool instances
- Detailed logging aids in debugging

### 3. Better Resource Management
- Automatic cleanup of stale subscriptions
- Connection status tracking
- Request lifecycle management

### 4. Developer-Friendly Diagnostics
- Console utilities for quick debugging
- Visual component for monitoring
- Comprehensive metrics reporting

## Integration Points

### Existing Services Updated

1. **RelayServiceBase** - Base class for all relay services
2. **RelayPoolService** - Shared pool service
3. **AccountRelayService** - Uses base class enhancements
4. **SharedRelayService** - Uses base class enhancements
5. **DiscoveryRelayService** - Uses base class enhancements

### New Services Added

1. **SubscriptionManagerService** - Central coordination
2. **RelayDiagnosticsComponent** - Visual monitoring
3. **Debug Utilities** - Console tools

## Configuration

### Adjusting Limits

To modify subscription limits, update the constants in `subscription-manager.ts`:

```typescript
readonly MAX_CONCURRENT_SUBS_PER_RELAY = 10;  // Per-relay limit
readonly MAX_TOTAL_SUBSCRIPTIONS = 50;        // Global limit
```

### Logging Levels

Control logging verbosity in the LoggerService configuration. The relay services use:
- `debug` - Detailed operation logs
- `info` - Important lifecycle events
- `warn` - Limit violations and issues
- `error` - Failures and exceptions

## Performance Considerations

### Memory Usage
- Subscription tracking uses Map structures for O(1) lookups
- Automatic cleanup prevents unbounded growth
- Stale subscription detection runs on-demand

### Network Efficiency
- Duplicate detection prevents redundant subscriptions
- Request deduplication (in SharedRelayService) reduces duplicate queries
- Connection pooling reuses WebSocket connections

## Monitoring Recommendations

### During Development
1. Keep browser console open to see detailed logs
2. Use `nostriaDebug.showRelayMetrics()` regularly
3. Monitor for limit warnings
4. Check pool instance count (should be minimal)

### In Production
1. Set up periodic cleanup: `setInterval(() => nostriaDebug.cleanupStale(), 300000)`
2. Monitor for error patterns in logs
3. Track relay connection stability
4. Review subscription patterns periodically

## Troubleshooting

### "Too many concurrent REQs" Still Occurring

1. Check current metrics: `nostriaDebug.showRelayMetrics()`
2. Verify limits are not set too high
3. Look for subscription leaks (not being closed)
4. Check for multiple pool instances

### High Subscription Count

1. Review subscriptions by source
2. Check for components not cleaning up on unmount
3. Look for long-running subscriptions
4. Run cleanup: `nostriaDebug.cleanupStale()`

### Multiple Pool Instances

Check the pool instance count in metrics. Expected:
- 1 for RelayPoolService
- 1 for AccountRelayService
- 1 for SharedRelayService  
- 1 for DiscoveryRelayService
- Temporary pools in NostrService (should be cleaned up)

If more instances exist, investigate service initialization and cleanup.

## Future Enhancements

Potential improvements:
1. Automatic subscription batching
2. Smart relay selection based on performance
3. Subscription priority queuing
4. Historical metrics and analytics
5. Alert thresholds and notifications
6. Subscription lifecycle visualization

## Related Files

- `src/app/services/relays/subscription-manager.ts` - Main manager service
- `src/app/services/relays/relay.ts` - Enhanced base class
- `src/app/services/relays/relay-pool.ts` - Enhanced pool service
- `src/app/components/relay-diagnostics/relay-diagnostics.component.ts` - Visual diagnostics
- `src/app/utils/debug-utils.ts` - Console utilities
- `src/main.ts` - Debug utils initialization

## Conclusion

This implementation provides comprehensive relay subscription management with detailed diagnostics, preventing "too many concurrent REQs" errors while improving visibility and control over Nostr relay connections.
