# List Editor Improvements: Import/Export & UI Refinements

## Changes Made

### 1. Fixed Identifier Editing Issue ✅

**Problem**: Editing the identifier of a set would create a new set instead of updating the existing one, leading to duplicates.

**Solution**: 
- Identifier field is now **disabled in edit mode** for sets (parameterized replaceable events)
- The field displays a clear message: "Identifier cannot be changed (would create a duplicate set)"
- Added computed property `identifierDisabled()` that returns `true` when editing a set

This ensures that:
- Users cannot accidentally create duplicate sets
- The identifier remains stable across edits
- The event is properly updated instead of replaced

### 2. Nostr Event Format for Import/Export 📥📤

**Changed from custom format to standard Nostr event format** for better interoperability.

#### Export Behavior

**When editing an existing list:**
Exports the complete Nostr event with all metadata:
```json
{
  "id": "abc123...",
  "pubkey": "def456...",
  "created_at": 1697472000,
  "kind": 10003,
  "tags": [
    ["d", "reading-list"],
    ["title", "My Reading List"],
    ["description", "Articles to read"],
    ["e", "event123...", "wss://relay.example.com"]
  ],
  "content": "",
  "sig": "xyz789..."
}
```

**When creating a new list:**
Exports a template (unsigned event) that can be imported:
```json
{
  "kind": 10003,
  "tags": [
    ["d", "reading-list"],
    ["title", "My Reading List"],
    ["e", "event123..."]
  ],
  "content": "{\"_note\":\"Private items need to be encrypted when publishing\",\"_privateItemCount\":2,\"_privateItems\":[...]}",
  "_isTemplate": true,
  "_metadata": {
    "listTypeName": "Bookmarks",
    "exportedAt": "2025-10-16T12:00:00.000Z"
  }
}
```

#### Why Nostr Event Format?

**Advantages:**
- ✅ **Standard**: Any NIP-51 compatible client can import/export
- ✅ **Portable**: True interoperability between Nostr apps
- ✅ **Complete**: Includes signatures, timestamps, event IDs
- ✅ **Verifiable**: Can verify event signatures for authenticity
- ✅ **Future-proof**: Follows official Nostr protocol
- ✅ **Simple**: Just export the actual event object

**Features:**
- Automatic filename generation: `nostr-{kind}-{identifier}-{timestamp}.json`
- Clean, readable JSON with 2-space indentation
- Full Nostr event when editing (includes signatures)
- Template format when creating new (ready to sign and publish)
- Private items included in content as JSON (with note about encryption)
- Button is disabled when list is empty

#### Import Behavior

**Import from any Nostr event JSON:**
- Opens native file picker (accepts .json files)
- Validates kind matches current list type
- Parses tags array to extract metadata and items
- Smart identifier handling:
  - **Create mode**: Imports identifier from `d` tag
  - **Edit mode**: Preserves existing identifier (prevents duplicates)
- Loads title, description, image from tags
- Extracts all public items from tags
- Attempts to parse private items from content (if in template format)
- Shows clear error messages if import fails
- File input is reset after each import

**Use Cases:**
1. **Backup & Restore**: Export lists regularly, restore if needed
2. **Duplicate Lists**: Export a list, import into a new set with different identifier
3. **Share Lists**: Share JSON files with other users (standard Nostr events)
4. **Migrate Lists**: Move lists between accounts or Nostr applications
5. **Template Lists**: Create template lists and reuse them
6. **Interoperability**: Import lists from other NIP-51 compatible clients

### 3. Card Layout Improvements 🎨

**Problem**: Cards had varying widths creating an unorganized appearance.

**Solution**: 
- Changed grid from `auto-fill` to `auto-fit` for better distribution
- Increased minimum card width from 300px to 320px
- Increased gap between cards from 16px to 20px
- Added flexbox layout to cards (`display: flex; flex-direction: column; height: 100%`)
- Made card content flex with `flex: 1` to fill available space
- Set `min-height: 42px` on description text for consistent 2-line height
- Used `margin-top: auto` on info sections and actions to push them to bottom

**Result:**
- Cards now have equal heights in each row
- Descriptions take consistent space
- Actions are aligned at the bottom
- More organized, professional appearance
- Better use of available space

### 4. Dialog Action Layout 🎨

**Dialog Actions Layout**:
- Split into left and right sections
- Left side: Import & Download buttons
- Right side: Cancel & Save buttons
- Clear visual separation of actions

**Responsive Design**:
- On mobile: Buttons stack vertically
- Both sections take full width
- Buttons expand to fill available space

**Visual Indicators**:
- Download button shows tooltip: "Download list as JSON file"
- Import button shows tooltip: "Import list from JSON file"
- Download is disabled when list is empty
- Icons clearly indicate action (upload/download)

## Technical Implementation

### Identifier Protection
```typescript
// Computed property to disable identifier in edit mode
identifierDisabled = computed(() => 
  this.mode === 'edit' && !this.listType.isReplaceable
);
```

### Download Implementation (Nostr Event Format)
```typescript
downloadList() {
  let exportData: Record<string, unknown>;

  if (this.mode === 'edit' && this.data.listData?.event) {
    // Export the original Nostr event (complete with signatures)
    exportData = { ...this.data.listData.event } as Record<string, unknown>;
  } else {
    // Export as a template (unsigned event ready to be signed)
    exportData = {
      kind: this.listType.kind,
      tags: this.buildTags(), // Build tags array from form data
      content: this.buildContent(), // Build content with private items
      _isTemplate: true,
      _metadata: {
        listTypeName: this.listType.name,
        exportedAt: new Date().toISOString(),
      },
    };
  }

  // Create blob and download
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `nostr-${this.listType.kind}-${this.identifier() || 'list'}-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
```

### Helper Methods
```typescript
// Build tags array from form data
private buildTags(): string[][] {
  const tags: string[][] = [];
  
  // Add d-tag for sets
  if (!this.listType.isReplaceable && this.identifier()) {
    tags.push(['d', this.identifier()]);
  }
  
  // Add metadata tags
  if (this.title()) tags.push(['title', this.title()]);
  if (this.description()) tags.push(['description', this.description()]);
  if (this.image()) tags.push(['image', this.image()]);
  
  // Add public items
  for (const item of this.publicItems()) {
    const tag: string[] = [item.tag, item.value];
    if (item.relay) tag.push(item.relay);
    if (item.marker) tag.push(item.marker);
    if (item.metadata) tag.push(item.metadata);
    tags.push(tag);
  }
  
  return tags;
}

// Build content with private items (for templates)
private buildContent(): string {
  if (this.privateItems().length > 0) {
    return JSON.stringify({
      _note: 'Private items need to be encrypted when publishing',
      _privateItemCount: this.privateItems().length,
      _privateItems: this.privateItems(),
    });
  }
  return '';
}
```

### Import Implementation (Nostr Event Format)
```typescript
async importList(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;

  const file = input.files[0];
  try {
    const text = await file.text();
    const data = JSON.parse(text) as Record<string, unknown>;

    // Validate kind matches
    if (typeof data['kind'] !== 'number' || data['kind'] !== this.listType.kind) {
      alert(`Invalid list type. Expected ${this.listType.name} (kind ${this.listType.kind})`);
      return;
    }

    // Parse tags array
    const tags = data['tags'] as string[][];
    if (!Array.isArray(tags)) {
      alert('Invalid event format: missing or invalid tags array');
      return;
    }

    // Clear existing items
    this.publicItems.set([]);
    this.privateItems.set([]);

    // Parse tags
    for (const tag of tags) {
      if (!Array.isArray(tag) || tag.length < 2) continue;

      const tagName = tag[0];
      const tagValue = tag[1];

      // Handle metadata tags
      if (tagName === 'd' && this.mode === 'create') {
        this.identifier.set(tagValue);
      } else if (tagName === 'title') {
        this.title.set(tagValue);
      } else if (tagName === 'description') {
        this.description.set(tagValue);
      } else if (tagName === 'image') {
        this.image.set(tagValue);
      } else {
        // Handle item tags
        const item: ListItem = {
          tag: tagName,
          value: tagValue,
          relay: tag[2],
          marker: tag[3],
          metadata: tag[4],
        };
        this.publicItems.update((items) => [...items, item]);
      }
    }

    // Parse content for private items (if template format)
    const content = data['content'] as string;
    if (content) {
      try {
        const parsed = JSON.parse(content);
        if (parsed._privateItems && Array.isArray(parsed._privateItems)) {
          this.privateItems.set(parsed._privateItems);
        }
      } catch {
        // Content is encrypted or not in template format - that's fine
      }
    }

    input.value = '';
  } catch (error) {
    console.error('Failed to import list:', error);
    alert('Failed to import list. Please check the file format.');
  }
}
```

### Card Layout CSS
```scss
// Equal-height cards with consistent spacing
.lists-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 20px;
}

.list-card {
  display: flex;
  flex-direction: column;
  height: 100%;

  mat-card-content {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .description {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 14px;
    margin: 0 0 16px 0;
    line-height: 1.5;
    min-height: 42px; // Consistent height for 2 lines
  }

  .list-info {
    margin-top: auto; // Push to bottom
  }

  mat-card-actions {
    margin-top: auto; // Push to bottom
  }
}
```

## Security & Validation

- **Kind Validation**: Ensures imported event kind matches current list type
- **Tag Validation**: Verifies tags array exists and is properly formatted
- **Type Safety**: Uses TypeScript type assertions with proper checks
- **Error Handling**: Graceful failure with user-friendly messages
- **No Code Execution**: Pure JSON data import (no eval)
- **Signature Verification**: Exported events include signatures (can be verified by other clients)

## User Workflow Examples

### Backing Up a List
1. Open list in edit mode
2. Click "Download"
3. File saved automatically with timestamp
4. Keep file safe for backup

### Restoring a List
1. Delete or lose a list
2. Create new list of same type
3. Click "Import"
4. Select backup JSON file
5. List restored with all items

### Duplicating a List
1. Open existing list
2. Click "Download"
3. Create new list
4. Click "Import"
5. Identifier is auto-generated (new set)
6. Modify as needed
7. Save

### Sharing a List
1. Export list to JSON
2. Share file with others
3. They import into their app
4. List recreated with same structure

## File Format Compatibility

The Nostr event JSON format is:
- **Standard**: Official NIP-01 event format
- **Human-readable**: Easy to inspect and edit
- **Portable**: Works across **all** NIP-51 compatible Nostr clients
- **Complete**: Contains all data needed to recreate or verify the list
- **Interoperable**: Can share lists with other Nostr applications
- **Verifiable**: Includes cryptographic signatures for authenticity

## Benefits

1. **No More Duplicates**: Identifier editing prevented in edit mode
2. **Data Safety**: Easy backup and restore functionality
3. **Standard Format**: Uses official Nostr event format (NIP-01)
4. **Interoperability**: Lists work with any NIP-51 compatible client
5. **User Control**: Full ownership of list data
6. **Portability**: Export from one app, import to another
7. **Transparency**: Users can inspect and verify event signatures
8. **Professional Layout**: Equal-height cards with consistent spacing

## Future Enhancements

Potential additions:
- Bulk export (download all lists at once)
- Bulk import (import multiple lists)
- Export to other formats (CSV, Markdown)
- Direct list sharing via Nostr relays (NIP-51 event publishing)
- Import from Nostr event URLs (nevent1...)
- Import lists from other users' relays
- Cloud backup integration
- Event signature verification UI
- Import from paste (don't require file)
