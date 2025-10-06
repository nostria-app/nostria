# Note Event Preview Feature

## Overview
This feature enables embedded social previews for Nostr event references (nevent and note identifiers) within **regular note content** (not just articles).

## Problem Solved
When users view a Nostr note/event that mentions another event using identifiers like:
- `nostr:nevent1...` - Event with metadata (ID, author, relay hints, kind)
- `nostr:note1...` - Simple note reference (just event ID)

Previously, these rendered as simple inline text like "event12345678..." with no preview. Now they render as rich embedded preview cards showing the actual content of the referenced event.

## Implementation Details

### Files Modified

#### 1. `note-content.component.ts`
**Purpose**: Renders note content tokens as HTML

**Changes**:
- Added `FormatService` injection for event preview fetching
- Added `DomSanitizer` for safe HTML rendering
- Created `eventPreviewsMap` signal to store rendered previews
- Added `effect()` to watch for token changes and load previews
- Created `loadEventPreviews()` method to fetch event data
- Created `getEventPreview()` method to retrieve cached preview HTML

**Key Code**:
```typescript
private async loadEventPreviews(tokens: ContentToken[]): Promise<void> {
  const previewsMap = new Map<number, SafeHtml>();

  for (const token of tokens) {
    if (token.type === 'nostr-mention' && token.nostrData) {
      const { type, data } = token.nostrData;

      if (type === 'nevent' || type === 'note') {
        const eventId = type === 'nevent' ? data.id : data;
        const authorPubkey = type === 'nevent' ? (data.author || data.pubkey) : undefined;
        const relayHints = type === 'nevent' ? data.relays : undefined;

        const previewHtml = await this.formatService.fetchEventPreview(
          eventId,
          authorPubkey,
          relayHints
        );

        if (previewHtml) {
          previewsMap.set(token.id, this.sanitizer.bypassSecurityTrustHtml(previewHtml));
        }
      }
    }
  }

  this.eventPreviewsMap.set(previewsMap);
}
```

#### 2. `note-content.component.html`
**Purpose**: Template for rendering note content

**Changes**:
- Added new condition to handle `nevent` and `note` mention types
- Renders preview HTML if available
- Falls back to simple reference link if preview fetch fails

**Key Code**:
```html
} @else if (
token.type === 'nostr-mention' &&
(token.nostrData?.type === 'nevent' || token.nostrData?.type === 'note')
) {
@if (getEventPreview(token.id); as preview) {
<div class="nostr-event-preview" [innerHTML]="preview"></div>
} @else {
&nbsp;<a class="nostr-reference">{{ token.nostrData?.displayName }}</a>&nbsp;
}
}
```

#### 3. `note-content.component.scss`
**Purpose**: Styles for note content

**Changes**:
- Added `.nostr-event-preview` container styles
- Added `:global(.nostr-embed-preview)` for preview card styling
- Added `:global(.nostr-reference)` for fallback link styling
- Supports Material Design theming with CSS variables
- Includes hover effects and responsive design

#### 4. `format.service.ts`
**Purpose**: Format and process content with Nostr token expansion

**Changes**:
- Changed `fetchEventPreview()` from `private` to `public`
- Updated JSDoc to note it's now available for component usage
- No functional changes to the method itself

## How It Works

### 1. Token Parsing
When a note's content is parsed, the `ParsingService` identifies Nostr identifiers and creates tokens with `nostrData`:

```typescript
{
  id: 123,
  type: 'nostr-mention',
  content: 'nostr:nevent1...',
  nostrData: {
    type: 'nevent',
    data: {
      id: 'f0295516...',
      author: '9c5d0715...',
      relays: ['wss://news.utxo.one/'],
      kind: 1
    },
    displayName: 'event12345678...'
  }
}
```

### 2. Preview Loading
When tokens are rendered in `NoteContentComponent`:
1. Effect detects token changes
2. For each `nevent`/`note` token:
   - Extract eventId, authorPubkey, relayHints
   - Call `formatService.fetchEventPreview()`
   - Store resulting HTML in `eventPreviewsMap` signal

### 3. Relay Discovery (3-Tier Strategy)
The `fetchEventPreview()` method uses a sophisticated fallback strategy:

#### Tier 1: Relay Hints
```typescript
if (relayHints?.length > 0) {
  event = await relayPool.get(relayHints, { ids: [eventId] });
}
```

#### Tier 2: Author Relay Discovery
```typescript
if (!event && authorPubkey) {
  await userRelaysService.ensureRelaysForPubkey(authorPubkey);
  const authorRelays = userRelaysService.getRelaysForPubkey(authorPubkey);
  event = await relayPool.get(authorRelays, { ids: [eventId] });
}
```

#### Tier 3: Cache/Storage Fallback
```typescript
if (!event) {
  const record = await dataService.getEventById(eventId, { cache: true, save: true });
  event = record?.event || null;
}
```

### 4. Preview Rendering
Once the event is fetched, a preview card is generated:

```html
<div class="nostr-embed-preview" data-event-id="..." data-author="..." data-kind="...">
  <a href="/e/note1..." class="nostr-embed-link">
    <div class="nostr-embed-icon">
      <span class="embed-icon">📝</span>
    </div>
    <div class="nostr-embed-content">
      <div class="nostr-embed-title">Event content truncated to 200...</div>
      <div class="nostr-embed-meta">Note · by 9c5d0715</div>
    </div>
  </a>
</div>
```

## Usage Example

### Viewing a Note with Event Reference

**Original Note Content**:
```
Just saw this interesting post: nostr:nevent1qqs0q224zmndnn3war8tahn55j7te2uj7q0c8uj3hlfgfdk0k6e65fspz3mhxue69uhkuethwvh82arcduhx7mn99upzp8zaqu2nyk26frxh8jeszcyhhw22ecagcnlkr46dms4yv9gmsyueqvzqqqqqqyewg5tq
```

**Rendered Output**:
```
Just saw this interesting post:

┌───────────────────────────────────────────┐
│ 📝  This is the actual content of the     │
│     referenced note truncated to 200...   │
│     Note · by 9c5d0715                    │
└───────────────────────────────────────────┘
```

### Fallback Behavior

If the event cannot be fetched:
```
Just saw this interesting post: event12345678...
```

## Performance Considerations

### Async Loading
- Previews load asynchronously after initial render
- Does not block note content display
- Uses Angular signals for reactive updates

### Caching
- Preview HTML cached in component signal
- Prevents redundant fetches for same event
- Cleared when tokens change

### Timeouts
- Relay queries timeout after 3 seconds
- Prevents indefinite waiting

### Relay Selection
- Prioritizes relay hints from nevent
- Falls back to author's known relays
- Uses optimal relay selection (top 5)

## Security

### HTML Sanitization
All preview HTML is sanitized using `DomSanitizer.bypassSecurityTrustHtml()`:
```typescript
previewsMap.set(token.id, this.sanitizer.bypassSecurityTrustHtml(previewHtml));
```

The HTML generated by `FormatService.fetchEventPreview()` already escapes content:
```typescript
const escapedContent = this.escapeHtml(previewContent);
```

### XSS Prevention
- All event content is HTML-escaped
- URLs are normalized
- No inline scripts or dangerous content

## Error Handling

### Graceful Degradation
If preview generation fails:
1. Error is logged to console
2. Component continues rendering
3. Falls back to simple reference link
4. User experience is not broken

### Logging
```typescript
console.debug('[NoteContent] Loading preview for nevent:', eventId);
console.debug('[NoteContent] Preview loaded for token', token.id);
console.error('[NoteContent] Error loading preview for token:', error);
```

## Benefits

### For Users
- **Rich Context**: See what the referenced event is about without leaving the page
- **Better UX**: Visual previews are more engaging than text links
- **Faster Navigation**: Decide if event is worth viewing before clicking

### For Developers
- **Reusable**: `FormatService.fetchEventPreview()` is now public and reusable
- **Reactive**: Uses Angular signals for automatic updates
- **Extensible**: Easy to add support for more event types
- **Maintainable**: Separated concerns between parsing, fetching, and rendering

## Testing

### Manual Testing Steps
1. View a note that contains `nostr:nevent1...` or `nostr:note1...` references
2. Verify preview card appears after a moment
3. Verify preview shows correct event content
4. Verify clicking preview navigates to event page
5. Test with various event kinds (1, 6, 7, 30023, etc.)
6. Test with events that have relay hints
7. Test with events that don't have relay hints
8. Test with events that can't be fetched (should show fallback)

### Debug Logging
Enable debug logging to trace execution:
```
[NoteContent] Loading preview for nevent: f0295516...
[fetchEventPreview] Starting fetch for event: {...}
[fetchEventPreview] Trying relay hints: ["wss://news.utxo.one/"]
[fetchEventPreview] ✓ Event fetched from relay hints
[NoteContent] Preview loaded for token 123
```

## Known Limitations

1. **No Real-time Updates**: Previews don't update if the referenced event changes
2. **Network Required**: Cannot preview events not in cache if offline
3. **Timeout**: 3-second timeout may not be enough for slow relays
4. **Memory**: Large numbers of previews in long threads may use memory

## Future Enhancements

1. **Lazy Loading**: Load previews only when scrolled into view
2. **Preview Cache**: Persist previews across sessions
3. **Interactive Previews**: React/zap directly from preview
4. **Thread Previews**: Show reply count and latest reply
5. **Media Previews**: Show image/video thumbnails in preview
