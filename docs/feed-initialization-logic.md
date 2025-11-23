# Feed Initialization Logic

## Overview

This document explains how feed initialization works in Nostria and how it prevents unintended resets of user feed configurations.

## Problem Statement

Users were experiencing unexpected resets of their custom feed configurations. Feeds and columns would be reset to defaults when they shouldn't be, particularly when:
- Logging in with different methods (browser extension, nsec, etc.)
- Switching between accounts
- After clearing browser data partially

## Solution

A per-account `feedsInitialized` flag has been implemented to track whether default feeds have been set up for each account. This flag is stored in localStorage and persists across sessions and login methods.

## Behavior

### First-Time Users

When a user creates a new account or logs in for the first time:
1. System checks if `feedsInitialized` flag exists for the account's pubkey
2. If flag is `false` or not set, default feeds are initialized
3. Default feeds are saved to localStorage
4. `feedsInitialized` flag is set to `true`

### Returning Users

When a returning user logs in:
1. System loads feeds from localStorage for their pubkey
2. If feeds exist, they are loaded and displayed
3. If feeds exist but are empty, the empty state is preserved
4. `feedsInitialized` flag remains `true`

### Users Who Deleted All Feeds

If a user intentionally deletes all their feeds:
1. Empty feed array is saved to localStorage
2. `feedsInitialized` flag remains `true`
3. On next login, system respects the empty state
4. No automatic reset to defaults occurs

### Manual Reset

When a user explicitly chooses "Reset to Defaults" from the menu:
1. All current feeds are unsubscribed
2. Active feed is cleared
3. Default feeds are re-initialized
4. `feedsInitialized` flag remains `true` (preserving intent)

## Implementation Details

### Modified Files

1. **account-local-state.service.ts**
   - Added `feedsInitialized` property to `AccountLocalState` interface
   - Added `getFeedsInitialized(pubkey)` method
   - Added `setFeedsInitialized(pubkey, initialized)` method

2. **feed.service.ts**
   - Imported and injected `AccountLocalStateService`
   - Modified `loadFeeds()` to check `feedsInitialized` flag
   - Modified `saveFeeds()` to set flag when saving
   - Modified `resetToDefaults()` to maintain flag

### Key Methods

#### `loadFeeds()`
```typescript
private async loadFeeds(): Promise<void> {
  // 1. Check for stored feeds
  // 2. If found, load them
  // 3. If not found, check feedsInitialized flag
  // 4. Only initialize defaults if flag is false/unset
  // 5. If flag is true but no feeds, keep empty
}
```

#### `saveFeeds()`
```typescript
private saveFeeds(): void {
  // 1. Save feeds to localStorage by pubkey
  // 2. Set feedsInitialized = true
}
```

#### `resetToDefaults()`
```typescript
async resetToDefaults(): Promise<void> {
  // 1. Unsubscribe from current feeds
  // 2. Initialize default feeds
  // 3. Save to localStorage
  // 4. Keep feedsInitialized = true
}
```

## Testing Scenarios

To verify the fix works correctly, test these scenarios:

1. **New User**: Create a new account → Should see default feeds
2. **Returning User**: Log out and log back in → Should see custom feeds
3. **Different Login Methods**: 
   - Set up custom feeds with nsec
   - Log out
   - Log in with browser extension
   - → Should see same custom feeds
4. **Intentional Deletion**: 
   - Delete all feeds
   - Log out and back in
   - → Should remain empty, no auto-reset
5. **Manual Reset**: 
   - Click "Reset to Defaults" in menu
   - → Should see default feeds
   - Log out and back in
   - → Should still see default feeds

## Storage Keys

- **Feeds Storage**: `nostria-feeds` - Maps pubkey → FeedConfig[]
- **Account State**: `nostria-state` - Contains per-account settings including `feedsInitialized`

## Benefits

1. **Persistence**: Feed configurations survive login method changes
2. **User Control**: Respects user's intentional modifications
3. **First-Time Experience**: New users still get helpful defaults
4. **Predictability**: Consistent behavior across sessions
5. **Data Integrity**: No unexpected data loss

## Future Considerations

- Consider adding a "Restore Defaults" option separate from "Reset to Defaults"
- Potentially add feed export/import functionality
- Consider cloud backup of feed configurations
