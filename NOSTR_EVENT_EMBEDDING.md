# Nostr Event Embedding Implementation

## Overview
This document describes the implementation of embedded social previews for Nostr event references (nevent and note identifiers) within article content.

## Problem Statement
When users reference Nostr events in their articles using identifiers like:
- `nostr:nevent1...` - Event with metadata (ID, author, relay hints, kind)
- `nostr:note1...` - Simple note reference (just event ID)

Previously, these rendered as simple inline links. Now they render as rich embedded preview cards with actual content from the referenced event.

## Key Fix: Author Field
The nevent structure from `nip19.decode()` uses the field name `author` (not `pubkey`) for the event author's public key. The implementation correctly handles this:

```typescript
const authorPubkey = nostrData.data?.author || nostrData.data?.pubkey; // Try both for compatibility
```

## Implementation Details

### Example nevent Structure
```
nevent1qqs0q224zmndnn3war8tahn55j7te2uj7q0c8uj3hlfgfdk0k6e65fspz3mhxue69uhkuethwvh82arcduhx7mn99upzp8zaqu2nyk26frxh8jeszcyhhw22ecagcnlkr46dms4yv9gmsyueqvzqqqqqqyewg5tq
```

Decodes to:
```json
{
  "type": "nevent",
  "data": {
    "id": "f0295516...",
    "relays": ["wss://news.utxo.one/"],
    "author": "9c5d0715...",
    "kind": 1
  }
}
```

### Relay Discovery Strategy

The implementation uses a sophisticated fallback strategy to fetch event data:

#### 1. Relay Hints (Primary)
If the nevent includes relay hints, try those first:
```typescript
if (relayHints && relayHints.length > 0) {
  relaysToUse = this.utilities.normalizeRelayUrls(relayHints);
  event = await this.relayPool.get(relaysToUse, { ids: [eventId] }, 3000);
}
```

#### 2. Author Relay Discovery (Secondary)
If no relay hints or fetch failed, discover author's relays:
```typescript
if (!event && authorPubkey) {
  await this.userRelaysService.ensureRelaysForPubkey(authorPubkey);
  relaysToUse = this.userRelaysService.getRelaysForPubkey(authorPubkey) || [];
  
  if (relaysToUse.length > 0) {
    const optimalRelays = this.utilities.pickOptimalRelays(relaysToUse, 5);
    event = await this.relayPool.get(optimalRelays, { ids: [eventId] }, 3000);
  }
}
```

#### 3. Cache/Storage Fallback (Tertiary)
Finally, check local cache and storage:
```typescript
if (!event) {
  const record = await this.dataService.getEventById(eventId, { cache: true, save: true });
  event = record?.event || null;
}
```

### Preview Card Generation

Once the event is fetched, a rich preview card is generated:

```typescript
return `<div class="nostr-embed-preview" data-event-id="${eventId}" data-author="${author}" data-kind="${kind}">
  <a href="/e/${nip19.noteEncode(eventId)}" class="nostr-embed-link">
    <div class="nostr-embed-icon">
      <span class="embed-icon">${icon}</span>
    </div>
    <div class="nostr-embed-content">
      <div class="nostr-embed-title">${escapedContent}</div>
      <div class="nostr-embed-meta">${kindLabel} · by ${authorShort}</div>
    </div>
  </a>
</div>`;
```

### Event Kind Handling

Different event kinds get appropriate icons and labels:

| Kind | Icon | Label |
|------|------|-------|
| 1 | 📝 | Note |
| 6 | 🔁 | Repost |
| 7 | ❤️ | Reaction |
| 30023 | 📄 | Article |
| Other | 📝 | Kind {number} |

### Content Processing

Event content is processed for preview display:
- **Truncation**: Limited to 200 characters
- **HTML Escaping**: All content is escaped to prevent XSS
- **Ellipsis**: Long content shows "…" indicator

### Files Modified

1. **`src/app/services/format/format.service.ts`**
   - Added `DataService`, `RelayPoolService`, `UserRelaysService` injections
   - Created `fetchEventPreview()` method for fetching and rendering event data
   - Enhanced `nevent` case to show embedded previews
   - Enhanced `note` case to show embedded previews
   - Fallback to simple links if preview fetch fails

2. **CSS Styles** (already in place from previous implementation)
   - `src/app/components/content/content.component.scss`
   - `src/app/pages/article/article.component.scss`
   - `.nostr-embed-preview` styling for preview cards

## Usage Examples

### In Articles

**Input Markdown:**
```markdown
Check out this note: nostr:nevent1qqs0q224zmndnn3war8tahn55j7te2uj7q0c8uj3hlfgfdk0k6e65fspz3mhxue69uhkuethwvh82arcduhx7mn99upzp8zaqu2nyk26frxh8jeszcyhhw22ecagcnlkr46dms4yv9gmsyueqvzqqqqqqyewg5tq
```

**Rendered Output:**
```
┌─────────────────────────────────────────┐
│ 📝  This is the actual content of the   │
│     referenced note truncated to 200... │
│     Note · by 9c5d0715                  │
└─────────────────────────────────────────┘
```

### Fallback Behavior

If the event cannot be fetched (network issues, relay unavailable, etc.):
```html
<a href="/e/note1..." class="nostr-reference">📝 event12345678</a>
```

## Performance Considerations

### Timeouts
- Relay queries timeout after 3 seconds to prevent blocking
- Multiple queries run in parallel when possible

### Caching
- Fetched events are cached in DataService
- Prevents redundant network requests
- Improves performance for frequently referenced events

### Relay Selection
- Optimal relay picking (top 5) for author relay discovery
- Reduces unnecessary relay connections
- Prioritizes reliable relays

## Security

### XSS Prevention
All event content is HTML-escaped:
```typescript
const escapedContent = this.escapeHtml(previewContent);
```

### URL Normalization
All relay URLs are normalized:
```typescript
relaysToUse = this.utilities.normalizeRelayUrls(relayHints);
```

## Error Handling

### Graceful Degradation
If preview generation fails at any step:
1. Log warning with error details
2. Return null to trigger fallback
3. Render simple reference link instead
4. User experience is not broken

### Logging
All errors and warnings are logged:
```typescript
this.logger.warn('Could not fetch event for preview:', eventId);
this.logger.error('Error fetching event preview:', error);
```

## Benefits

### For Users
- **Rich Context**: See actual content before clicking
- **Better Discovery**: Understand what's being referenced
- **Professional Appearance**: Modern social media-style previews
- **Trust**: See author and content type at a glance

### For Developers
- **Extensible**: Easy to add more event kinds
- **Performant**: Smart caching and timeouts
- **Secure**: XSS prevention and URL validation
- **Maintainable**: Clear separation of concerns

## Future Enhancements

Potential improvements:
1. **Image Previews**: Extract and show images from event content
2. **Author Profiles**: Show author avatar and display name
3. **Reaction Counts**: Display likes/reposts/zaps
4. **Thread Context**: Show parent/reply relationships
5. **Loading States**: Show skeleton loaders while fetching
6. **Retry Logic**: Automatic retry with exponential backoff
7. **Batch Fetching**: Fetch multiple events in one request
8. **Preview Cache**: Persistent cache for preview HTML

## Testing

To test the implementation:

1. Create an article with embedded nevent:
   ```markdown
   Check this out: nostr:nevent1qqs0q224zmndnn3war8tahn55j7te2uj7q0c8uj3hlfgfdk0k6e65fspz3mhxue69uhkuethwvh82arcduhx7mn99upzp8zaqu2nyk26frxh8jeszcyhhw22ecagcnlkr46dms4yv9gmsyueqvzqqqqqqyewg5tq
   ```

2. Verify preview card appears with:
   - Event content (truncated)
   - Author pubkey (first 8 chars)
   - Event kind label
   - Appropriate icon

3. Test fallback by using invalid nevent:
   - Should show simple reference link
   - No errors in console

4. Test with note identifier:
   ```markdown
   See: nostr:note1...
   ```

## Browser Compatibility

- All modern browsers (Chrome, Firefox, Safari, Edge)
- Async/await support required
- Fetch API required
- No polyfills needed for target browsers

## Performance Metrics

Expected metrics:
- **Preview Fetch**: 100-500ms (with relay hints)
- **Relay Discovery**: 500-1500ms (without relay hints)
- **Cache Hit**: <10ms
- **Fallback Render**: <1ms
