# Algorithm Page Account Switching Fix

## Problem
When switching between accounts while on the Algorithm page, the displayed data did not update to reflect the new account's metrics. The page would continue showing the previous account's algorithm data until manually refreshed or navigated away and back.

## Solution
Added an `effect` in the `AlgorithmComponent` constructor that monitors changes to the active account's pubkey. When the account changes (and the account state is initialized), the component automatically reloads all algorithm data.

## Implementation Details

### Changes Made
1. Added `effect` import from `@angular/core`
2. Added `AccountStateService` injection to the component
3. Created an effect in the constructor that:
   - Watches `accountState.pubkey()` and `accountState.initialized()`
   - Calls `loadData()` when the account changes
   - Only triggers when both pubkey exists and account is initialized

### Code Structure
```typescript
constructor() {
  // Watch for account changes and reload data
  effect(() => {
    const pubkey = this.accountState.pubkey();
    
    // Only reload if we have a pubkey and the component has been initialized
    if (pubkey && this.accountState.initialized()) {
      this.loadData();
    }
  });
}
```

## Benefits
- **Reactive Updates**: Algorithm data automatically updates when switching accounts
- **Better UX**: Users see immediate feedback when changing accounts
- **Consistent State**: Ensures the displayed metrics always match the active account
- **No Manual Refresh**: Eliminates the need to navigate away and back to refresh data

## Testing
To verify the fix:
1. Navigate to the Algorithm page (`/settings/algorithm`)
2. Note the current metrics and user data displayed
3. Switch to a different account using the account switcher
4. Observe that the metrics and user data immediately update to reflect the new account
5. Switch back to the original account
6. Verify the original data is restored

## Technical Notes
- Uses Angular's `effect()` for reactive programming
- Guards against unnecessary loads by checking `initialized()` state
- Maintains existing `ngOnInit` behavior for initial load
- Follows the project's pattern of using signals and effects for state management
