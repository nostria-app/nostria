# Account Switch Loading Fix

## Problem

When switching accounts, the application would often hang on the "Loading completed!" message, leaving users stuck on the loading screen. The console showed repeated "WebSocket is already in CLOSING or CLOSED state" errors.

## Root Causes

1. **Missing Error Handling**: The `load()` method in `nostr.service.ts` didn't have a try-catch block, so if any of the async operations failed, the `isLoading` flag would never be set to false, leaving the UI stuck.

2. **Unclosed Subscriptions**: When switching accounts, the old account subscription (`accountSubscription`) was not being properly cleaned up, causing it to attempt operations on closed WebSocket connections.

3. **Relay Connection Cleanup**: The `accountRelay.setAccount()` was being called without destroying old connections first, leading to connection conflicts and WebSocket errors.

## Changes Made

### 1. Added Error Handling to `nostr.service.ts`

**File**: `src/app/services/nostr.service.ts`

- Wrapped the entire `load()` method in a try-catch block
- Ensured `isLoading.set(false)` is always called, even on error
- Added early return if account is null
- Log errors properly and set error messages in the UI

```typescript
async load() {
  this.appState.isLoading.set(true);
  const account = this.accountState.account();

  if (!account) {
    this.appState.isLoading.set(false);
    return;
  }

  try {
    // ... loading logic ...
  } catch (error) {
    this.logger.error('Error during account data loading', error);
    this.appState.isLoading.set(false);
    this.appState.loadingMessage.set('Error loading account data');
    // Still mark as initialized to prevent the app from being stuck
    if (!this.initialized()) {
      this.initialized.set(true);
    }
    this.accountState.initialized.set(true);
  }
}
```

### 2. Fixed Subscription Cleanup

**File**: `src/app/services/nostr.service.ts`

Updated the `clear()` method to properly close the account subscription:

```typescript
clear() {
  // Clean up the account subscription if it exists
  if (this.accountSubscription) {
    this.logger.debug('Unsubscribing from account metadata subscription');
    try {
      this.accountSubscription.close();
    } catch (error) {
      this.logger.warn('Error closing account subscription', error);
    }
    this.accountSubscription = null;
  }
}
```

### 3. Added Error Handling to Account Change Effect

**File**: `src/app/services/state.service.ts`

Wrapped the effect logic in a try-catch to handle any errors during account switching:

```typescript
constructor() {
  effect(async () => {
    const account = this.accountState.account();
    if (account) {
      try {
        this.clear();
        await this.load();
      } catch (error) {
        console.error('Error during account change:', error);
        this.clear();
      }
    } else {
      this.clear();
    }
  });
}
```

### 4. Properly Destroy Old Relay Connections

**File**: `src/app/services/state.service.ts`

Updated `load()` to pass the `destroy` flag when setting up the new account relay:

```typescript
async load() {
  const pubkey = this.accountState.pubkey();

  await this.discoveryRelay.load();
  // Destroy old connections before setting up new ones
  await this.accountRelay.setAccount(pubkey, true);
  // ... rest of loading logic ...
}
```

## Impact

These changes ensure that:
- The loading screen never gets stuck, even if errors occur during account switching
- Old WebSocket connections are properly closed before new ones are created
- The "WebSocket is already in CLOSING or CLOSED state" errors are eliminated
- Users can reliably switch between accounts without the UI hanging

## Testing

To verify the fix:
1. Add multiple accounts to the application
2. Switch between accounts multiple times
3. Verify that the loading screen completes successfully each time
4. Check the console for absence of WebSocket state errors
5. Test with poor network conditions to ensure error handling works
