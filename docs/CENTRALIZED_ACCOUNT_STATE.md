# Centralized Account State Management

## Overview

Implemented a centralized per-account state management system using a single JSON structure in localStorage, replacing scattered individual keys with a unified approach.

## Implementation

### New Service: AccountLocalStateService

Created `src/app/services/account-local-state.service.ts` to manage all per-account state in a centralized JSON structure:

**Storage Key:** `nostria-state`

**Structure:**
```typescript
{
  [pubkey: string]: {
    notificationLastCheck?: number;
    activeFeed?: string;
    favorites?: string[];
    peopleViewMode?: string;
    peopleSortOption?: string;
    peopleFilters?: {
      hasRelayList: boolean;
      hasFollowingList: boolean;
      hasNip05: boolean;
      hasPicture: boolean;
      hasBio: boolean;
      favoritesOnly: boolean;
    };
  }
}
```

### Key Features

- **Type-safe accessors** for all state values
- **Per-account isolation** using pubkey as key
- **Automatic state initialization** with sensible defaults
- **Easy cleanup** with `clearAccountState(pubkey)` and `clearAllStates()`
- **Unified storage location** for maintainability

## Migration Details

### 1. Notification Last Check

**Before:**
- Key pattern: `nostria-notification-lastcheck-{pubkey}`
- Scattered individual keys per account
- Managed in `ContentNotificationService`

**After:**
- Stored in centralized state: `state[pubkey].notificationLastCheck`
- Methods: `getNotificationLastCheck(pubkey)`, `setNotificationLastCheck(pubkey, timestamp)`
- Updated `ContentNotificationService` to use `AccountLocalStateService`

### 2. Active Feed

**Before:**
- Key: `nostria-active-feed` (global, not per-account)
- Managed in `FeedsCollectionService`

**After:**
- Stored in centralized state: `state[pubkey].activeFeed`
- Methods: `getActiveFeed(pubkey)`, `setActiveFeed(pubkey, feedId)`
- Updated `FeedsCollectionService` to:
  - Inject `AccountStateService` for pubkey access
  - Inject `AccountLocalStateService` for state management
  - Use per-account feed storage

### 3. Favorites

**Before:**
- Key: `nostria-favorites`
- Structure: `Record<pubkey, string[]>`
- Maintained own per-account structure in `FavoritesService`

**After:**
- Stored in centralized state: `state[pubkey].favorites`
- Methods: `getFavorites(pubkey)`, `setFavorites(pubkey, favorites)`
- Updated `FavoritesService` to:
  - Remove internal `favoritesData` signal
  - Use `AccountLocalStateService` for all operations
  - Migrate legacy data on first load

### 4. People Page Settings

**Before:**
- Keys: `peopleViewMode`, `peopleSortOption`, `peopleFilters` (global, not per-account)
- Managed in `PeopleComponent` using localStorage
- Lost when switching accounts

**After:**
- Stored in centralized state per account:
  - `state[pubkey].peopleViewMode`
  - `state[pubkey].peopleSortOption`
  - `state[pubkey].peopleFilters`
- Methods:
  - `getPeopleViewMode(pubkey)`, `setPeopleViewMode(pubkey, mode)`
  - `getPeopleSortOption(pubkey)`, `setPeopleSortOption(pubkey, option)`
  - `getPeopleFilters(pubkey)`, `setPeopleFilters(pubkey, filters)`
- Updated `PeopleComponent` to:
  - Inject `AccountLocalStateService`
  - Use effects to load/save settings per account
  - Settings now preserved when switching accounts

## Updated Services

### ContentNotificationService

- Removed `LocalStorageService` dependency for timestamp storage
- Added `AccountLocalStateService` injection
- Updated `getLastCheckTimestamp()` to use centralized state
- Updated `updateLastCheckTimestamp()` to use centralized state
- Updated `resetLastCheckTimestamp()` to use centralized state
- Removed `LAST_NOTIFICATION_CHECK_KEY_PREFIX` constant

### FeedsCollectionService

- Added `AccountStateService` injection for pubkey access
- Added `AccountLocalStateService` injection
- Updated `loadActiveFeed()` to use centralized state
- Updated `saveActiveFeed()` to use centralized state
- Updated `resetToDefaults()` to clear state properly

### FavoritesService

- Removed internal `favoritesData` signal
- Removed `effect` for auto-saving (no longer needed)
- Updated `favorites` computed to read from centralized state
- Updated all mutation methods (`addFavorite`, `removeFavorite`, `clearCurrentAccountFavorites`) to use centralized state
- Simplified `getFavoritesForAccount()` to use centralized state
- Removed debug methods (`getTotalFavoritesCount`, `getAccountsWithFavoritesCount`)
- Added migration from old `nostria-favorites` structure

### PeopleComponent

- Added `AccountLocalStateService` injection
- Replaced localStorage loading/saving with effects that:
  - Load settings from centralized state when account changes
  - Save settings to centralized state when they change
- Updated `changeViewMode()` to save to centralized state
- Settings now properly isolated per account
- Imported and used `PeopleFilters` type from `AccountLocalStateService`

### ApplicationService

- Added `AccountLocalStateService` injection
- Updated `wipe()` method to call `accountLocalState.clearAllStates()`
- Removed manual cleanup loop for `nostria-notification-lastcheck-{pubkey}` keys
- Removed `nostria-active-feed` and `nostria-favorites` from individual cleanup list
- Removed `peopleFilters`, `peopleSortOption`, and `peopleViewMode` from individual cleanup list

## Benefits

1. **Single Source of Truth**: All per-account state in one location
2. **Improved Maintainability**: Easier to manage and debug
3. **Type Safety**: Centralized interface ensures consistent data structure
4. **Better Performance**: Single JSON parse/stringify instead of multiple operations
5. **Easier Migration**: Future state additions only need interface update
6. **Simplified Cleanup**: Single method to clear all account state

## Usage Examples

### Getting State

```typescript
// Notification last check
const lastCheck = this.accountLocalState.getNotificationLastCheck(pubkey);

// Active feed
const activeFeed = this.accountLocalState.getActiveFeed(pubkey);

// Favorites
const favorites = this.accountLocalState.getFavorites(pubkey);

// People page settings
const viewMode = this.accountLocalState.getPeopleViewMode(pubkey);
const sortOption = this.accountLocalState.getPeopleSortOption(pubkey);
const filters = this.accountLocalState.getPeopleFilters(pubkey);
```

### Setting State

```typescript
// Update notification timestamp
this.accountLocalState.setNotificationLastCheck(pubkey, Date.now());

// Set active feed
this.accountLocalState.setActiveFeed(pubkey, 'feed-id');

// Update favorites
this.accountLocalState.setFavorites(pubkey, ['pubkey1', 'pubkey2']);

// Update people page settings
this.accountLocalState.setPeopleViewMode(pubkey, 'medium');
this.accountLocalState.setPeopleSortOption(pubkey, 'engagement-desc');
this.accountLocalState.setPeopleFilters(pubkey, {
  hasRelayList: false,
  hasFollowingList: false,
  hasNip05: true,
  hasPicture: false,
  hasBio: false,
  favoritesOnly: false,
});
```

### Clearing State

```typescript
// Clear specific account
this.accountLocalState.clearAccountState(pubkey);

// Clear all accounts (used in wipe())
this.accountLocalState.clearAllStates();
```

## Migration Support

All services include automatic migration from old storage patterns:

- **ContentNotificationService**: Reads old per-account keys on first access
- **FeedsCollectionService**: Migrates from global `nostria-active-feed`
- **FavoritesService**: Migrates from `nostria-favorites` Record structure
- **PeopleComponent**: Loads from centralized state, no migration needed (settings were global before)

Legacy keys are preserved until explicit cleanup to ensure data safety.

## Testing Notes

Test scenarios:
1. ✅ New user with no existing state - initializes with defaults
2. ✅ Existing user with old keys - migrates to centralized state
3. ✅ Account switching - loads correct state per account
4. ✅ Wipe operation - clears all centralized state
5. ⏳ Multiple accounts - isolated state per pubkey (needs testing)

## Future Enhancements

Potential additions to centralized state:
- User preferences (theme, language, etc.) - per account
- UI state (expanded sections, drawer states)
- Cache timestamps
- Feature flags per account
- Media player queue state
- Draft content per account
