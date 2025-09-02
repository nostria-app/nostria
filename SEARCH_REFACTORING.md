# Search Logic Refactoring

## Summary

Merged duplicate nostr entity parsing logic between `SearchService` and `LayoutService` to eliminate code duplication and improve maintainability.

## Changes Made

### SearchService (`src/app/services/search.service.ts`)

1. **Added `isNostrEntity()` helper method**: Checks if a value is a nostr entity (npub, nprofile, nevent, note, naddr, nsec)
2. **Refactored `handleNostrUrl()`**: Now delegates to the unified `handleNostrEntity()` method
3. **Enhanced `handleNostrEntity()`**:
   - Made public so it can be called from LayoutService
   - Handles all nostr entity types with proper error handling
   - Uses existing LayoutService methods for navigation (toggleSearch, openProfile, etc.)
4. **Updated effect logic**: Now handles both `nostr:` prefixed URLs and direct nostr entities in one place

### LayoutService (`src/app/services/layout.service.ts`)

1. **Added SearchService injection**: Injected SearchService to delegate nostr entity handling
2. **Simplified `handleSearch()` method**:
   - Removed duplicate nostr entity parsing logic
   - Delegates all nostr entity handling to SearchService
   - Handles both `nostr:` prefixed and non-prefixed entities
3. **Added `isNostrEntity()` helper method**: Checks if a value is a nostr entity for early detection
4. **Cleaned up imports**: Removed unused AddressPointer import

## Benefits

- **Eliminated Code Duplication**: All nostr entity parsing logic is now centralized in SearchService
- **Improved Maintainability**: Changes to nostr entity handling only need to be made in one place
- **Consistent Behavior**: Both direct entity input and nostr: URL pasting now use the same logic
- **Better Error Handling**: Unified error handling for all nostr entity types

## Usage

The refactoring is transparent to users. Both approaches continue to work:

- Pasting `nostr:npub1...` URLs
- Typing `npub1...` directly in search
- All other nostr entity types (nevent, naddr, note, nprofile, nsec)

## Technical Details

- SearchService.handleNostrEntity() is now the single source of truth for nostr entity parsing
- LayoutService delegates to SearchService but maintains control over UI actions (toggleSearch, toast messages)
- Error handling is context-aware (shows errors for nostr: URLs, falls through for direct entities)
