# Relay Diagnostics Quick Start Guide

## Problem

You're seeing "ERROR: too many concurrent REQs" messages when loading the feed or performing operations that query multiple relays.

## Solution

We've implemented a comprehensive relay subscription management and diagnostic system.

## Quick Start

### 1. View Current Metrics

Open your browser's developer console (F12) and type:

```javascript
nostriaDebug.showRelayMetrics()
```

This will display:
- Total active subscriptions
- Pending requests
- Connected relays
- Subscriptions by source (which services are creating them)
- Detailed connection information per relay
- Individual subscription details

### 2. Check for Issues

Look for these indicators:
- **Total Subscriptions** approaching 50 (the global limit)
- **Active Subscriptions** per relay approaching 10 (the per-relay limit)
- Multiple subscriptions with identical filters (duplicates)
- **Pool Instances** count higher than 4-5 (indicates pool leakage)

### 3. Clean Up Stale Subscriptions

If you notice subscriptions that have been active for a long time:

```javascript
nostriaDebug.cleanupStale()  // Cleans subscriptions older than 5 minutes
```

Or specify a custom age:

```javascript
nostriaDebug.cleanupStale(60000)  // Clean older than 1 minute
```

### 4. Monitor in Real-Time

The metrics update automatically as subscriptions are created and destroyed. Keep the console open and watch the output as you navigate the app.

## Understanding the Output

### Example Output

```
=== Relay Subscription Metrics ===
Total Subscriptions: 12          ← Total active subscriptions globally
Total Pending Requests: 3        ← One-time queries in progress
Total Connected Relays: 8        ← Relays currently connected
Pool Instances: 4                ← Number of SimplePool instances

=== Subscriptions by Source ===
  AccountRelayService: 5         ← Subscriptions from user's relays
  SharedRelayService: 4          ← Shared relay queries
  DiscoveryRelayService: 3       ← Discovery relay queries

=== Connection Details ===
  wss://relay.example.com:
    Status: Connected            ← WebSocket connection status
    Active Subscriptions: 4      ← Subscriptions on this relay
    Pending Requests: 1          ← One-time queries on this relay
    Pool Instance: AccountRelayService_1234_abc
    Last Activity: 2025-10-30T10:30:45.123Z
```

### What to Look For

**Good Signs:**
- Total subscriptions well below 50
- Even distribution across relays
- Pool instances count: 4-5 (one per service + shared pool)
- All relays showing "Connected"

**Warning Signs:**
- Total subscriptions near 50
- Single relay with 9-10 active subscriptions
- Pool instances > 5 (possible pool leakage)
- Many relays showing "Disconnected"

## Advanced Usage

### Get Metrics Programmatically

```javascript
const metrics = nostriaDebug.getMetrics()
console.log('Total subs:', metrics.totalSubscriptions)
console.log('Pool count:', metrics.poolInstances.size)
```

### Get Relay Statistics

```javascript
const stats = nostriaDebug.getRelayStats()
for (const [url, stat] of stats.entries()) {
  console.log(url, 'Events:', stat.eventsReceived)
}
```

### Reset Tracking (Use with Caution!)

Only use this if you need to clear all tracking data:

```javascript
nostriaDebug.resetTracking()
```

**Warning:** This does not close active subscriptions, it only clears the tracking data. Only use this for debugging.

## Visual Diagnostics Component

For a more user-friendly view, the `RelayDiagnosticsComponent` can be added to the app:

```typescript
import { RelayDiagnosticsComponent } from './components/relay-diagnostics/relay-diagnostics.component';

// Add to your route or component template
<app-relay-diagnostics></app-relay-diagnostics>
```

This provides:
- Real-time metrics dashboard
- Connection status table
- Subscription details
- Cleanup controls

## Automatic Protections

The system automatically:

1. **Limits subscriptions** to 50 globally and 10 per relay
2. **Prevents duplicates** by detecting identical filter + relay combinations
3. **Logs warnings** when limits are approached
4. **Tracks pool instances** to detect leakage
5. **Updates connection status** as relays connect/disconnect

## Troubleshooting

### Still Getting "Too Many REQs"?

1. Run metrics: `nostriaDebug.showRelayMetrics()`
2. Check if any relay is at the limit (10 subscriptions)
3. Look for duplicate subscriptions
4. Clean up stale: `nostriaDebug.cleanupStale()`
5. Check pool instance count - should be 4-5

### Subscriptions Not Being Cleaned Up?

1. Check if components are properly unmounting
2. Look for subscriptions without a close handler
3. Review the "Active Subscriptions Detail" section for old subscriptions
4. Manually clean up: `nostriaDebug.cleanupStale()`

### High Memory Usage?

1. Check total subscription count
2. Look for subscriptions that are very old (age column)
3. Check pool instance count (memory leak if > 5)
4. Run cleanup: `nostriaDebug.cleanupStale()`

## Help

For detailed information, see `docs/RELAY_SUBSCRIPTION_OPTIMIZATION.md`

Or in the console:
```javascript
nostriaDebug.help()
```
