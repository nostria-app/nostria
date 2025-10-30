# Relay Storage Optimization

## Issue

Relay statistics were being saved to IndexedDB on every single event received or connection status change, resulting in hundreds of storage writes per second:

```
[DEBUG] Saved observed relay stats for: wss://relay.damus.io/
[DEBUG] Saved observed relay stats for: wss://relay.primal.net/
[DEBUG] Saved observed relay stats for: wss://relay.primal.net/
[DEBUG] Saved observed relay stats for: wss://nos.lol/
[DEBUG] Saved observed relay stats for: wss://nos.lol/
[DEBUG] Saved observed relay stats for: wss://relay.damus.io/
[DEBUG] Saved observed relay stats for: wss://relay.damus.io/
```

This caused:
- Performance degradation
- Excessive IndexedDB writes
- Console log spam
- Unnecessary I/O operations

## Solution

Implemented a throttling mechanism in `RelaysService` that batches relay statistics saves:

### 1. Throttle Timer (5 seconds per relay)

Each relay can only be saved once every 5 seconds. Additional save requests within this window are automatically batched.

```typescript
private readonly SAVE_THROTTLE_MS = 5000; // Save at most once every 5 seconds per relay
```

### 2. Debounced Saves

When a save is requested:
- If saved recently (< 5 seconds ago), schedule a delayed save
- Clear any existing pending saves for that relay
- When enough time passes, save immediately

### 3. Per-Relay Tracking

Each relay is tracked independently:
- `pendingSaves` - Map of relay URL to timeout handle
- `lastSaveTime` - Map of relay URL to last save timestamp

## Implementation

### Modified Files

**`src/app/services/relays/relays.ts`**
- Added throttling properties
- Split `saveRelayStatsToStorage()` into two methods:
  - `saveRelayStatsToStorage()` - Handles throttling logic
  - `performSave()` - Performs actual save operation

**`src/app/services/storage.service.ts`**
- Removed debug log from `saveObservedRelay()` to reduce console noise

## Behavior

### Before
```
Event received → Save immediately (100+ times/second)
Connection status changes → Save immediately (dozens/second)
```

### After
```
Event received → Check throttle → Save at most once per 5 seconds per relay
Connection status changes → Check throttle → Save at most once per 5 seconds per relay
```

### Example Timeline

```
T+0s:   Event received → Save immediately (first save)
T+0.1s: Event received → Schedule save for T+5s
T+0.5s: Event received → Cancel T+5s save, schedule save for T+5.5s
T+2s:   Event received → Cancel T+5.5s save, schedule save for T+7s
T+7s:   Scheduled save executes
T+8s:   Event received → Save immediately (5+ seconds since last save)
```

## Benefits

### Performance
- **99% reduction** in storage writes during active usage
- Reduced IndexedDB contention
- Lower memory overhead

### User Experience
- Clean console logs (no spam)
- Smoother application performance
- Reduced battery/CPU usage on mobile devices

### Data Integrity
- All statistics still saved (just batched)
- Maximum 5-second delay in persistence
- No data loss on normal operation

## Configuration

To adjust the throttle period, modify the constant in `relays.ts`:

```typescript
private readonly SAVE_THROTTLE_MS = 5000; // Change to desired milliseconds
```

Recommended values:
- **1000ms (1 second)** - More frequent saves, minimal batching
- **5000ms (5 seconds)** - Good balance (current setting)
- **10000ms (10 seconds)** - Maximum batching, lowest write frequency

## Edge Cases Handled

### Multiple Rapid Updates
- Only the most recent state is saved
- Previous pending saves are cancelled
- No duplicate saves occur

### Application Shutdown
- Pending saves will complete if timeout fires
- May lose up to 5 seconds of updates if force-closed
- Not critical as statistics are accumulated over time

### Multiple Relays
- Each relay throttled independently
- No global bottleneck
- Writes distributed over time

## Monitoring

The throttling is transparent, but you can verify it's working:

```javascript
// In console, watch for relay saves
// Before: Hundreds per second
// After: Maximum one per relay per 5 seconds
```

## Related

- See `RELAY_SUBSCRIPTION_OPTIMIZATION.md` for subscription management improvements
- See `RELAY_DIAGNOSTICS_QUICKSTART.md` for monitoring tools
