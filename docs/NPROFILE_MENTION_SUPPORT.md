# NProfile Mention Support

## Overview

The application fully supports `nprofile1` mentions in addition to `npub1` mentions. When a user is mentioned using either format, the system will:

1. Parse the mention from the event content
2. Decode the nprofile/npub to extract the pubkey
3. Fetch the user's profile metadata
4. Display the user's display name or username in the event

## Implementation Details

### 1. Content Parsing (`parsing.service.ts`)

The parsing service uses a regex pattern to match both `npub` and `nprofile` mentions:

```typescript
const nostrRegex = /(nostr:(?:npub|nprofile|note|nevent|naddr)1[a-zA-Z0-9]+)(?=\s|##LINEBREAK##|$|[^\w])/g;
```

### 2. URI Decoding

When a `nprofile1` mention is detected, it's decoded using `nip19.decodeNostrURI()`:

```typescript
const decoded = nip19.decodeNostrURI(uri);

if (decoded.type === 'nprofile') {
  pubkey = (decoded.data as ProfilePointer).pubkey;
} else if (decoded.type === 'npub') {
  pubkey = decoded.data;
}
```

### 3. Profile Metadata Fetching

Once the pubkey is extracted, the system fetches the user's profile metadata:

```typescript
metadata = await this.data.getProfile(pubkey);

if (metadata) {
  displayName = 
    metadata.data.display_name || 
    metadata.data.name || 
    this.utilities.getTruncatedNpub(pubkey);
}
```

### 4. Display Rendering

The `note-content.component.html` renders both `npub` and `nprofile` mentions using the same template:

```html
@else if (
  token.type === 'nostr-mention' &&
  (token.nostrData?.type === 'npub' || token.nostrData?.type === 'nprofile')
) {
  &nbsp;<a class="nostr-mention" 
    (click)="onNostrMentionClick(token)" 
    (mouseenter)="onMentionMouseEnter($event, token)"
    (mouseleave)="onMentionMouseLeave()">&#64;{{ token.nostrData?.displayName }}</a>&nbsp;
}
```

## Supported Formats

### npub (Simple Public Key)
```
nostr:npub1...
```

Example:
```
nostr:npub1abc123def456...
```

### nprofile (Public Key + Relay Hints)
```
nostr:nprofile1...
```

Example:
```
nostr:nprofile1qqst8vw4szfsd3jzklr7nuqulxnn48wgkd35vdmkxcwjthqfylds42qpzamhxue69uhhyetvv9ujuurjd9kkzmpwdejhgtcpz3mhxue69uhhyetvv9ukzcnvv5hx7un89uqjqamnwvaz7tmvd938yetjv4kxz7fwv9shymmwd96k66tf9e3k7mf0lzf63k
```

The `nprofile` format is preferred because it includes relay hints, which helps clients find the user's profile more reliably.

## Behavior

1. **With Profile Metadata**: Displays the user's `display_name` or `name` from their profile
2. **Without Profile Metadata**: Falls back to a truncated npub format (e.g., `npub1abc...xyz`)
3. **Interactive**: Clicking on a mention navigates to the user's profile
4. **Hover Cards**: Hovering over a mention shows a hover card with profile preview

## Debugging

If mentions are not displaying correctly, check the browser console for debug logs from the parsing service:

- `Decoded nprofile mention for pubkey: ...`
- `Found profile for ...: [display name]`
- `No profile found for ..., using truncated npub: ...`

## Testing

To test nprofile mentions:

1. Create a note with a mention like:
   ```
   Hello nostr:nprofile1qqst8vw4szfsd3jzklr7nuqulxnn48wgkd35vdmkxcwjthqfylds42qpzamhxue69uhhyetvv9ujuurjd9kkzmpwdejhgtcpz3mhxue69uhhyetvv9ukzcnvv5hx7un89uqjqamnwvaz7tmvd938yetjv4kxz7fwv9shymmwd96k66tf9e3k7mf0lzf63k
   ```

2. The mention should render as `@[username]` where `[username]` is the display name or name from the profile

3. Clicking the mention should navigate to the user's profile page

4. Hovering over the mention should show a profile preview card

## Related Files

- `src/app/services/parsing.service.ts` - Content parsing and URI decoding
- `src/app/components/content/note-content/note-content.component.html` - Mention rendering
- `src/app/components/content/note-content/note-content.component.ts` - Mention click handling
- `src/app/services/mention-input.service.ts` - Mention extraction utilities

## NIP References

- [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) - bech32-encoded entities (npub, nprofile, etc.)
- [NIP-27](https://github.com/nostr-protocol/nips/blob/master/27.md) - Text Notes with Mentions
