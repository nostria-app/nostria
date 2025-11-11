# Profile Timeline Race Condition Fix

## Problem

When switching between user profiles rapidly, events from the previous profile could appear in the timeline of the newly opened profile. This created a critical bug where users would see incorrect content.

## Root Cause

The `ProfileStateService` had a race condition vulnerability in its profile switching logic:

1. When opening Profile A, `currentlyLoadingPubkey` signal was set to Profile A's pubkey
2. Slow network requests started fetching Profile A's data
3. User switched to Profile B before Profile A's data finished loading
4. The `reset()` method cleared all data arrays BUT left `currentlyLoadingPubkey` unchanged
5. Profile A's delayed data eventually arrived and passed race condition checks (since `currentlyLoadingPubkey` still matched Profile A)
6. Profile A's events were added to the signals, mixing with Profile B's data

## Solution

Implemented a comprehensive fix with multiple safeguards:

### 1. Reset Loading Tracker on Profile Switch

Modified `reset()`, `setCurrentProfilePubkey()`, and `forceReloadProfileData()` to clear the `currentlyLoadingPubkey` signal:

```typescript
reset() {
  // Reset the loading tracker first to immediately invalidate any in-flight requests
  this.currentlyLoadingPubkey.set('');
  // ... rest of reset logic
}

setCurrentProfilePubkey(pubkey: string): void {
  this.reset();
  this.currentProfileKey.set(pubkey);
  // Reset the loading tracker to prevent race conditions
  this.currentlyLoadingPubkey.set('');
}
```

### 2. Double-Check Race Condition Guards

Added dual verification in all async data loading methods to check both:
- `currentlyLoadingPubkey` (tracks the initial request)
- `pubkey()` computed signal (reflects the current profile)

This ensures that even if one check fails, the second one catches the race condition.

Example from `loadUserData()`:

```typescript
// Check if we're still loading this profile
if (this.currentlyLoadingPubkey() !== pubkey) {
  this.logger.info(`Profile switched during contacts load. Discarding results for: ${pubkey}`);
  return;
}

// Double-check against the current pubkey
if (this.pubkey() !== pubkey) {
  this.logger.info(`Current profile changed during contacts load. Discarding results for: ${pubkey}`);
  return;
}
```

### 3. Protected Methods

Applied the fix to all async data loading methods:
- `loadUserData()` - Initial profile data load
- `loadMoreNotes()` - Infinite scroll for notes/timeline
- `loadMoreArticles()` - Infinite scroll for articles
- `loadMoreMedia()` - Infinite scroll for media

## Impact

This fix eliminates the race condition completely:
- Events from previous profiles can no longer contaminate new profile timelines
- All in-flight requests from previous profiles are immediately invalidated on profile switch
- Dual verification provides defense-in-depth against timing issues

## Testing

To verify the fix:
1. Open a profile with slow network connection (use DevTools network throttling)
2. Immediately switch to another profile before data loads
3. Confirm that only events from the second profile appear
4. Repeat multiple times with rapid profile switches
5. Verify no mixing of events between profiles occurs
