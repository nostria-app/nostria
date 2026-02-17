# Article Preview Fix - Visual Demonstration

## Problem

When reposting articles (kind 30023), the preview was missing:
- ❌ Header image
- ❌ Article title
- ❌ Inline images
- ✅ Only plain text content was shown

## Example Article Event

### Without Proper Tags
```json
{
  "kind": 30023,
  "content": "# Akármeddig is jutunk, annyi biztos: maradunk az erdő szélén - Reni & Boka interjú\n\n![Header Image](https://example.com/concert.jpg)\n\nReni: 13 éve találkoztunk először, Boka akkoriban a PECA zenekarban énekelt...",
  "tags": [
    ["d", "article-id"],
    ["published_at", "1738108800"]
  ]
}
```

## Solution

### Before Fix
The component only looked for NIP-23 tags:
- `['title', 'Article Title']`
- `['image', 'https://...']`
- `['summary', 'Summary text']`

If these tags were missing, nothing was displayed except the markdown content.

### After Fix
Added intelligent fallback extraction:

1. **Title Extraction**
   ```typescript
   // First check for title tag
   const titleTag = event.tags.find(tag => tag[0] === 'title')?.[1];
   
   // Fallback: Extract from first # heading
   if (!titleTag && event.content) {
     const match = event.content.match(/^#\s+(.+?)\s*$/m);
     return match ? match[1].trim() : null;
   }
   ```
   
   Result: ✅ "Akármeddig is jutunk, annyi biztos: maradunk az erdő szélén - Reni & Boka interjú"

2. **Image Extraction**
   ```typescript
   // First check for image tag
   const imageTag = event.tags.find(tag => tag[0] === 'image')?.[1];
   
   // Fallback: Extract from markdown syntax ![alt](url)
   if (!imageTag && event.content) {
     const match = event.content.match(/!\[.*?\]\((https?:\/\/[^\s)]+\.(jpg|jpeg|png|gif|webp)...)\)/i);
     return match ? match[1] : null;
   }
   ```
   
   Result: ✅ "https://example.com/concert.jpg"

3. **Summary Extraction**
   ```typescript
   // First check for summary tag
   const summaryTag = event.tags.find(tag => tag[0] === 'summary')?.[1];
   
   // Fallback: Extract first substantial paragraph
   if (!summaryTag && event.content) {
     let content = event.content.replace(/^#\s+.+$/m, '').trim();
     const paragraphs = content.split(/\n\n+/);
     for (const para of paragraphs) {
       const cleaned = para.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
       if (cleaned.length >= 20) {
         return cleaned;
       }
     }
   }
   ```
   
   Result: ✅ "Reni: 13 éve találkoztunk először, Boka akkoriban a PECA zenekarban énekelt..."

## Result

Now reposted articles display correctly with:
- ✅ Header image (extracted from markdown)
- ✅ Title (extracted from # heading)
- ✅ Summary (extracted from first paragraph)
- ✅ Inline images (rendered via markdown)

This matches the behavior of other Nostr clients (Primal, Amethyst, Damus).

## Testing

Comprehensive unit tests added covering:
- Title extraction from tags and markdown heading
- Image extraction from tags, markdown syntax, and standalone URLs
- Summary extraction from tags and content paragraphs
- Edge cases (missing data, short content, nested brackets)

All tests pass ✅

## Performance

- Regex patterns pre-compiled as class properties to avoid repeated compilation
- No blocking operations - uses existing markdown rendering pipeline
- Minimal overhead - only runs fallback extraction when tags are missing
