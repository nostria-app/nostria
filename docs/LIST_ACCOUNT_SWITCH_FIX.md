# List Account Switch Fix

## Problem
When switching between accounts, the lists from the previous account would remain displayed in the UI. This happened because:

1. The lists were loaded once in `ngOnInit()` based on the current pubkey
2. When the account changed, the component didn't react to the pubkey change
3. The cached lists remained in the `standardListsData` and `setsData` signals

## Root Cause
The component was using `computed()` to track the pubkey but wasn't watching for changes:

```typescript
pubkey = computed(() => this.accountState.pubkey());

async ngOnInit() {
  await this.loadAllLists(); // Only runs once on init
}
```

When the user switched accounts, the `pubkey` computed would update, but nothing triggered a reload of the lists.

## Solution

### Added Effect to Watch Pubkey Changes
Added a constructor with an `effect()` that watches for pubkey changes and automatically clears and reloads lists:

```typescript
constructor() {
  // Effect to reload lists when account changes
  effect(async () => {
    const pubkey = this.pubkey();
    
    // Clear existing lists first
    this.standardListsData.set(new Map());
    this.setsData.set(new Map());
    
    // Reload lists for the new account
    if (pubkey) {
      await this.loadAllLists();
    }
  });
}
```

### How It Works
1. **Initial Load**: When component initializes, the effect runs and loads lists for the current pubkey
2. **Account Switch**: When user switches accounts:
   - `accountState.pubkey()` changes
   - The `pubkey` computed updates
   - The effect detects the change
   - Existing lists are cleared (shows empty state immediately)
   - New lists are loaded for the new account
3. **No Account**: If pubkey becomes null/undefined, lists are cleared but not reloaded

### Removed Duplicate Load
Since the effect handles loading on initialization, we removed the duplicate call in `ngOnInit()`:

```typescript
async ngOnInit() {
  // Lists are loaded automatically by the effect when pubkey is available
  // No need to call loadAllLists here
  
  // Add to window for debugging
  if (typeof window !== 'undefined') {
    (window as unknown as { listComponent?: ListsComponent }).listComponent = this;
  }
}
```

## Benefits
1. **Automatic Cleanup**: Lists are immediately cleared when switching accounts
2. **Automatic Reload**: New account's lists are loaded automatically
3. **Reactive**: Uses Angular signals pattern for reactive updates
4. **No Stale Data**: Impossible to see wrong account's lists

## Pattern Used
This follows the same pattern used in other components like `relays.component.ts`:

```typescript
effect(async () => {
  const pubkey = this.accountState.pubkey();
  if (pubkey) {
    // Reload data for new account
  } else {
    // Clear data when no account
  }
});
```

## Testing
To verify the fix:
1. Open the Lists page with Account A
2. Create/view some lists
3. Switch to Account B
4. Lists should immediately clear
5. Account B's lists should load
6. Switch back to Account A
7. Account A's lists should appear again

## Related Files
- `lists.component.ts`: Added effect to watch pubkey changes
- `relays.component.ts`: Similar pattern for reference

## Date
January 16, 2025
