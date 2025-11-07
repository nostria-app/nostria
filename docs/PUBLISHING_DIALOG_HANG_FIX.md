# Publishing Dialog Slowness Fix

## Problem
The note editor dialog would show "Publishing..." for several minutes (3+ minutes) before completing, even though the user expected it to finish quickly. The logs showed:
- 6 relay publishes initiated at 10:32:17
- All 6 relays succeeded
- But completion didn't happen until 10:35:36 (over 3 minutes later!)

## Root Cause

The main issue was **missing timeout enforcement at the relay level**:

1. **No timeout in RelayPoolService**: The `RelayPoolService.publish()` method had no timeout, so it would wait indefinitely for each relay to respond
2. **Ineffective timeout in PublishService**: The 10-second timeout in `PublishService.publish()` wasn't being enforced properly due to Promise.race issues
3. **Slow relays blocking progress**: Even one slow relay could block the entire publish operation for minutes

### Why It Took 3+ Minutes

The `nostr-tools` SimplePool's `publish()` method creates promises for each relay that only resolve when:
- The relay sends an "OK" message confirming receipt
- The relay connection closes/times out (which has no default timeout)

If a relay is slow or unresponsive, the promise can hang for minutes waiting for a response.

## Solution

### 1. Added Per-Relay Timeout in RelayPoolService
Modified `RelayPoolService.publish()` to accept a `timeoutMs` parameter (default 10 seconds) and enforce it using `Promise.race`:

```typescript
async publish(relayUrls: string[], event: Event, timeoutMs = 10000): Promise<void>
```

This ensures that individual relay publishes can't take longer than the specified timeout.

### 2. Configured Appropriate Timeouts
In `PublishService.publish()`:
- Overall timeout: 10 seconds (configurable via options)
- Per-relay timeout: 5 seconds minimum, or half of overall timeout
- This allows relays to fail fast without blocking the entire operation

### 3. Fixed Promise.race Logic
Changed the timeout promise to resolve with a sentinel value instead of rejecting:

```typescript
const timeoutPromise = new Promise<'timeout'>((resolve) =>
  setTimeout(() => resolve('timeout'), timeout)
);
```

This allows proper detection of timeout vs normal completion.

### 4. State Reset Safeguards
- Reset `isPublishing` on early return (no relays available)
- Added defensive logging in finally block
- Ensured finally block always runs

## Changes Made

### relay-pool.ts

1. **Added timeout parameter**:
   ```typescript
   async publish(relayUrls: string[], event: Event, timeoutMs = 10000)
   ```

2. **Implemented timeout enforcement**:
   - Uses `Promise.race` to enforce timeout
   - Collects results even after timeout
   - Logs timeout events for debugging

### publish.service.ts

1. **Per-relay timeout configuration**:
   - Calculates per-relay timeout (half of total, minimum 5 seconds)
   - Passes timeout to `pool.publish()`

2. **Improved Promise.race logic**:
   - Fixed timeout promise to resolve instead of reject
   - Better handling of timeout vs completion scenarios

3. **State reset safeguards**:
   - Reset `isPublishing` on early return
   - Enhanced logging in finally block

### note-editor-dialog.component.ts

1. **Added debug logging**:
   - Log publish result details
   - Track finally block execution

## Testing
After these changes:
1. ✅ Publishing completes within 10 seconds (or configured timeout)
2. ✅ Slow relays don't block the entire operation
3. ✅ Dialog closes promptly after successful publish
4. ✅ `isPublishing` state is always reset
5. ✅ Clear logging for debugging

## Performance Impact
- **Before**: 3+ minutes for publishing (waiting for slow relays)
- **After**: ~5-10 seconds maximum (enforced timeout)
- **Improvement**: ~95% faster user experience

## Affected Files
- `src/app/services/relays/relay-pool.ts`
- `src/app/services/publish.service.ts`
- `src/app/components/note-editor-dialog/note-editor-dialog.component.ts`

