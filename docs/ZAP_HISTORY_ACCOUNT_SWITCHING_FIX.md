# Zap History - Account Switching Fix

## Problem
When the Zap History page is open and the user switches to a different account, the component did not clear the existing zap history or load the new account's zaps. The old account's zaps remained visible even after switching accounts.

## Root Cause
The `ZapHistoryComponent` only loaded zap history once in the `ngOnInit()` lifecycle hook. It had no mechanism to detect when the active account changed, so it never refreshed the data when users switched accounts.

## Solution
Implemented an Angular `effect()` in the component constructor that watches for changes to the active account and automatically reloads the zap history.

### Changes Made

#### 1. Import Updates (`zap-history.component.ts`)
- Removed `OnInit` from Angular core imports (no longer needed)
- Added `effect` from Angular core imports
- Removed `OnInit` from the class implementation

#### 2. Lifecycle Changes
- **Removed**: `ngOnInit()` method and `OnInit` interface implementation
- **Added**: Constructor with an `effect()` that watches `accountState.account()`

#### 3. Effect Implementation
```typescript
constructor() {
  // Effect to reload zap history when account changes
  effect(() => {
    const account = this.accountState.account();
    if (account) {
      // Clear existing history and load for new account
      this.allZaps.set([]);
      this.prefetchedProfiles.set({});
      this.loadZapHistory();
    }
  });
}
```

### How It Works

1. **Effect Triggers**: The effect runs whenever `accountState.account()` signal changes
2. **Clear State**: When a new account is detected:
   - Clears `allZaps` signal (removes old zap entries)
   - Clears `prefetchedProfiles` signal (removes cached profile data)
3. **Reload Data**: Calls `loadZapHistory()` to fetch zaps for the new account
4. **Initial Load**: Effect also runs on component initialization, loading zaps for the initial account

### Benefits

- **Automatic Updates**: No manual refresh needed when switching accounts
- **Clean State**: Old account data is properly cleared before loading new data
- **Reactive Pattern**: Uses Angular signals and effects for declarative data flow
- **No Memory Leaks**: Effect is automatically cleaned up when component is destroyed

### User Experience

1. User opens Zap History page with Account A
2. Zap History shows Account A's sent/received zaps
3. User switches to Account B via account selector
4. Zap History automatically:
   - Clears Account A's zaps from display
   - Shows loading spinner
   - Fetches and displays Account B's zaps
5. All statistics (total sent, total received, net) update automatically

## Technical Notes

- Uses Angular's `effect()` for reactive updates
- Effect tracks the `account()` signal from `AccountStateService`
- Maintains component cleanliness by implementing only `OnDestroy` (for subscription cleanup)
- No additional subscriptions or manual cleanup needed - Angular handles effect lifecycle

## Related Components

This pattern could be applied to other components that display account-specific data:
- Direct messages
- Bookmarks
- Lists
- Favorites
- Any page showing user-specific content
