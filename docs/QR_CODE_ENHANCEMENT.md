# QR Code Scan Dialog Enhancement

## Overview

Enhanced the QR code scan dialog to properly support different ways that public keys and Nostr entities are encoded across different Nostr clients.

## Supported Formats

The QR code scanner now handles the following formats:

### 1. Standard Nostr URI Format
- `nostr:npub1...` - Profile with nostr: prefix
- `nostr:nprofile1...` - Profile with relays with nostr: prefix
- `nostr:note1...` - Note/event with nostr: prefix
- `nostr:nevent1...` - Event with relays with nostr: prefix
- `nostr:naddr1...` - Address (article) with nostr: prefix

### 2. Direct Nostr Entity Format
- `npub1...` - Direct profile public key
- `nprofile1...` - Direct profile with relays
- `note1...` - Direct note/event
- `nevent1...` - Direct event with relays
- `naddr1...` - Direct address (article)

### 3. Raw Hex Format
- `64-character hex pubkey` - Automatically converted to npub format

### 4. Special Protocols
- `bunker://...` - Nostr Connect protocol
- `nostr+walletconnect://...` - Wallet connection strings
- `nostr+...` - Other nostr protocol extensions

### 5. Private Key Warning
- `nsec1...` - Shows warning about private key exposure

## Implementation Details

### QR Code Processing Pipeline

1. **Raw Result Processing**: The scanned result is cleaned and normalized
2. **Format Detection**: Identifies the type of Nostr entity or protocol
3. **Validation**: Uses nostr-tools to validate entity formats
4. **Normalization**: Converts to standard format (e.g., hex pubkey → npub)
5. **Return**: Returns the processed result to the consuming code

### Enhanced Methods

#### `QrcodeScanDialogComponent`
- `processScannedResult()`: Main processing method that handles all formats
- `isNostrEntity()`: Detects if a string is a Nostr entity
- `normalizeNostrEntity()`: Validates and normalizes Nostr entities

#### `App` Component
- `isNostrEntity()`: Helper to identify Nostr entities
- `handleNostrEntityFromQR()`: Routes different entity types to appropriate handlers

## User Experience Improvements

### Automatic Navigation
- **Profiles** (`npub`, `nprofile`): Automatically navigate to profile page
- **Events** (`note`, `nevent`): Open event in appropriate view
- **Articles** (`naddr`): Open article page
- **Private Keys** (`nsec`): Show security warning

### User Feedback
- Success messages when opening profiles/events/articles
- Warning messages for private keys
- Error handling for invalid formats
- Specific feedback for each entity type

### Error Handling
- Graceful fallback for malformed entities
- Validation using nostr-tools library
- Comprehensive logging for debugging
- User-friendly error messages

## Backward Compatibility

The enhancement maintains full backward compatibility:
- Existing QR codes continue to work
- Special protocols (bunker://, nostr+walletconnect://) unchanged
- Raw results passed through if no special processing needed

## Testing Scenarios

### Profile QR Codes
- ✅ `nostr:npub1...` → Navigate to profile
- ✅ `npub1...` → Navigate to profile  
- ✅ `nostr:nprofile1...` → Navigate to profile
- ✅ `nprofile1...` → Navigate to profile
- ✅ Raw hex pubkey → Convert to npub and navigate

### Event QR Codes
- ✅ `nostr:note1...` → Open event
- ✅ `note1...` → Open event
- ✅ `nostr:nevent1...` → Open event
- ✅ `nevent1...` → Open event

### Article QR Codes
- ✅ `nostr:naddr1...` → Open article
- ✅ `naddr1...` → Open article

### Special Protocols
- ✅ `bunker://...` → Nostr Connect login
- ✅ `nostr+walletconnect://...` → Add wallet

### Security
- ✅ `nsec1...` → Show warning (don't process)

## Technical Notes

### Dependencies
- `nostr-tools`: For entity validation and decoding
- `UtilitiesService`: For pubkey validation and conversion
- `LoggerService`: For debugging and error tracking

### Error Recovery
- Invalid entities are logged but passed through as-is
- Validation errors don't break the scanning flow
- Fallback to original behavior for unknown formats

### Performance
- Minimal overhead for processing
- Validation only occurs for detected Nostr entities
- Efficient format detection using string prefix checks

## Benefits

1. **Universal Compatibility**: Works with QR codes from any Nostr client
2. **Enhanced User Experience**: Automatic navigation and clear feedback
3. **Security**: Warns users about private key exposure
4. **Robust Error Handling**: Graceful fallback for edge cases
5. **Future-Proof**: Easy to extend for new Nostr entity types