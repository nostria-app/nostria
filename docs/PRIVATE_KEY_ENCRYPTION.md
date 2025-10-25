# Private Key Encryption Implementation

## Overview
Implemented PIN-based encryption for private keys (nsec) using Web Crypto API. Private keys are now encrypted at-rest in localStorage, providing protection against unauthorized access while maintaining backwards compatibility with existing unencrypted keys.

## Implementation Details

### 1. CryptoEncryptionService
**File:** `src/app/services/crypto-encryption.service.ts`

New service that handles encryption/decryption of private keys using:
- **PBKDF2** for key derivation from PIN (100,000 iterations)
- **AES-GCM** (256-bit) for encryption
- **Default PIN:** "0000" for initial encryption
- **Custom PINs:** Users can set their own PIN (minimum 4 characters)

Key features:
- `encryptPrivateKey()` - Encrypts a private key with a PIN
- `decryptPrivateKey()` - Decrypts an encrypted private key
- `reencryptPrivateKey()` - Changes the PIN for an encrypted key
- `verifyPin()` - Checks if a PIN is correct
- `isEncrypted()` - Checks if data is encrypted

### 2. NostrUser Interface Updates
**File:** `src/app/services/nostr.service.ts`

Added new fields to track encryption status:
```typescript
export interface NostrUser {
  // ... existing fields
  
  /** 
   * Private key storage - can be either:
   * - Plain hex string (legacy, backwards compatible)
   * - JSON string of EncryptedData (encrypted with PIN)
   */
  privkey?: string;
  
  /** 
   * Indicates if the private key is encrypted with a PIN
   * If true, privkey contains JSON-stringified EncryptedData
   * If false or undefined, privkey is plain hex (backwards compatible)
   */
  isEncrypted?: boolean;
}
```

### 3. NostrService Updates
**File:** `src/app/services/nostr.service.ts`

#### New Helper Methods:
- `getDecryptedPrivateKey()` - Gets the decrypted private key from a NostrUser, handling both encrypted and plaintext keys
- `migrateAccountToEncrypted()` - Migrates plaintext private keys to encrypted format

#### Updated Methods:
- `initialize()` - Now automatically migrates existing plaintext private keys to encrypted format on first load
- `generateNewKey()` - Creates new accounts with encrypted private keys
- `loginWithNsec()` - Encrypts imported private keys with default PIN
- `sign()` - Updated nsec and remote cases to decrypt private keys before signing

#### Backwards Compatibility:
All existing accounts with plaintext private keys are automatically migrated to encrypted format using the default PIN ("0000") on first application load. This happens transparently without user intervention.

### 4. Credentials Component Updates
**File:** `src/app/pages/credentials/credentials.component.ts`

Added PIN management functionality:
- Display encryption status for accounts with encrypted keys
- UI to change PIN from default "0000" to custom PIN
- Form validation (minimum 4 characters, confirmation matching)
- Secure handling of decrypted keys for display/download

New methods:
- `hasEncryptedKey()` - Checks if account has encrypted key
- `isUsingDefaultPin()` - Checks if account uses default PIN
- `startChangingPin()` / `cancelChangingPin()` - PIN change UI control
- `changePin()` - Re-encrypts private key with new PIN

Updated methods to handle encrypted keys:
- `getNsec()` - Now decrypts key before displaying
- `downloadCredentials()` - Decrypts key before exporting
- `copyToClipboard()` - Ensures key is decrypted before copying

### 5. UI Enhancements
**File:** `src/app/pages/credentials/credentials.component.html`

Added new "PIN Protection" card that appears for accounts with encrypted keys:
- Information about encryption status
- Warning about default PIN
- Button to initiate PIN change
- Form with old PIN, new PIN, and confirmation fields

**File:** `src/app/pages/credentials/credentials.component.scss`

Added styling for PIN management UI with proper visual hierarchy and warnings.

## Security Considerations

### At-Rest Protection
- Private keys are encrypted in localStorage using AES-GCM
- Each encrypted key has unique salt and IV
- Keys are only decrypted in memory when needed for signing

### Default PIN
- Default PIN is "0000" - provides basic protection against casual access
- Users are strongly encouraged to change to custom PIN
- UI prominently displays warning about default PIN

### Limitations
- Default PIN can be decrypted by anyone who knows it
- This is **at-rest protection** only - not full security solution
- Keys are decrypted in memory during signing operations
- Browser extensions (like Alby) provide stronger security model

### Recommended for Users
1. Change from default PIN "0000" to custom PIN immediately
2. Use strong, memorable PIN (at least 4 characters, longer is better)
3. Consider using browser extension for even better security
4. Keep backups of keys in secure location

## Alternative Approach: Device-Bound Keys

### Concept
Instead of a user-provided PIN, we could use Web Crypto API's `non-extractable` keys tied to the device:

```typescript
// Generate a device-bound encryption key
const encryptionKey = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  false, // non-extractable
  ['encrypt', 'decrypt']
);

// Store key handle in IndexedDB (can't be exported)
// Encrypt private key with this device-bound key
```

**Advantages:**
- No PIN to remember
- Key cannot be extracted from device
- Stronger protection than default PIN

**Disadvantages:**
- Keys tied to specific device/browser
- Cannot move to another device without re-importing nsec
- More complex backup/recovery process
- May not work across browser profiles

**Conclusion:** User-provided PIN approach was chosen for better portability and user control, despite weaker security when using default PIN.

## Testing Recommendations

1. **Migration Testing:**
   - Test with existing account with plaintext key
   - Verify automatic migration to encrypted format
   - Confirm account still works after migration

2. **New Account Testing:**
   - Create new account
   - Verify private key is encrypted by default
   - Test signing operations work correctly

3. **PIN Change Testing:**
   - Change from default "0000" to custom PIN
   - Verify signing still works
   - Test wrong PIN rejection
   - Confirm UI validation

4. **Import Testing:**
   - Import existing nsec via login
   - Verify encryption with default PIN
   - Test subsequent signing

5. **Cross-Browser Testing:**
   - Verify encryption works in Chrome, Firefox, Safari
   - Test Web Crypto API compatibility
   - Confirm localStorage persistence

## Future Enhancements

1. **Biometric Authentication:** Use WebAuthn for PIN-less encryption
2. **Key Strength Indicator:** Show PIN strength meter
3. **Auto-Lock:** Re-encrypt after inactivity period
4. **Multiple Devices:** Sync encrypted keys across devices
5. **Hardware Security:** Integrate with hardware security modules

## Migration Path

Existing users will experience:
1. Automatic migration on next app load
2. Private keys encrypted with default PIN "0000"
3. Prompt in UI to change PIN (recommended)
4. No interruption to existing functionality

## Files Modified

- `src/app/services/crypto-encryption.service.ts` (new)
- `src/app/services/nostr.service.ts`
- `src/app/pages/credentials/credentials.component.ts`
- `src/app/pages/credentials/credentials.component.html`
- `src/app/pages/credentials/credentials.component.scss`

## Backwards Compatibility

✅ Fully backwards compatible
- Existing plaintext keys automatically migrated
- No breaking changes to existing accounts
- Transparent to users on first load
- All existing functionality preserved
