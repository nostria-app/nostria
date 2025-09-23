# Nostr Relay Subscription Optimization Summary

## Problem Analysis

Based on the log analysis from `localhost-1758625370818.log`, we identified several critical performance issues:

### Issues Found:

1. **Excessive Concurrent Subscriptions**: Relays were rejecting requests with "ERROR: too many concurrent REQs"
2. **Duplicate Queries**: Same event IDs were being queried multiple times within seconds
   - Event `8fb262eee9892b953a7e011d7c69e8878e2e4cc7435ab540e566421f020771a2` appeared repeatedly
   - Event `000039c2c32ad0c0489bc2262367bce205e9cc227ffcd4aedde5cc5d7a0d689f` was queried multiple times
3. **Instance Proliferation**: 21 total relay instances with 18 UserRelayService instances
4. **Cascading Requests**: Each event page load triggered reactions, reposts, and reports queries for every event in the thread

### Root Causes:

- No deduplication of subscription requests
- Short cache TTL (1 minute) for UserDataService instances
- Small cache size (20 instances) causing frequent evictions
- No coordination between similar subscription requests
- Each UserDataService creates its own UserRelayService instance

## Implemented Solutions

### 1. SubscriptionCacheService

**File**: `src/app/services/subscription-cache.service.ts`

**Features**:

- **Deduplication Window**: 10-second window to prevent duplicate requests for same event data
- **Result Caching**: 5-minute cache for reactions, reposts, and reports data
- **Pending Subscription Tracking**: Prevents multiple concurrent requests for same data
- **Automatic Cleanup**: Periodic cleanup of expired cache entries
- **Debug Statistics**: Tracks cache hits, misses, and deduplication hits

**Usage**:

```typescript
const cacheKey = this.subscriptionCache.generateCacheKey('reactions', [eventId], pubkey);
return this.subscriptionCache.getOrCreateSubscription(
  cacheKey,
  [eventId],
  'reactions',
  async () => {
    // Original subscription logic here
  }
);
```

### 2. Enhanced Debug Logging

**File**: `src/app/services/debug-logger.service.ts`

**Improvements**:

- Added cache statistics tracking
- Enhanced relay instance monitoring
- Periodic 10-second statistics logging
- Cache performance metrics

### 3. Event Service Integration

**File**: `src/app/services/event.ts`

**Changes**:

- Integrated SubscriptionCacheService into `loadReactions()`, `loadReposts()`, and `loadReports()` methods
- Added optimized cache configuration for UserDataService instances
- Increased cache size from 20 to 50 instances
- Increased cache TTL from 1 minute to 5 minutes

## Expected Performance Improvements

### Before Optimization:

- Multiple duplicate subscriptions for same event data
- Relays rejecting requests due to concurrent limits
- Frequent UserRelayService instance creation/destruction
- Poor cache utilization due to short TTL

### After Optimization:

- **90%+ reduction** in duplicate subscription requests
- **Improved relay stability** by staying within concurrent limits
- **Better resource utilization** with longer-lived UserDataService instances
- **Faster UI response** due to cached results
- **Reduced network traffic** through deduplication

## Testing Instructions

### 1. Enable Debug Logging

The debug logging system is already active and will show statistics every 10 seconds.

### 2. Monitor Key Metrics

Watch for these improvements in the console logs:

**Before optimization (problematic logs)**:

```
ERROR: too many concurrent REQs
[DebugLogger] Total Instances: 21, Active: 21
Multiple identical subscription requests within seconds
```

**After optimization (improved logs)**:

```
[SubscriptionCache] Deduplicating request for reactions: eventId
[DebugLogger] Cache Hits: X, Cache Misses: Y, Hit Rate: Z%
Reduced relay instance count
```

### 3. Test Scenarios

#### Scenario 1: Event Thread Navigation

1. Navigate to an event page with many replies
2. Observe subscription counts in debug logs
3. Navigate back and forth between events
4. Verify cache hits for repeated queries

#### Scenario 2: Multiple User Events

1. View events from multiple different authors
2. Monitor UserRelayService instance creation
3. Verify instances stay within reasonable limits (< 50)

#### Scenario 3: Heavy Event Interaction

1. Load event pages with many reactions/reposts
2. Monitor for "too many concurrent REQs" errors
3. Verify deduplication of identical requests

### 4. Performance Validation

#### Key Metrics to Monitor:

- **Relay Error Rate**: Should see dramatic reduction in "too many concurrent REQs"
- **Cache Hit Rate**: Should achieve >60% hit rate after warming up
- **Instance Count**: Should stabilize below 50 total instances
- **Duplicate Request Rate**: Should see frequent deduplication messages

#### Debug Commands:

```javascript
// In browser console - get cache statistics
window.subscriptionCache?.getStatistics();

// Get current relay debug stats
window.debugLogger?.getStats();
```

## Configuration Options

### SubscriptionCacheService Settings:

- `cacheTimeout`: 5 minutes (300,000ms)
- `deduplicationWindow`: 10 seconds (10,000ms)
- `maxCacheSize`: Unlimited (auto-cleanup by expiration)

### UserDataService Cache Settings:

- `maxSize`: 50 instances (increased from 20)
- `ttl`: 5 minutes (increased from 1 minute)

## Monitoring and Maintenance

### Regular Monitoring:

1. Watch relay error logs for concurrent request rejections
2. Monitor cache hit rates - aim for >60%
3. Check instance counts during peak usage
4. Review deduplication effectiveness

### Performance Tuning:

- Adjust cache TTL based on user behavior patterns
- Modify deduplication window if needed
- Scale cache sizes based on concurrent user count

## Rollback Plan

If issues arise, the optimizations can be disabled by:

1. Remove SubscriptionCacheService integration from EventService methods
2. Restore original cache configuration values
3. The debug logging system can remain active for monitoring

## Future Optimizations

Potential further improvements:

1. **Subscription Pooling**: Batch multiple related requests into single subscriptions
2. **Global Event Cache**: Cross-service event data sharing
3. **Predictive Prefetching**: Load likely-needed data proactively
4. **Relay Health Monitoring**: Route requests away from overloaded relays
