# Secret Recovery Phrase (Mnemonic) Support

## Overview

Nostria now supports BIP39 secret recovery phrases (mnemonics) according to NIP-06. This provides users with a more user-friendly way to backup and restore their Nostr accounts using a 12-word phrase instead of a complex private key.

## Features

### For New Accounts
- **12-word recovery phrase**: All new accounts are created with a BIP39-compliant 12-word mnemonic
- **NIP-06 compliance**: Keys are derived using the standard Nostr derivation path: `m/44'/1237'/0'/0/0`
- **Encrypted storage**: Mnemonics are encrypted with the user's PIN (default: "0000")
- **Backward compatible**: Private key (nsec) is still available for export

### For Existing Accounts
- **No changes required**: Existing accounts without mnemonics continue to work normally
- **nsec-only accounts**: Accounts created before this update only have the private key, no mnemonic

### Login Options
Users can now login using any of the following:
1. **Private key (nsec)**: Traditional Nostr private key format
2. **Hex private key**: 64-character hexadecimal private key
3. **Secret recovery phrase**: 12-word BIP39 mnemonic phrase

The login system automatically detects which format is being used.

## User Interface

### Credentials Page
The Credentials page now displays:

1. **Public Key (npub)**: Your public identifier
2. **Private Key (nsec)**: Your private key (can be revealed with PIN)
3. **Secret Recovery Phrase** (if available): Your 12-word backup phrase (can be revealed with PIN)

### Revealing the Recovery Phrase
1. Navigate to Settings → Credentials
2. Find the "Secret Recovery Phrase" card
3. Click the eye icon to reveal the phrase
4. Enter your PIN if prompted
5. Write down the 12 words in order and store them securely

### Restoring from Recovery Phrase
1. Open the login dialog
2. Select "Private Key" option
3. Paste or type your 12-word recovery phrase
4. The system will automatically detect it's a mnemonic and derive your key

## Security

### Encryption
- Both the private key and mnemonic are encrypted with your PIN
- Default PIN is "0000" for new accounts
- Users can change their PIN in the Credentials page

### PIN Protection
- Revealing the recovery phrase requires PIN entry
- Exporting credentials requires PIN entry
- Changing the PIN re-encrypts both private key and mnemonic

### Best Practices
1. **Write down your recovery phrase**: Store it in a secure, offline location
2. **Never share your recovery phrase**: Anyone with your phrase can access your account
3. **Verify your backup**: After writing down the phrase, try restoring it on another device
4. **Change the default PIN**: Set a custom PIN for better security

## Technical Implementation

### Libraries Used
- `@scure/bip39@2.0.1`: Secure, audited BIP39 implementation
- `@scure/bip32@2.0.1`: Secure, audited BIP32 implementation for key derivation

### NIP-06 Compliance
The implementation follows NIP-06 specifications:
- BIP39 for mnemonic generation and seed derivation
- BIP32 for hierarchical deterministic key derivation
- Derivation path: `m/44'/1237'/0'/0/0` (where 1237 is the Nostr coin type from SLIP44)

### Test Vectors
The implementation has been verified against the official NIP-06 test vectors:

**Test Vector 1:**
- Mnemonic: `leader monkey parrot ring guide accident before fence cannon height naive bean`
- Private key: `7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a`
- nsec: `nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp`

**Test Vector 2:**
- Mnemonic: `what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade`
- Private key: `c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add`
- nsec: `nsec1c9wh8xy5eqdzln7n5t0ctgxjcrdug73gp5yj0x03gntn67h83twssdfhel`

## Migration

### Existing Accounts
Existing accounts (created before this update) are **not** automatically migrated to use mnemonics. They will continue to work with just their private key.

If you want to use a mnemonic with an existing account:
1. Backup your current nsec
2. Create a new account (which will have a mnemonic)
3. Optionally migrate your data to the new account

### Data Structure
New accounts store:
```typescript
{
  pubkey: string;              // Public key (hex)
  privkey: string;             // Encrypted private key (JSON string)
  mnemonic: string;            // Encrypted mnemonic (JSON string)
  isEncrypted: boolean;        // True if privkey is encrypted
  isMnemonicEncrypted: boolean; // True if mnemonic is encrypted
  source: 'nsec';              // Account source
  // ... other fields
}
```

## Developer Notes

### MnemonicService
The `MnemonicService` provides the following methods:

```typescript
// Generate a new 12-word mnemonic
generateMnemonic(): string

// Validate a mnemonic phrase
validateMnemonic(mnemonic: string): boolean

// Derive private key from mnemonic (NIP-06)
derivePrivateKeyFromMnemonic(mnemonic: string, accountIndex?: number): string

// Encrypt/decrypt mnemonic
encryptMnemonic(mnemonic: string, pin: string): Promise<EncryptedData>
decryptMnemonic(encryptedData: EncryptedData, pin: string): Promise<string>

// Detect if input is a mnemonic
isMnemonic(input: string): boolean

// Normalize mnemonic (trim, lowercase, normalize spaces)
normalizeMnemonic(mnemonic: string): string
```

### NostrService Updates
The `NostrService` has been updated to:
- Generate mnemonics for new accounts
- Store encrypted mnemonics alongside private keys
- Support login with mnemonics, nsec, or hex keys
- Maintain backward compatibility with existing accounts

## Future Enhancements

Potential future improvements:
1. Support for multiple accounts from a single mnemonic (account index > 0)
2. Passphrase support (BIP39 extension word)
3. Migration tool for existing accounts
4. Support for 24-word mnemonics for extra security
5. QR code export/import for mnemonics

## References

- [NIP-06: Basic key derivation from mnemonic seed phrase](https://github.com/nostr-protocol/nips/blob/master/06.md)
- [BIP39: Mnemonic code for generating deterministic keys](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
- [BIP32: Hierarchical Deterministic Wallets](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)
- [SLIP44: Registered coin types for BIP-0044](https://github.com/satoshilabs/slips/blob/master/slip-0044.md)
