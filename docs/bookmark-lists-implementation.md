# Bookmark Lists Implementation

## Overview
Extended the bookmarks component with support for Bookmark Lists (NIP-51 kind 30003), allowing users to organize bookmarks into multiple named lists.

## Features Implemented

### 1. Bookmark Service Updates (`bookmark.service.ts`)
- **Added support for kind 30003** (Bookmark Lists - parameterized replaceable events)
- **Kind 10003** (default bookmarks) now acts as a regular list in the UI called "Bookmarks"
- **New signals:**
  - `bookmarkLists` - All custom bookmark lists (kind 30003)
  - `selectedListId` - Currently active bookmark list
  - `activeBookmarkEvent` - Computed event based on selected list
  - `allBookmarkLists` - Combined default + custom lists

- **New methods:**
  - `createBookmarkList(name)` - Create a new bookmark list
  - `updateBookmarkList(listId, name)` - Rename a bookmark list
  - `deleteBookmarkList(listId)` - Delete a bookmark list (publishes kind 5 deletion event)
  - `addBookmarkToList(id, type, listId)` - Add bookmark to specific list
  - `isBookmarkedInAnyList(id, type)` - Check if item is bookmarked anywhere
  - `getListsContainingBookmark(id, type)` - Get all lists containing a bookmark

### 2. Bookmark List Selector Component
**New component:** `bookmark-list-selector`

- **Location:** `src/app/components/bookmark-list-selector/`
- **Features:**
  - Shows all bookmark lists (default + custom)
  - Checkbox interface to add/remove from multiple lists
  - Create new list inline
  - Distinguishes default list with bookmark icon
  - Works for both events (kind 1) and articles (kind 30023)

### 3. Bookmarks Page Updates (`bookmarks.component.ts/html`)
- **List selector dropdown** - Switch between bookmark lists
- **List management menu:**
  - Create new list
  - Rename current list
  - Delete current list
- **Integration with CustomDialogService** for prompts and confirmations

### 4. Event Menu Updates (`event-menu.component.ts/html`)
- **Bookmark button behavior changed:**
  - Now opens the bookmark list selector dialog
  - Shows "Manage Bookmarks" if already bookmarked
  - Shows "Add to Bookmark List" if not bookmarked
  - Icon indicates if bookmarked in any list

### 5. Article Display Updates (`article-display.component.ts/html`)
- **Bookmark button for articles:**
  - Opens bookmark list selector dialog
  - Supports article type ('a' tags)
  - Uses the same unified interface

## Technical Details

### Nostr Event Structure

**Kind 30003 - Bookmark List:**
```json
{
  "kind": 30003,
  "tags": [
    ["d", "unique-list-id"],
    ["title", "My Reading List"],
    ["e", "event-id-1"],
    ["e", "event-id-2"],
    ["a", "30023:pubkey:slug"],
    ["r", "https://example.com"]
  ]
}
```

**Kind 10003 - Default Bookmarks:**
```json
{
  "kind": 10003,
  "tags": [
    ["e", "event-id"],
    ["a", "30023:pubkey:slug"],
    ["r", "https://example.com"]
  ]
}
```

### Tag Types Supported
- `e` - Event references (kind 1 notes)
- `a` - Addressable event references (kind 30023 articles)
- `r` - URL references (websites)

### List Management

**Create List:**
- Generates unique d-tag using timestamp
- Creates kind 30003 event with title tag
- Publishes and updates local state

**Update List:**
- Modifies title tag in existing event
- Re-publishes with same d-tag (replaces previous)

**Delete List:**
- Publishes kind 5 deletion event
- References list using 'a' tag: `30003:pubkey:d-tag`
- Removes from local state
- Switches to default list if currently selected

## User Experience

1. **View bookmarks:** Select list from dropdown on bookmarks page
2. **Add to list:** Click bookmark button → Select/create lists → Done
3. **Manage lists:** Three-dot menu on bookmarks page
4. **Multi-list support:** Items can exist in multiple lists simultaneously
5. **Visual feedback:** Icons show bookmark status across all lists

## Files Modified

- `src/app/services/bookmark.service.ts`
- `src/app/pages/bookmarks/bookmarks.component.ts`
- `src/app/pages/bookmarks/bookmarks.component.html`
- `src/app/pages/bookmarks/bookmarks.component.scss`
- `src/app/components/event/event-menu/event-menu.component.ts`
- `src/app/components/event/event-menu/event-menu.component.html`
- `src/app/components/article-display/article-display.component.ts`
- `src/app/components/article-display/article-display.component.html`

## Files Created

- `src/app/components/bookmark-list-selector/bookmark-list-selector.component.ts`
- `src/app/components/bookmark-list-selector/bookmark-list-selector.component.html`
- `src/app/components/bookmark-list-selector/bookmark-list-selector.component.scss`

## Compliance

✅ Follows NIP-51 specification for bookmark lists
✅ Uses proper Nostr event structure
✅ Timestamps in seconds (not milliseconds)
✅ Supports parameterized replaceable events
✅ Proper deletion using kind 5 events
