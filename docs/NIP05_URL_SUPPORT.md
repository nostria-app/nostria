# NIP-05 URL Support Implementation

## Overview

Added support for using NIP-05 identifiers (e.g., `nomishka@getalby.com`) in URL routes for both user profiles and articles. This feature queries the web server to resolve the NIP-05 identifier to a Nostr public key, then uses that public key to discover user relays and load their profile or article data.

## Supported URL Patterns

### User Profiles

Both of these URL patterns are now supported:

1. **Custom Username** (existing): `/u/username`
   - Example: `/u/nomishka`
   - Used for premium Nostria accounts with custom usernames

2. **NIP-05 Identifier** (new): `/u/nomishka@getalby.com`
   - Example: `/u/nomishka@getalby.com`
   - Resolves the NIP-05 identifier to a public key via web server query

### Articles

Both of these URL patterns are now supported:

1. **Regular Article URLs** (existing):
   - `/a/naddr1...` - Using naddr encoding
   - `/a/{npub or hex}/{slug}` - Using npub/hex and slug

2. **NIP-05 Article URLs** (new): `/a/nomishka@getalby.com/article-slug`
   - Example: `/a/nomishka@getalby.com/fKA2mArCZQa85hxpVLB_d`
   - Resolves the NIP-05 identifier to get the author's public key
   - Uses the slug to find the specific article

## Implementation Details

### Files Modified

1. **`usernameResolver.ts`**
   - Added `nip05` import from `nostr-tools`
   - Added check for `@` character to determine if input is a NIP-05 identifier
   - Added `resolveNip05()` method that uses `nip05.queryProfile()` to resolve identifiers
   - Falls back to regular username lookup for non-NIP-05 identifiers

2. **`articleResolver.ts`** (new file)
   - Created new resolver specifically for articles with NIP-05 identifiers
   - Resolves NIP-05 addresses to public keys before article component loads
   - Returns `ArticleResolverData` interface with pubkey, slug, and original identifier

3. **`app.routes.ts`**
   - Added import for `ArticleResolver`
   - Updated `/a/:id/:slug` route to include `ArticleResolver` in resolve property
   - Route now resolves both `data` (via `DataResolver`) and `article` (via `ArticleResolver`)

4. **`article.component.ts`**
   - Modified `loadArticle()` method to check for resolved article data
   - Checks `route.snapshot.data['article']` for NIP-05-resolved pubkey
   - Falls back to regular npub/hex decoding if no resolved data present
   - Silently updates URL to use npub format for consistency

### How It Works

#### User Profile Resolution Flow

1. User navigates to `/u/nomishka@getalby.com`
2. `UsernameResolver` detects `@` character in username
3. Calls `nip05.queryProfile('nomishka@getalby.com')`
4. Web server at `getalby.com` is queried via `/.well-known/nostr.json?name=nomishka`
5. Server returns public key if identifier is valid
6. Public key is passed to `ProfileComponent` which loads profile normally
7. If resolution fails, user is redirected to home page

#### Article Resolution Flow

1. User navigates to `/a/nomishka@getalby.com/article-slug`
2. `ArticleResolver` detects `@` character in ID parameter
3. Calls `nip05.queryProfile('nomishka@getalby.com')`
4. Resolved public key is stored in route data
5. `ArticleComponent` receives both ID and slug parameters
6. Component checks `route.snapshot.data['article']` for resolved pubkey
7. Uses resolved pubkey to query for article with matching slug
8. URL is silently updated to npub format: `/a/npub1.../article-slug`
9. If resolution fails, user is redirected to home page

## NIP-05 Protocol

The implementation uses the `nip05.queryProfile()` function from `nostr-tools`, which:

1. Parses the NIP-05 identifier (format: `name@domain.com`)
2. Makes an HTTPS request to `https://domain.com/.well-known/nostr.json?name=name`
3. Parses the response JSON to extract the public key
4. Returns `{ pubkey: string, relays?: string[] }` or `null` if not found

This follows the [NIP-05](https://github.com/nostr-protocol/nips/blob/master/05.md) specification for Nostr identifier verification.

## Error Handling

- If NIP-05 resolution fails (network error, invalid identifier, not found), the user is redirected to the home page
- Errors are logged to console for debugging
- Failed resolutions do not break the application or cause infinite loops

## Benefits

1. **User-Friendly URLs**: Users can share memorable NIP-05 addresses instead of long npub strings
2. **Consistent Experience**: Works seamlessly with existing URL patterns
3. **Decentralized**: Leverages the existing NIP-05 infrastructure
4. **Backwards Compatible**: Existing URLs continue to work without changes
5. **Discovery**: Automatically discovers user relays through the resolved profile

## Testing

To test the implementation:

1. **User Profiles**:
   - Navigate to `/u/{valid-nip05}` (e.g., `/u/nomishka@getalby.com`)
   - Verify profile loads correctly
   - Check that URL updates are handled properly

2. **Articles**:
   - Navigate to `/a/{valid-nip05}/{slug}` 
   - Verify article loads correctly
   - Check that URL is silently updated to npub format
   - Verify error handling for invalid identifiers

3. **Backwards Compatibility**:
   - Test existing `/u/username` URLs still work
   - Test existing `/a/naddr1...` URLs still work
   - Test existing `/a/npub.../slug` URLs still work
