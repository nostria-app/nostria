# Nostr URL Support

The application now supports pasting and searching with `nostr:` prefixed URLs. These URLs can contain various Nostr entities that will be automatically parsed and navigated to the appropriate page.

## Supported Nostr URL Types

### 1. Profile URLs (`npub`, `nprofile`)

- `nostr:npub1...` → Navigates to profile page (`/p/{pubkey}`)
- `nostr:nprofile1...` → Navigates to profile page with relay info

### 2. Event URLs (`note`, `nevent`)

- `nostr:note1...` → Navigates to event page (`/e/{eventId}`)
- `nostr:nevent1...` → Navigates to event page with relay info

### 3. Article URLs (`naddr`)

- `nostr:naddr1...` → Navigates to article/event page (`/e/{identifier}`)

## Example Usage

### Event/Article Example

```
nostr:nevent1qvzqqqr4xypzp5daxvenwv7ucsglpm5f8vuts530cr0zylllgkwejpzvak0x2kqmqy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9nhwden5te0wfjkccte9ehx7um5wghxyctwvsq3gamnwvaz7tmwdaehgu3wdau8gu3wv3jhvqgawaehxw309ahx7um5wgkhqatz9emk2mrvdaexgetj9ehx2aqpp4mhxue69uhkummn9ekx7mqpzemhxue69uhhyetvv9ujuurjd9kkzmpwdejhgqg4waehxw309aex2mrp0yhxgctdw4eju6t09uq3wamnwvaz7tmjv4kxz7fwwpexjmtpdshxuet59uq35amnwvaz7tmjd93x7tn9w5hxummnw3exjcfwv9c8qtcppemhxue69uhkummn9ekx7mp0qqs9f0y8qjy5ssp43nynaedw4p9k7yqwet4pyp2njya4wst39x65vzc3cvx4e
```

This will be parsed and navigate to the corresponding event page at `/e/{eventId}`.

## How It Works

1. **Search Input**: Users can paste nostr URLs into the search bar
2. **Automatic Detection**: The search service detects `nostr:` prefixed URLs
3. **NIP-19 Decoding**: Uses `nostr-tools` to decode the entity
4. **Smart Routing**: Routes to the appropriate page based on the entity type:
   - Profiles → `/p/{pubkey}`
   - Events/Articles → `/e/{eventId}`

## Implementation Details

- **Search Service**: Handles nostr URL parsing and routing
- **Layout Service**: Updated to defer to search service for nostr URLs
- **Paste Support**: Enhanced paste handling for better UX
- **Error Handling**: Graceful error handling for invalid URLs

## Error Handling

- Invalid nostr URLs show a user-friendly error message
- Unsupported entity types are logged and show an appropriate message
- Malformed URLs are caught and handled gracefully
