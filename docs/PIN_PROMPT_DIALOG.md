# PIN Prompt Dialog

## Overview

When a user has changed their PIN from the default "0000", the application now automatically prompts them to enter their PIN when accessing encrypted private key data.

## Implementation

### PIN Prompt Dialog Component

Created a new standalone dialog component (`PinPromptDialogComponent`) that:

- Displays a secure PIN input field with visibility toggle
- Validates PIN requirements (minimum 4 characters)
- Provides clear error messaging
- Prevents accidental dismissal with `disableClose: true`
- Returns the entered PIN or `null` if cancelled

### Credentials Component Updates

The `CredentialsComponent` now includes:

1. **`getDecryptedNsecWithPrompt()`**: A helper method that attempts to decrypt the private key with the default PIN first, and if that fails, prompts the user for their custom PIN.

2. **`promptForPinAndDecrypt()`**: Opens the PIN prompt dialog and attempts decryption with the user-provided PIN. Displays success/error messages via snackbar.

3. **Automatic PIN Prompting**: When loading the nsec value for display, copying, or downloading, the application will automatically prompt for the PIN if the default PIN fails.

## User Experience Flow

1. User navigates to Credentials page
2. Application attempts to load private key with default PIN ("0000")
3. If decryption fails (user has custom PIN):
   - PIN prompt dialog appears
   - User enters their custom PIN
   - On success: Private key is loaded and cached
   - On failure: Error message shown, can retry

4. Once unlocked, the cached nsec value is used for:
   - Display in the credentials card
   - Copy to clipboard functionality
   - Download credentials as JSON

## Security Considerations

- PIN prompt dialog uses `disableClose: true` to prevent accidental closure
- PIN input supports password masking with visibility toggle
- Failed decryption attempts show clear error messages without exposing details
- Each operation (view, copy, download) can trigger PIN prompt independently
- No PIN is stored in memory longer than necessary

## Related Files

- `src/app/components/pin-prompt-dialog/pin-prompt-dialog.component.ts` - PIN prompt dialog
- `src/app/pages/credentials/credentials.component.ts` - PIN prompting integration
- `src/app/services/crypto-encryption.service.ts` - Encryption/decryption service
- `src/app/services/nostr.service.ts` - Private key decryption methods
