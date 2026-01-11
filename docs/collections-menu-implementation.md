# Collections Menu Implementation

## Overview
This implementation adds a new "Collections" menu item to the Nostria application, providing a user-friendly way to organize and access various types of saved content and curated lists.

## Structure

The Collections menu follows this hierarchy:

```
Collections (Main Menu Item - Expandable)
├─ Bookmarks
├─ Videos (Curated Video Sets)
├─ Pictures (Curated Picture Sets)  
├─ Apps (Curated App Sets)
├─ Interest Sets
└─ Emoji Sets
```

## Implementation Details

### 1. Collections Page Component
**Location**: `/src/app/pages/collections/collections.component.ts`

A new standalone Angular component that displays collection types as cards. Each card:
- Shows an icon, title, and description
- Routes to the appropriate page when clicked
- Uses Angular Material components for consistent styling
- Supports responsive design (grid layout on desktop, single column on mobile)

Collection cards route to:
- **Bookmarks**: `/bookmarks` - Existing bookmarks page
- **Videos**: `/lists?tab=sets&kind=30005` - NIP-51 kind 30005 (Curation Sets - Videos)
- **Pictures**: `/lists?tab=sets&kind=30006` - NIP-51 kind 30006 (Curation Sets - Pictures)
- **Apps**: `/lists?tab=sets&kind=30267` - NIP-51 kind 30267 (App Curation Sets)
- **Interest Sets**: `/lists?tab=sets&kind=30015` - NIP-51 kind 30015 (Interest Sets)
- **Emoji Sets**: `/lists?tab=sets&kind=30030` - NIP-51 kind 30030 (Emoji Sets)

### 2. Routing Configuration
**Location**: `/src/app/app.routes.ts`

Added a new route:
```typescript
{
  path: 'collections',
  data: { isRoot: true },
  loadComponent: () =>
    import('./pages/collections/collections.component').then(m => m.CollectionsComponent),
  title: 'Collections',
}
```

### 3. Navigation Menu
**Location**: `/src/app/app.ts`

Updated the navigation system:
- Added "Collections" as a main menu item (authenticated users only)
- Made it expandable with 6 child items
- Positioned between "People" and "Messages" in the navigation
- Uses "bookmarks" icon for the main Collections item
- Children use appropriate icons (bookmark, video_library, photo_library, apps, label, emoji_emotions)

### 4. Lists Component Enhancement
**Location**: `/src/app/pages/lists/lists.component.ts`

Enhanced the existing Lists component to support filtering:
- Added `selectedKind` signal to track the filtered kind
- Reads query parameters (`tab` and `kind`) on initialization
- Automatically switches to the "Sets" tab when `tab=sets` parameter is present
- Filters displayed sets by kind when `kind` parameter is provided
- Added `getFilteredListSets()` method to return only matching list types

## Nostr Protocol Integration

All curated lists use NIP-51 (Lists and Sets) standard:

| Collection Type | NIP-51 Kind | Description |
|----------------|-------------|-------------|
| Bookmarks | 10003 | Single replaceable list for bookmarks |
| Bookmark Sets | 30003 | Multiple categorized bookmark collections |
| Videos | 30005 | Curated video collections |
| Pictures | 30006 | Curated photo/image collections |
| Apps | 30267 | Curated application collections |
| Interest Sets | 30015 | Topic-based hashtag collections |
| Emoji Sets | 30030 | Custom emoji collections |

### Bookmarks Support
The implementation supports both:
1. **Single Bookmark List** (kind 10003) - Accessed via the Bookmarks page
2. **Bookmark Sets** (kind 30003) - Multiple categorized bookmarks (advanced users can use the Lists page)

## User Experience

### For Regular Users
1. Navigate to Collections from the main menu
2. See all collection types as visual cards
3. Click any card to view/manage that collection type
4. Intuitive icons and descriptions guide usage

### For Advanced Users
1. Expand Collections menu to see all options
2. Click individual collection types directly from the menu
3. Access the full Lists page for advanced management
4. Create and manage multiple sets of each type

## Internationalization (i18n)

All text uses Angular's `$localize` for translation support:
- Menu labels
- Collection titles
- Collection descriptions
- Page titles

Translation keys follow the pattern:
- `@@app.nav.collections` - Main menu item
- `@@app.nav.collections.*` - Child menu items
- `@@collections.*` - Collections page content

## Files Created/Modified

### Created
1. `/src/app/pages/collections/collections.component.ts` - Component logic
2. `/src/app/pages/collections/collections.component.html` - Component template
3. `/src/app/pages/collections/collections.component.scss` - Component styles

### Modified
1. `/src/app/app.routes.ts` - Added Collections route
2. `/src/app/app.ts` - Added Collections to navigation with expandable children
3. `/src/app/pages/lists/lists.component.ts` - Added query parameter filtering
4. `/src/app/pages/lists/lists.component.html` - Updated to use filtered sets

## Future Enhancements

Potential improvements:
1. Add count badges showing number of items in each collection
2. Add recent activity indicators
3. Support for creating new sets directly from Collections page
4. Quick actions (e.g., "Add to Bookmarks") from Collections page
5. Search/filter within collections
6. Collection sharing/export functionality

## Testing Checklist

- [ ] Navigate to Collections from main menu
- [ ] Verify all collection cards are displayed correctly
- [ ] Click each card and verify correct routing
- [ ] Expand Collections in side menu
- [ ] Click each child item in side menu
- [ ] Verify query parameters are parsed correctly
- [ ] Verify correct tab selection in Lists page
- [ ] Verify kind filtering works correctly
- [ ] Test on mobile (responsive design)
- [ ] Test in dark/light mode
- [ ] Verify i18n strings are working

## Notes

- Collections menu item requires authentication (authenticated: true)
- All child routes are accessible without authentication for flexibility
- The implementation leverages existing Bookmarks and Lists pages
- No database schema changes required (uses existing NIP-51 standards)
- Fully compatible with other Nostr clients using NIP-51
