# Example Nostr Event JSON for Publishing

When using the "Publish Event" feature, you need to paste a complete, signed Nostr event in JSON format.

## Example Event Structure

```json
{
  "id": "4376c65d2f232afbe9b882a35baa4f6fe8667c4e684749af565f981833ed6a65",
  "pubkey": "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93",
  "created_at": 1673347337,
  "kind": 1,
  "tags": [],
  "content": "Hello Nostr!",
  "sig": "908a15e46fb4d8675bab026fc230a0e3542bfade63da02d542fb78b2a8513fcd0092619a2c8c1221e581946e0191f2af505dfdf8657a414dbca329186f009262"
}
```

## Required Fields

All fields are **required** and must be present:

### `id` (string)
- 64-character hex string
- SHA256 hash of the serialized event
- Must be calculated according to NIP-01

### `pubkey` (string)
- 64-character hex string
- Public key of the event creator (in hex format, not npub)

### `created_at` (number)
- Unix timestamp in **seconds** (not milliseconds)
- Example: `1673347337`

### `kind` (number)
- Event type according to Nostr NIPs
- Common kinds:
  - `0`: Set metadata
  - `1`: Text note
  - `3`: Contact list
  - `4`: Encrypted direct message
  - `5`: Event deletion
  - `7`: Reaction
  - `30023`: Long-form content (article)

### `tags` (array)
- Array of arrays of strings
- Can be empty: `[]`
- Examples:
  ```json
  [
    ["e", "event-id-being-replied-to"],
    ["p", "pubkey-being-mentioned"],
    ["t", "hashtag"]
  ]
  ```

### `content` (string)
- The actual content of the event
- Can be empty string: `""`
- For text notes (kind 1), this is the message
- For metadata (kind 0), this is a JSON string

### `sig` (string)
- 128-character hex string
- Schnorr signature of the event id
- Created using the event creator's private key

## Important Notes

1. **The event must already be signed** - you cannot sign events in this dialog
2. All string values must be properly escaped JSON strings
3. Timestamps are in **seconds**, not milliseconds
4. Public keys must be in hex format (not npub/nsec format)
5. The event must pass validation before it can be published

## Where to Get Signed Events

You can obtain signed events from:
- Nostr debugging tools
- Your own signing implementation
- Exported events from other Nostr clients
- Event inspector tools

## Example: Kind 1 Text Note with Tags

```json
{
  "id": "a6b0123...",
  "pubkey": "6e46842...",
  "created_at": 1704067200,
  "kind": 1,
  "tags": [
    ["e", "reply-to-event-id", "wss://relay.example.com"],
    ["p", "mentioned-pubkey"],
    ["t", "nostr"]
  ],
  "content": "This is a reply mentioning someone with a #nostr hashtag",
  "sig": "908a15e..."
}
```

## Validation

The dialog will validate:
- ✅ Valid JSON format
- ✅ All required fields are present
- ✅ Field types are correct
- ✅ Arrays are properly formatted

The dialog will NOT validate:
- ❌ Event ID matches the hash
- ❌ Signature is valid
- ❌ Event conforms to specific NIP requirements

If the relay rejects the event, it will show an error in the publish results.
