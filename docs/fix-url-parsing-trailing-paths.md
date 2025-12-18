# Fix: URL Parsing for Trailing Paths

## Issue
When pasting URLs like `https://nostria.app/p/npub1nkn4k86w8advjau7hmxj0j5qx2exxgufu8cqaru7khkdgreym3ks9y3chw/notes` into the search bar, the application was unable to correctly parse the npub identifier. The parser was including the `/notes` suffix as part of the npub, resulting in an invalid identifier that couldn't be processed.

## Root Cause
The issue was in the `extractNostriaEntity` method in `src/app/app.ts`. The regex pattern used to extract nostr entities from Nostria URLs was:

```typescript
const nostriaPattern = /^https?:\/\/(?:www\.)?nostria\.app\/(e|p|u|a)\/(.+)$/i;
```

The problem was the `(.+)$` capture group, which uses a **greedy** match that captures everything from the entity identifier to the end of the URL. This meant that URLs with trailing path segments like `/notes`, `/replies`, `/following`, etc., would have those segments included in the captured entity.

For example, with the URL `https://nostria.app/p/npub1test/notes`:
- The old pattern would capture: `npub1test/notes`
- This is invalid because npub identifiers don't contain forward slashes

## Solution
The fix changes the regex pattern to:

```typescript
const nostriaPattern = /^https?:\/\/(?:www\.)?nostria\.app\/(e|p|u|a)\/([^/]+)/i;
```

The key change is `(.+)$` → `([^/]+)`:
- `[^/]+` matches one or more characters that are **not** forward slashes
- This stops capturing at the first `/` after the entity identifier
- The `$` anchor is removed because we no longer need to match to the end of the URL

Now with the URL `https://nostria.app/p/npub1test/notes`:
- The new pattern correctly captures: `npub1test`
- Trailing path segments are ignored

## Testing
The fix was verified with multiple test cases:

1. **Profile URLs with /notes suffix**: `https://nostria.app/p/npub1.../notes` → extracts `npub1...`
2. **Profile URLs with /replies suffix**: `https://nostria.app/p/npub1.../replies` → extracts `npub1...`
3. **Event URLs with /comments suffix**: `https://nostria.app/e/nevent1.../comments` → extracts `nevent1...`
4. **Username URLs with suffix**: `https://nostria.app/u/sondreb/notes` → extracts `sondreb`
5. **Article URLs with suffix**: `https://nostria.app/a/naddr1.../details` → extracts `naddr1...`
6. **HTTP protocol**: Works with `http://` as well as `https://`
7. **www subdomain**: Works with `www.nostria.app` as well as `nostria.app`
8. **URLs without suffix**: Still works correctly for URLs without trailing paths

All test cases pass successfully.

## Impact
This fix allows users to:
- Copy and paste profile URLs with trailing paths (like `/notes`, `/replies`, `/following`) from their browser address bar
- Share URLs with specific tab suffixes that will still be correctly parsed
- Use URLs from bookmarks or external links that may include additional path segments

The fix is backward compatible - URLs without trailing paths continue to work exactly as before.

## Files Changed
- `src/app/app.ts`: Modified the `extractNostriaEntity` method to use non-greedy regex pattern

## Related Code
The extracted entity is then passed through:
1. `layout.onSearchInput()` - Sets the search query
2. `layout.handleSearch()` - Determines how to handle the entity
3. `layout.isNostrEntity()` - Checks if it's a valid nostr identifier
4. `layout.handleNostrEntity()` - Routes to the appropriate page (profile, event, article)
