# Lists Feature Implementation (NIP-51)

## Overview

Implemented a comprehensive generic list editor for Nostr that fully supports NIP-51 (Lists). This feature allows users to create and manage both **standard lists** (replaceable events) and **sets** (parameterized replaceable events).

## What is NIP-51?

NIP-51 defines lists of things that users can create on Nostr. Lists can contain references to anything, and these references can be **public** or **private**.

- **Public items**: Specified in event tags, visible to everyone
- **Private items**: Encrypted using NIP-44 (or NIP-04 for backward compatibility) and stored in the event content

## Key Features

### 1. Two Types of Lists

#### Standard Lists (10000 series - Replaceable Events)
Users can have **only one** of each type:
- **Kind 10000**: Mute List - Users and content to hide
- **Kind 10001**: Pinned Notes - Events showcased on profile
- **Kind 10002**: Read/Write Relays - Publishing and mention relays (NIP-65)
- **Kind 10003**: Bookmarks - Saved notes, articles, hashtags, URLs
- **Kind 10004**: Communities - NIP-72 communities
- **Kind 10005**: Public Chats - NIP-28 chat channels
- **Kind 10006**: Blocked Relays - Relays to never connect to
- **Kind 10007**: Search Relays - Relays for search queries
- **Kind 10009**: Simple Groups - NIP-29 groups
- **Kind 10012**: Relay Feeds - Favorite browsable relays
- **Kind 10015**: Interests - Topics and interest sets
- **Kind 10020**: Media Follows - Multimedia follow list
- **Kind 10030**: Emojis - Preferred emojis and emoji sets
- **Kind 10050**: DM Relays - NIP-17 direct message relays
- **Kind 10101**: Good Wiki Authors - Recommended wiki authors
- **Kind 10102**: Good Wiki Relays - Relays with useful wiki articles

#### Sets (30000 series - Parameterized Replaceable Events)
Users can have **multiple sets** of each type with different identifiers:
- **Kind 30000**: Follow Sets - Categorized groups of users
- **Kind 30002**: Relay Sets - User-defined relay groups
- **Kind 30003**: Bookmark Sets - Categorized bookmarks
- **Kind 30004**: Curation Sets (Articles) - Curated articles and notes
- **Kind 30005**: Curation Sets (Videos) - Curated video collections
- **Kind 30007**: Kind Mute Sets - Mute pubkeys by event kinds
- **Kind 30015**: Interest Sets - Interest topics by hashtags
- **Kind 30030**: Emoji Sets - Categorized emoji groups
- **Kind 30063**: Release Artifact Sets - Software release artifacts
- **Kind 30267**: App Curation Sets - Curated software applications
- **Kind 31924**: Calendar Sets - Categorized calendar events
- **Kind 39089**: Starter Packs - Named set of profiles to follow together
- **Kind 39092**: Media Starter Packs - Multimedia profile sets

### 2. Privacy Support

The editor supports both public and private list items:
- **Public items** are stored as tags and visible to everyone
- **Private items** are encrypted using NIP-44 and only readable by the owner
- Users can easily move items between public and private

This is particularly useful for:
- Mute lists (keep blocked users private)
- Personal bookmarks (private reading lists)
- Private follow categories

### 3. Rich Metadata

Lists and sets support additional metadata:
- **Title**: Display name for the list
- **Description**: What the list is about
- **Image**: Optional image URL for visual identification
- **Identifier** (sets only): Unique d-tag for parameterized events

### 4. Flexible Tag Support

Each list type has expected tag types:
- `p` - Public keys (users)
- `e` - Event IDs
- `a` - Event coordinates (kind:pubkey:identifier)
- `t` - Hashtags
- `r` - URLs
- `relay` - Relay URLs (wss://...)
- `word` - Text strings (for mute words)
- `emoji` - Emoji definitions (shortcode and URL)
- `group` - Group IDs (NIP-29)

The editor intelligently shows appropriate hints based on the selected tag type.

## Implementation Details

### Components

#### `ListsComponent`
- Main component displaying all user lists
- Two tabs: Standard Lists and Sets
- Grid layout showing list cards with metadata
- Actions: Create, Edit, Delete

#### `ListEditorDialogComponent`
- Modal dialog for creating/editing lists
- Form with metadata fields (title, description, image, identifier)
- Item management with tag type selection
- Public/Private toggle for each item
- Two tabs showing public and private items separately
- Move items between public and private with one click

### Key Technical Points

1. **Event Creation**
   - Standard lists: Simple replaceable events with no d-tag
   - Sets: Parameterized replaceable events with required d-tag identifier
   - Public items stored as event tags
   - Private items encrypted and stored in content field

2. **Encryption**
   - Uses NIP-44 for encrypting private items (modern, secure)
   - Falls back to NIP-04 for backward compatibility when reading
   - Encrypts an array of tags as JSON

3. **Data Structure**
   ```typescript
   {
     kind: number,           // Event kind (10000-10015 or 30000-30030)
     tags: [
       ['d', 'identifier'],  // For sets only
       ['title', 'My List'],
       ['description', '...'],
       ['image', 'https://...'],
       ['p', 'pubkey', 'relay'],
       ['e', 'event-id', 'relay'],
       // ... more public items
     ],
     content: '<encrypted-private-items-json>'
   }
   ```

4. **Deletion**
   - Creates kind 5 (deletion) events
   - References both event ID ('e' tag) and coordinates ('a' tag for sets)
   - Published to optimized relays

## Usage

### For Users

1. **Navigate to `/lists`** in the application
2. **Select a tab**:
   - Standard Lists: Single instance per type
   - Sets: Multiple instances per type
3. **Create a list**:
   - Click "Create" or "Create New"
   - Fill in metadata (title, description, etc.)
   - Add items with appropriate tags
   - Toggle "Private" for sensitive items
   - Save
4. **Edit a list**:
   - Click "Edit" on any existing list
   - Modify metadata and items
   - Move items between public/private
   - Save changes
5. **Delete a list**:
   - Click "Delete" and confirm

### For Developers

The implementation follows NIP-51 specification exactly:

- Public items stored in event tags array
- Private items encrypted as JSON array using NIP-44
- Replaceable events (10000 series) have one per kind
- Parameterized replaceable events (30000 series) use d-tag for multiple instances
- All events published to user's optimized relays

## File Structure

```
src/app/pages/lists/
├── lists.component.ts          # Main component
├── lists.component.html        # Main template
├── lists.component.scss        # Main styles
└── list-editor-dialog/
    ├── list-editor-dialog.component.ts      # Editor dialog
    ├── list-editor-dialog.component.html    # Editor template
    └── list-editor-dialog.component.scss    # Editor styles
```

## Route

Added to `app.routes.ts`:
```typescript
{
  path: 'lists',
  data: { isRoot: true },
  loadComponent: () => import('./pages/lists/lists.component').then(m => m.ListsComponent),
  title: 'Lists',
}
```

## Future Enhancements

Potential improvements:
1. Import/export lists as JSON
2. Share lists with other users
3. Search and filter within lists
4. Batch operations (add multiple items at once)
5. List templates
6. Visual indicators for relay hints
7. Support for additional list kinds as they are defined in new NIPs

## References

- [NIP-51 Specification](https://github.com/nostr-protocol/nips/blob/master/51.md)
- [NIP-44 Encryption](https://github.com/nostr-protocol/nips/blob/master/44.md)
- [NIP-01 Basic Event Kinds](https://github.com/nostr-protocol/nips/blob/master/01.md)
