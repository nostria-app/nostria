# NIP-27 Implementation

This document describes the implementation of NIP-27 (Text Note References) in Nostria.

## Overview

NIP-27 standardizes how clients handle inline references to other events and profiles in the `.content` field of events. According to the specification, references should use the `nostr:` URI scheme followed by NIP-19 encoded identifiers.

## Supported Identifiers

The implementation supports the following NIP-19 identifier types:
- `note1...` - Basic note/event ID
- `nevent1...` - Event ID with optional relay hints and author
- `npub1...` - Basic public key
- `nprofile1...` - Profile with optional relay hints
- `naddr1...` - Addressable event (for long-form content, lists, etc.)

## Features Implemented

### 1. Automatic `nostr:` Prefix on Paste

When users paste NIP-19 identifiers into either the note editor or article editor, the application automatically detects and prefixes them with `nostr:`.

**Components affected:**
- `NoteEditorDialogComponent` (`note-editor-dialog.component.ts`)
- `RichTextEditorComponent` (`rich-text-editor.component.ts`)

**Implementation details:**
- The paste event handler intercepts clipboard content
- Detects NIP-19 identifiers using regex pattern: `/\b(note1|nevent1|npub1|nprofile1|naddr1|nsec1)[a-zA-Z0-9]+\b/`
- Automatically prepends `nostr:` if not already present
- Uses negative lookbehind to avoid double-prefixing: `/(?<!nostr:)\b(note1|...)/`

### 2. Tag Generation from Content References

When publishing notes or articles, the application parses `nostr:` URIs from the content and automatically generates appropriate tags.

**Components affected:**
- `NoteEditorDialogComponent` - `buildTags()` and `extractNip27Tags()` methods
- `EditorComponent` - `publishArticle()` and `extractNip27Tags()` methods

**Tag generation behavior:**

| Reference Type | Generated Tags | Notes |
|---------------|----------------|-------|
| `nostr:note1...` | `["e", <event-id>, ""]` | Basic event reference |
| `nostr:nevent1...` | `["e", <event-id>, <relay>, "", <pubkey>]`<br/>`["p", <pubkey>, ""]` | Event reference with relay and author |
| `nostr:npub1...` | `["p", <pubkey>, ""]` | Profile reference |
| `nostr:nprofile1...` | `["p", <pubkey>, ""]` | Profile reference with relay hints |
| `nostr:naddr1...` | `["a", "<kind>:<pubkey>:<d-tag>", <relay>]` | Addressable event reference |

**Important notes:**
- Tag generation is **optional** according to NIP-27
- Tags are recommended for ensuring notifications work properly
- Duplicate tags are avoided by tracking already-added event IDs and pubkeys
- Invalid NIP-19 identifiers are logged as warnings and skipped

### 3. Rich Text Editor Support

The rich text editor component (used in the article editor) handles paste events in both rich text and markdown modes:

- **Rich Text Mode**: Inserts the processed text as a text node at the cursor position
- **Markdown Mode**: Inserts at the textarea cursor position

## User Experience

### Creating a Note with References

1. User writes: `Check out this cool note: nevent1...`
2. User pastes, and it becomes: `Check out this cool note: nostr:nevent1...`
3. Upon publishing, appropriate `e` and `p` tags are automatically added

### Creating an Article with References

1. User writes article mentioning: `As discussed by npub1...`
2. The identifier is automatically prefixed with `nostr:` on paste
3. When published, a `p` tag is added for the mentioned profile

## Technical Implementation Details

### Pattern Matching

The implementation uses regex patterns to detect and transform NIP-19 identifiers:

```typescript
// Detection pattern
const nip19Pattern = /\b(note1|nevent1|npub1|nprofile1|naddr1|nsec1)[a-zA-Z0-9]+\b/;

// Transformation pattern (with negative lookbehind)
const replacePattern = /(?<!nostr:)\b(note1|nevent1|npub1|nprofile1|naddr1|nsec1)([a-zA-Z0-9]+)\b/g;
```

### NIP-19 Decoding

The implementation uses `nostr-tools`' `nip19.decode()` to parse identifiers:

```typescript
const decoded = nip19.decode(fullIdentifier);
switch (decoded.type) {
  case 'note': // ...
  case 'nevent': // ...
  case 'npub': // ...
  case 'nprofile': // ...
  case 'naddr': // ...
}
```

### Error Handling

- Invalid NIP-19 identifiers are caught and logged as warnings
- The application continues processing other valid identifiers
- Users are not interrupted by decode errors

## Compliance with NIP-27

This implementation follows NIP-27 specifications:

✅ Uses `nostr:` prefix for all references  
✅ Supports all major NIP-19 identifier types  
✅ Optionally generates tags for notifications  
✅ Handles paste events to simplify user input  
✅ Works with both text notes (kind 1) and long-form content (kind 30023)

## Future Enhancements

Possible improvements for future versions:

1. **Visual indicators**: Show `nostr:` references with special styling or icons
2. **Preview on hover**: Display profile/event preview when hovering over references
3. **Autocomplete**: Suggest recent events/profiles when typing `nostr:`
4. **Validation feedback**: Show inline warnings for invalid identifiers
5. **Custom relay hints**: Allow users to specify relay hints when creating references

## Testing Recommendations

When testing this feature:

1. Copy and paste various NIP-19 identifiers (note1, nevent1, npub1, etc.)
2. Verify that `nostr:` prefix is automatically added
3. Publish a note and check that appropriate tags are generated
4. Test with multiple references in the same note
5. Verify that existing `nostr:` prefixes are not duplicated
6. Test with invalid identifiers to ensure graceful handling
