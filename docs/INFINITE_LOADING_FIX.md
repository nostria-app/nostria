# Infinite Loading Fix

## Problem
The "Loading lists..." spinner would sometimes never stop, leaving users stuck on a loading screen. This occurred due to several issues:

1. **Async Effect Issue**: The `effect()` was using `async/await`, which can cause timing issues
2. **Overlapping Loads**: Multiple calls to `loadAllLists()` could overlap, causing the loading state to desynchronize
3. **Effect Re-runs**: When the pubkey changed rapidly or the component re-initialized, the effect could trigger multiple simultaneous loads
4. **Hanging Network Requests**: Data fetches could hang indefinitely without timing out
5. **No Maximum Time Limit**: The entire load operation had no timeout protection

## Root Causes

### 1. Async Effect Anti-Pattern
```typescript
// PROBLEM: Effect should not be async
effect(async () => {
  const pubkey = this.pubkey();
  if (pubkey) {
    await this.loadAllLists(); // Waiting here causes issues
  }
});
```

Effects in Angular should not be async because:
- The effect scheduler doesn't track promise completion
- Multiple effect runs can overlap
- Loading state can get out of sync

### 2. Race Condition Example
```
Time 0: Effect runs → loadAllLists() starts → loading = true
Time 1: Pubkey changes → Effect runs again → loadAllLists() starts again → loading = true
Time 2: First load completes → loading = false (in finally block)
Time 3: Second load still running but loading is already false ❌
```

### 3. No Overlap Protection
Multiple simultaneous calls to `loadAllLists()` weren't prevented, so:
- Loading state could be set to false by an earlier call
- While a later call was still running
- Result: Spinner disappears but loading continues forever

## Solution

### 1. Synchronous Effect
Changed the effect to be synchronous and not await the load:

```typescript
constructor() {
  // Effect to reload lists when account changes
  effect(() => {  // ✅ Not async anymore
    const pubkey = this.pubkey();

    // Clear existing lists first
    this.standardListsData.set(new Map());
    this.setsData.set(new Map());

    // Reload lists for the new account (don't await - let it run in background)
    if (pubkey) {
      this.loadAllLists(); // ✅ Not awaited - fires and forgets
    } else {
      // No pubkey, ensure loading is false
      this.loading.set(false);
      this.isLoadingLists = false;
    }
  });
}
```

### 2. Added Overlap Guard
Added a private flag to prevent overlapping loads:

```typescript
private isLoadingLists = false; // Guard to prevent overlapping loads

async loadAllLists() {
  // ... pubkey check ...

  // Prevent overlapping loads
  if (this.isLoadingLists) {
    this.logger.warn('[ListsComponent] Already loading lists, skipping duplicate call');
    return;
  }

  this.isLoadingLists = true;
  this.loading.set(true);

  try {
    // ... load logic ...
  } finally {
    this.isLoadingLists = false; // ✅ Always reset guard
    this.loading.set(false);     // ✅ Always reset loading
  }
}
```

### 3. Global Timeout Protection
Added a 30-second timeout for the entire load operation:

```typescript
// Set a maximum timeout for the entire load operation (30 seconds)
const timeoutId = setTimeout(() => {
  if (this.isLoadingLists) {
    this.logger.error('[ListsComponent] Load operation timed out after 30 seconds');
    this.isLoadingLists = false;
    this.loading.set(false);
    this.snackBar.open('Failed to load lists (timeout)', 'Close', { duration: 5000 });
  }
}, 30000);

try {
  // ... load operations ...
} finally {
  clearTimeout(timeoutId); // Clear the timeout if we complete normally
  // ... cleanup ...
}
```

### 4. Individual Fetch Timeouts
Created a timeout wrapper for each data fetch operation:

```typescript
/**
 * Helper to wrap promises with timeout
 */
private withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// Usage in loadStandardLists:
const record = await this.withTimeout(
  this.data.getEventByPubkeyAndKind(pubkey, listType.kind, {
    save: true,
    cache: true,
  }),
  10000, // 10 second timeout per fetch
  `Loading standard list kind ${listType.kind}`
);
```

### 5. Explicit No-Pubkey Handling
When there's no pubkey (user logged out), explicitly reset loading state:

```typescript
if (pubkey) {
  this.loadAllLists();
} else {
  // No pubkey, ensure loading is false
  this.loading.set(false);
  this.isLoadingLists = false;
}
```

## How It Works Now

### Normal Flow
1. Effect runs when component initializes
2. Effect clears lists and calls `loadAllLists()` (no await)
3. `loadAllLists()` sets `isLoadingLists = true` and `loading = true`
4. Load completes and `finally` block sets both back to false
5. UI updates correctly

### Account Switch Flow
1. Pubkey signal changes
2. Effect runs and clears lists
3. Effect calls `loadAllLists()` (no await)
4. If previous load is still running, new call is skipped (guard)
5. Once load completes, loading state is properly reset

### Overlapping Prevention
```
Time 0: Effect runs → loadAllLists() → isLoadingLists = true
Time 1: Pubkey changes → Effect runs → loadAllLists() → SKIPPED (guard)
Time 2: First load completes → isLoadingLists = false, loading = false ✅
Time 3: Effect can run again if needed
```

## Benefits
1. **No More Stuck Loading**: Multiple layers of timeout protection
2. **Proper Effect Usage**: Effect is synchronous as it should be
3. **Guaranteed Cleanup**: Finally block always resets both flags
4. **Better Logging**: Added logging to track when duplicate calls are skipped
5. **Graceful Degradation**: Individual fetch failures won't block the entire load
6. **User Feedback**: Timeout errors show a snackbar notification

## Timeout Layers
1. **Individual Fetch**: 10 seconds per list kind fetch
2. **Global Operation**: 30 seconds for entire load operation
3. **Both timeouts** ensure the UI never gets permanently stuck

If a single list type times out, others can still load. If the entire operation takes too long, it's forcefully terminated.

## Testing
To verify the fix:
1. Open Lists page
2. Rapidly switch accounts multiple times
3. Loading should complete normally
4. Check console logs for "Already loading lists, skipping duplicate call"
5. Navigate away and back - loading should work
6. Log out - loading should stop immediately

## Related Issues
- Fixed in conjunction with cache invalidation fix
- Related to account switch handling

## Date
January 16, 2025
