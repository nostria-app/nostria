# Follow Sets (Kind 30000) Implementation

This document describes the implementation of Follow Sets (NIP-51 Kind 30000) in Nostria.

## Overview

Follow Sets allow users to organize people they follow into custom groups. This is implemented using Nostr's kind 30000 events with the "nostria-" prefix for all d-tags.

## Features Implemented

### 1. Follow Sets Service (`follow-sets.service.ts`)

A new service that manages kind 30000 events:

- **Loading**: Automatically loads follow sets when an account is loaded
- **Persistence**: Saves to local database for offline access
- **Syncing**: Publishes changes to Nostr relays
- **Prefixing**: All d-tags are prefixed with "nostria-" (e.g., "nostria-favorites")

Key methods:
- `loadFollowSets(pubkey)` - Load all follow sets for a user
- `saveFollowSet(dTag, title, pubkeys)` - Create or update a follow set
- `deleteFollowSet(dTag)` - Delete a follow set
- `addToFollowSet(dTag, pubkey)` - Add a user to a set
- `removeFromFollowSet(dTag, pubkey)` - Remove a user from a set
- `createFollowSet(title, pubkeys)` - Create a new follow set with auto-generated d-tag

### 2. Favorites Integration

The existing Favorites feature now uses Follow Sets:

- **Migration**: Existing local favorites are automatically migrated to kind 30000 with d-tag "nostria-favorites"
- **Sync**: All favorite operations now sync to Nostr
- **Fallback**: Local storage is kept as a backup/cache
- **Compatibility**: The favorites API remains unchanged, so existing code continues to work

### 3. Navigation Menu Enhancement

The left sidebar "People" section is now expandable (like Feeds):

- **Expandable**: Click the arrow to expand/collapse
- **Child Items**: Shows all user's follow sets as sub-items
- **Icons**: "Favorites" shows a star icon, other sets show a group icon
- **Navigation**: Click a follow set to navigate to filtered people view
- **Management**: Gear icon next to each set for quick editing

### 4. User Profile Context Menu

Added "Add to Follow Set" option to user profile hover cards:

- **Submenu**: Opens a submenu showing all available follow sets
- **Checkmarks**: Shows which sets the user is already in
- **Toggle**: Click a set to add/remove the user
- **Create New**: Option to create a new follow set and add the user to it
- **Toast Feedback**: Success/error messages for user actions

### 5. UI Changes

- **Renamed**: "Edit Board" → "Edit Feed" for clarity
- **Navigation**: Smart routing to follow set filtered views
- **Consistency**: Follow set management UI matches feed management patterns

## Technical Details

### Event Structure (Kind 30000)

```json
{
  "kind": 30000,
  "tags": [
    ["d", "nostria-favorites"],
    ["title", "Favorites"],
    ["p", "pubkey1..."],
    ["p", "pubkey2..."],
    ...
  ],
  "content": ""
}
```

### D-Tag Format

All follow set d-tags are prefixed with "nostria-" to:
- Avoid conflicts with other Nostr clients
- Allow easy identification of Nostria-created sets
- Maintain compatibility with NIP-51 standard

### Persistence Strategy

1. **Primary**: Nostr relays (kind 30000 events)
2. **Cache**: Local database (IndexedDB via DataService)
3. **Fallback**: Local storage (for favorites only)

### Integration Points

The service integrates with:
- `NostrService` - For event signing
- `PublishService` - For publishing to relays
- `DataService` - For database operations
- `FavoritesService` - For favorites migration
- `AccountStateService` - For account changes

## Usage Examples

### Adding a User to a Follow Set

```typescript
await followSetsService.addToFollowSet('nostria-developers', userPubkey);
```

### Creating a New Follow Set

```typescript
const newSet = await followSetsService.createFollowSet('Bitcoin Devs', [pubkey1, pubkey2]);
```

### Checking if User is in a Set

```typescript
const sets = followSetsService.getFollowSetsForPubkey(userPubkey);
console.log(`User is in ${sets.length} sets:`, sets.map(s => s.title));
```

## Future Enhancements

Potential improvements for future iterations:

1. **Follow Set Management Dialog**: Dedicated UI for bulk managing sets
2. **Import/Export**: Share follow sets with other users
3. **Smart Sets**: Auto-categorize users based on topics/interests
4. **Set Icons**: Custom icons for each follow set
5. **Set Colors**: Color coding for visual organization
6. **Filtering**: Advanced filtering in People view by multiple sets

## Migration Notes

For existing Nostria users:

1. **Automatic Migration**: Favorites are automatically migrated on first app load
2. **No Data Loss**: Old local favorites remain as fallback
3. **Gradual Sync**: Follow sets sync to relays in the background
4. **Offline Support**: All operations work offline, sync when online

## NIP-51 Compliance

This implementation follows NIP-51 (Lists) specifications:

- Uses kind 30000 for Follow Sets
- Parameterized replaceable events (d-tag required)
- Supports multiple lists per user
- Compatible with other NIP-51 clients

## Testing

To test the implementation:

1. **Create Account**: Login or create a new account
2. **Add Favorites**: Add some users to favorites
3. **Verify Migration**: Check that favorites appear in follow sets
4. **Create Set**: Use context menu to create a new follow set
5. **Navigation**: Expand People menu and click a follow set
6. **Persistence**: Reload app and verify sets are persisted

## Related Files

- `src/app/services/follow-sets.service.ts` - Main service
- `src/app/services/favorites.service.ts` - Updated for sync
- `src/app/services/nostr.service.ts` - Sign function integration
- `src/app/app.ts` - Navigation menu logic
- `src/app/app.html` - Navigation menu template
- `src/app/components/user-profile/hover-card/` - Context menu
