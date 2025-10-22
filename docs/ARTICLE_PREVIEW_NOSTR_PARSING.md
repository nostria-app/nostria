# Article Preview nostr: Reference Parsing

## Issue
The article editor preview was not parsing `nostr:` references and displaying clickable links with profile aliases, unlike the note editor preview which uses the `app-content` component.

## Solution
Enhanced the article editor's markdown preview to process `nostr:` references after markdown rendering, converting them into clickable HTML links.

## Implementation

### Changes Made

**File: `src/app/pages/article/editor/editor.component.ts`**

1. **Enhanced `markdownHtml` computed property:**
   - Added call to `processNostrReferences()` after markdown parsing
   - This ensures nostr: references become clickable links in the preview

2. **Added `processNostrReferences()` method:**
   - Detects all `nostr:` URIs using regex pattern
   - Decodes NIP-19 identifiers using `nip19.decode()`
   - Creates clickable HTML links based on reference type:
     - **npub/nprofile**: `@<short-pubkey>...` → Links to `/p/<npub>`
     - **note/nevent**: `📝 Note` → Links to `/e/<nevent>`  
     - **naddr**: `📄 Article` → Links to `/a/<npub>/<identifier>`

### How It Works

```typescript
// Before: Plain markdown parsing
markdownHtml = computed(() => {
  const html = marked.parse(content);
  return this.sanitizer.bypassSecurityTrustHtml(html);
});

// After: Markdown parsing + nostr: reference processing
markdownHtml = computed(() => {
  let html = marked.parse(content) as string;
  html = this.processNostrReferences(html);
  return this.sanitizer.bypassSecurityTrustHtml(html);
});
```

### Example Transformations

**Input (Markdown with nostr: references):**
```markdown
Check out this profile: nostr:npub1a2b3c4d5e...

Reference this note: nostr:nevent1xyz...
```

**Output (HTML with clickable links):**
```html
<p>Check out this profile: <a href="/p/npub1a2b3c4d5e..." class="nostr-profile-link" title="nostr:npub1a2b3c4d5e...">@a2b3c4d5...</a></p>

<p>Reference this note: <a href="/e/nevent1xyz..." class="nostr-event-link" title="nostr:nevent1xyz...">📝 Note</a></p>
```

## Benefits

✅ **Consistent UX**: Article preview now behaves like note preview
✅ **Clickable References**: Users can click on nostr: references in preview
✅ **Visual Clarity**: Profile references show shortened pubkey, events show emoji icons
✅ **Error Handling**: Invalid references gracefully fall back to plain text
✅ **Type Safety**: Uses proper TypeScript type handling with `as unknown` pattern

## Testing

To test this feature:

1. Create a new article in the article editor
2. Add a `nostr:` reference (paste an npub, nevent, etc.)
3. Switch to the Preview tab
4. Verify that the reference appears as a clickable link
5. Click the link to verify it navigates correctly

## Notes

- The preview shows shortened pubkeys (first 8 characters) rather than full profile names
- This is a lighter-weight solution compared to fetching full profiles asynchronously
- The solution processes the HTML after markdown rendering, maintaining all markdown features
- Links include `title` attributes with the full nostr: URI for accessibility
