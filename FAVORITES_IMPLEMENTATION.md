# Favorites Per-Account Implementation

## Summary

This update changes the favorites functionality from being shared across all accounts to being per-account (per public key). Each account now has its own separate favorites list.

## Changes Made

### 1. New Service: `FavoritesService`

**File:** `src/app/services/favorites.service.ts`

- **Purpose:** Centralized management of favorites with per-account storage
- **Key Features:**
  - Per-account favorites storage using the account's public key as the container
  - Automatic migration from legacy global favorites to current account
  - Reactive signals for real-time updates
  - Comprehensive API for managing favorites

**Storage Structure:**
```typescript
{
  [pubkey: string]: string[] // Account pubkey -> array of favorite user pubkeys
}
```

**Key Methods:**
- `isFavorite(userPubkey: string): boolean` - Check if user is favorited
- `addFavorite(userPubkey: string): boolean` - Add user to favorites
- `removeFavorite(userPubkey: string): boolean` - Remove user from favorites
- `toggleFavorite(userPubkey: string): boolean` - Toggle favorite status
- `favorites: Signal<string[]>` - Reactive signal for current account's favorites

### 2. Updated Components

#### `ProfileHeaderComponent`
**File:** `src/app/pages/profile/profile-header/profile-header.component.ts`

- Replaced direct localStorage access with `FavoritesService`
- Removed legacy `favoriteUsers` signal and related methods
- Updated `isFavorite` computed to use the service
- Simplified `toggleFavorite()` method

#### `PeopleComponent` 
**File:** `src/app/pages/people/people.component.ts`

- Added `FavoritesService` injection
- Updated favorites filter to use `favoritesService.favorites()` instead of localStorage

#### `AlgorithmComponent`
**File:** `src/app/pages/settings/algorithm/algorithm.ts`

- Replaced localStorage favorites access with `FavoritesService`
- Updated algorithm stats computation
- Simplified favorite toggle functionality

### 3. Updated Services

#### `Algorithms`
**File:** `src/app/services/algorithms.ts`

- Added `FavoritesService` injection
- Removed legacy `getFavorites()` method
- Updated methods to use `favoritesService.favorites()` for current account favorites

## Migration Strategy

### Automatic Migration and Backwards Compatibility
The `FavoritesService` includes robust backwards compatibility handling:

1. **Structure Validation:** On load, validates that stored data matches the expected per-account structure
2. **Legacy Migration:** If data is in the old array format, automatically migrates to current account
3. **Graceful Failure:** If parsing fails or data structure is invalid, wipes existing favorites and starts fresh
4. **Safe Defaults:** Always falls back to empty favorites rather than crashing

### Migration Process
1. **Valid New Format:** Loads data normally
2. **Legacy Array Format:** Migrates array to current account's favorites
3. **Invalid/Corrupt Data:** Wipes storage and starts with empty favorites
4. **Parse Errors:** Logs error, wipes storage, and continues with empty state

### Storage Keys
- **Legacy:** `nostria-favorites` (flat array - migrated automatically)
- **New:** `nostria-favorites` (object with pubkey keys)

## Benefits

1. **Account Isolation:** Each account maintains its own favorites list
2. **No Cross-Contamination:** Switching accounts doesn't affect favorites
3. **Better UX:** Users can have different favorite lists for different accounts/contexts
4. **Backward Compatibility:** Automatic migration preserves existing favorites
5. **Reactive Updates:** Uses Angular signals for real-time UI updates
6. **Centralized Logic:** All favorites logic in one service for easier maintenance

## Testing

A test component has been created at `src/app/components/favorites-test/favorites-test.component.ts` for manual testing of the functionality.

### Test Scenarios
1. **Account Switching:** Verify favorites are isolated per account
2. **Migration:** Test with legacy favorites data
3. **CRUD Operations:** Add, remove, toggle favorites
4. **Persistence:** Verify favorites persist across browser sessions
5. **Multiple Accounts:** Test with multiple accounts having different favorites

## Usage Example

```typescript
import { FavoritesService } from './services/favorites.service';

@Component({...})
export class MyComponent {
  private favoritesService = inject(FavoritesService);
  
  // Get current account's favorites
  favorites = this.favoritesService.favorites;
  
  // Check if user is favorite
  isUserFavorite(userPubkey: string): boolean {
    return this.favoritesService.isFavorite(userPubkey);
  }
  
  // Toggle favorite status
  toggleUserFavorite(userPubkey: string): void {
    this.favoritesService.toggleFavorite(userPubkey);
  }
}
```

## Error Handling

The service includes comprehensive error handling:
- Try-catch blocks around localStorage operations
- Graceful fallbacks for parsing errors
- Detailed logging for debugging
- Safe defaults (empty arrays) for missing data

## Future Enhancements

1. **Sync Across Devices:** Could be extended to sync favorites via Nostr events
2. **Categories:** Could add favorite categories/tags
3. **Import/Export:** Could add functionality to export/import favorites
4. **Backup:** Could add automatic backup of favorites data
