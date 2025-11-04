# Private Notes Feature Implementation

## Overview
Implemented a private encrypted notes feature using NIP-78 (app-specific data) and NIP-44 (versioned encryption).

## Features
- **Private & Encrypted**: All notes are encrypted using NIP-44 with self-encryption (user's own public/private key pair)
- **Google Keep-like UI**: Color-coded note cards with a responsive grid layout
- **12 Color Options**: Predefined color palette for note organization
- **Single Event Storage**: All notes stored in one event for efficiency
- **Auto-save**: Changes are automatically saved when blurring the text area or changing colors

## Technical Details

### NIP-78 Implementation
- **Event Kind**: 30078 (addressable event)
- **D Tag**: `nostria-notes` (single hardcoded value as required)
- **Content**: NIP-44 encrypted JSON array containing all notes

### Encryption (NIP-44)
- Uses **self-encryption**: conversation key is computed using the user's own public and private key
- Encrypted content structure (array of notes):
  ```json
  [
    {
      "id": "unique-note-id",
      "content": "note text",
      "color": "#fef68a",
      "createdAt": 1234567890,
      "updatedAt": 1234567890
    },
    ...
  ]
  ```

### Storage Model
- **Single Event**: All notes are stored in a single NIP-78 event with d-tag "nostria-notes"
- **Atomic Updates**: Each operation (create/update/delete) rewrites the entire encrypted array
- **Efficient Sync**: Only one event needs to be fetched from relays

### File Structure
```
src/app/
├── models/
│   └── note.model.ts              # Note interfaces
├── services/
│   └── notes.service.ts           # NIP-78/NIP-44 logic, CRUD operations
└── pages/
    └── notes/
        ├── notes.component.ts      # Main notes page
        └── note-card/
            └── note-card.component.ts  # Individual note card
```

## Routes
- `/notes` - Main notes page

## Usage
1. Navigate to `/notes`
2. Click "New Note" to create a note
3. Type in the note content
4. Select a color from the color picker
5. Changes auto-save on blur
6. Click delete icon to remove a note

## Security
- **End-to-end encrypted**: Only the user can decrypt their notes
- **Self-encryption**: Uses NIP-44 conversation key with own pubkey
- **No plaintext storage**: Content is never stored unencrypted
- **Browser extension support**: Works with Nostr browser extensions (nos2x, Alby, etc.)

## Dependencies
- nostr-tools (nip44 v2 encryption)
- @noble/hashes (cryptographic utilities)
- Angular Material (UI components)

## Color Palette
The feature includes 12 predefined colors matching Google Keep aesthetics:
- Yellow (default) - `#fef68a`
- Red - `#f28b82`
- Orange - `#fbbc04`
- Light Yellow - `#fff475`
- Green - `#ccff90`
- Teal - `#a7ffeb`
- Blue - `#cbf0f8`
- Light Blue - `#aecbfa`
- Purple - `#d7aefb`
- Pink - `#fdcfe8`
- Brown - `#e6c9a8`
- Gray - `#e8eaed`

## Future Enhancements
- Rich text formatting
- Attachments/images
- Note sharing (with other Nostr users)
- Tags/categories
- Search functionality
- Archive/trash functionality
