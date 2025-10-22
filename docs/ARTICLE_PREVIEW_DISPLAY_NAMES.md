# Article Preview Display Names Fix

## Issue
The article editor preview was showing truncated npub identifiers (e.g., `@npub1abc...xyz`) for `nostr:` profile references instead of displaying actual profile display names like the note editor does.

## Root Cause
The `processNostrReferences()` method in `EditorComponent` was converting `nostr:` URIs to HTML links but wasn't fetching profile metadata to display names. It was attempting to use an async method (`getCachedProfileSync()`) that couldn't properly access cached profile data synchronously from within a computed property.

## Solution
Updated `EditorComponent` to directly access the `Cache` service that `DataService` uses internally. This allows synchronous retrieval of already-cached profile metadata.

### Changes Made

1. **Added Cache Service Import**
   ```typescript
   import { Cache } from '../../../services/cache';
   import { NostrRecord } from '../../../interfaces';
   ```

2. **Injected Cache Service**
   ```typescript
   private cache = inject(Cache);
   ```

3. **Created `getCachedDisplayName()` Method**
   ```typescript
   private getCachedDisplayName(pubkey: string): string {
     const cacheKey = `metadata-${pubkey}`;
     const record = this.cache.get<NostrRecord>(cacheKey);

     if (record?.data) {
       // Same priority as ParsingService: display_name > name > truncated npub
       return (
         record.data.display_name ||
         record.data.name ||
         `${nip19.npubEncode(pubkey).substring(0, 12)}...`
       );
     }

     // Fallback to truncated npub if not cached
     return `${nip19.npubEncode(pubkey).substring(0, 12)}...`;
   }
   ```

4. **Updated `processNostrReferences()` to Use Display Names**
   - For `npub` references: `const displayName = this.getCachedDisplayName(pubkey);`
   - For `nprofile` references: `const displayName = this.getCachedDisplayName(pubkey);`
   - Both now render: `@${displayName}` in the link text

## How It Works

1. When a profile is fetched anywhere in the app (e.g., in feeds, mentions, etc.), `DataService` stores it in the cache with key `metadata-${pubkey}`
2. The article preview can now access this cache synchronously
3. Display name priority matches `ParsingService`:
   - `display_name` field (preferred)
   - `name` field (fallback)
   - Truncated npub (if profile not in cache)

## Benefits

- **Consistency**: Article preview now shows the same profile names as the note editor
- **Performance**: Uses synchronous cache access, no async calls in computed properties
- **User Experience**: Users see familiar display names instead of cryptic npub identifiers
- **Cache Reuse**: Leverages existing cached profile data from other parts of the app

## Technical Notes

- The `Cache` service provides synchronous `get<T>(key: string)` method
- Cache keys follow the pattern: `metadata-${pubkey}`
- `NostrRecord` interface has `data` field containing profile metadata
- The computed `markdownHtml` property remains synchronous and reactive
- Profiles that haven't been fetched yet will show truncated npub (12 chars + "...")

## Related Files

- `src/app/pages/article/editor/editor.component.ts` - Main changes
- `src/app/services/cache.ts` - Cache service
- `src/app/interfaces.ts` - NostrRecord interface
- `src/app/services/data.service.ts` - Uses same cache pattern
- `src/app/services/parsing.service.ts` - Reference implementation for display name logic

## Testing

To verify this fix:

1. Create a new article in the editor
2. Paste a profile reference like `nostr:npub1...`
3. Switch to preview tab
4. The profile link should show the actual display name (if already cached) or a truncated identifier
5. Compare with note editor behavior - both should now show the same names
