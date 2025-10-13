# Circular Dependency Resolution

## Problem

The refactoring to merge duplicate nostr entity handling logic created a circular dependency:

```
LayoutService -> SearchService -> LayoutService
```

This occurred because:

1. `LayoutService` injected `SearchService` to delegate nostr entity handling
2. `SearchService` already injected `LayoutService` for UI operations and navigation
3. Angular detected this circular dependency and threw error NG0200

## Solution

Reverted to a single-responsibility approach where each service handles its own concerns:

### LayoutService (`src/app/services/layout.service.ts`)

- **Removed** SearchService injection to break the circular dependency
- **Restored** complete nostr entity handling logic directly in the service
- **Added** `handleNostrEntity()` method that handles all nostr entity types
- **Enhanced** `handleSearch()` to handle both `nostr:` prefixed URLs and direct entities
- **Keeps** all UI operations (toggleSearch, toast, navigation) in one place

### SearchService (`src/app/services/search.service.ts`)

- **Removed** all nostr entity handling logic (handleNostrEntity, handleNostrUrl, isNostrEntity)
- **Removed** nip19 and Router imports (no longer needed)
- **Focused** solely on cached profile search and NIP-05 lookups
- **Maintains** LayoutService injection for UI operations and navigation

## Benefits

- ✅ **Circular dependency resolved** - Services now have clear, non-circular dependencies
- ✅ **Separation of concerns** - Each service has a clear, focused responsibility
- ✅ **Maintainable code** - All nostr entity logic is in one place (LayoutService)
- ✅ **No functionality lost** - All original features continue to work
- ✅ **Clean architecture** - SearchService focuses on search, LayoutService handles routing

## Code Architecture

```
LayoutService:
- Handles all nostr entity parsing (npub, nevent, naddr, etc.)
- Manages UI state (search toggle, toast messages)
- Controls navigation and routing
- No external service dependencies for nostr handling

SearchService:
- Focuses on cached profile search
- Handles NIP-05 profile lookups
- Depends on LayoutService for UI operations
- Clean, focused responsibility
```

## Functionality Preserved

All user-facing functionality remains identical:

- Pasting `nostr:npub1...` URLs works correctly
- Typing `npub1...` directly in search works correctly
- All other nostr entity types (nevent, naddr, note, nprofile, nsec) work correctly
- Cached search results and NIP-05 lookups work correctly
- Error handling and user feedback work correctly

## Lessons Learned

- **Avoid circular dependencies** by clearly defining service responsibilities
- **Keep UI operations centralized** in layout/UI services
- **Make search services focused** on search functionality only
- **Consider dependency direction** when refactoring shared logic
