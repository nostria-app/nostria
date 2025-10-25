# PIN Prompt for Signing Operations

## Overview

When a user has set a custom PIN (other than the default "0000") to encrypt their private key, the application now automatically prompts them to enter their PIN when signing events. This ensures users can securely publish notes, reactions, and other Nostr events even with PIN-protected keys.

## Implementation

### PinPromptService

Created a centralized service (`PinPromptService`) that:

- **Manages PIN prompting** across the entire application
- **Caches PINs** for 5 minutes to avoid repeated prompts during active use
- **Provides security controls** to clear cached PINs on logout
- **Handles user cancellation** gracefully

Key methods:
- `promptForPin(useCache = true)`: Opens PIN dialog, returns PIN or null if cancelled
- `clearCache()`: Immediately clears cached PIN (called on logout)
- `hasCachedPin()`: Checks if valid cached PIN exists

### NostrService Updates

Added `getDecryptedPrivateKeyWithPrompt()` method that:

1. **Tries default PIN first** - Attempts decryption with "0000"
2. **Prompts on failure** - If default PIN fails, opens PIN prompt dialog
3. **Uses cached PIN** - Leverages PinPromptService's 5-minute cache
4. **Handles cancellation** - Returns null if user cancels

Updated `sign()` method:
- Now uses `getDecryptedPrivateKeyWithPrompt()` instead of `getDecryptedPrivateKey()`
- Throws clear error if user cancels PIN prompt
- Works seamlessly with cached PINs for multiple signing operations

Updated `logout()` method:
- Clears cached PIN on logout for security

### CredentialsComponent Updates

Updated to use `PinPromptService` instead of directly managing dialogs:
- Simplified PIN prompting logic
- Consistent behavior across the app
- Removed duplicate dialog handling code

## User Experience Flow

### Signing an Event (e.g., Publishing a Note)

1. User writes a note and clicks "Publish"
2. Application attempts to sign with default PIN ("0000")
3. If decryption fails (user has custom PIN):
   - PIN prompt dialog appears
   - User enters their custom PIN
   - On success: Event is signed and published
   - On failure: Error shown, user can retry
4. PIN is cached for 5 minutes
5. Subsequent signing operations within 5 minutes use cached PIN (no re-prompt)

### Viewing Credentials

1. User navigates to Credentials page
2. Same PIN prompting flow as signing
3. Once unlocked, private key (nsec) is displayed
4. Copy and download operations work seamlessly

## Security Features

- **5-minute PIN cache**: Balances convenience and security
- **Automatic cache clearing**: PIN cleared on logout
- **No PIN persistence**: PIN never stored in localStorage or permanent storage
- **Failed attempt handling**: Clear error messages without exposing details
- **Cancellation support**: Users can cancel without breaking the app

## Benefits

✅ Users with custom PINs can now sign events seamlessly
✅ No more silent decryption failures
✅ Reduced PIN prompts with smart caching
✅ Consistent UX across all signing and credential operations
✅ Enhanced security with automatic cache clearing

## Related Files

- `src/app/services/pin-prompt.service.ts` - Centralized PIN prompting service (NEW)
- `src/app/services/nostr.service.ts` - Updated sign() method and added getDecryptedPrivateKeyWithPrompt()
- `src/app/pages/credentials/credentials.component.ts` - Updated to use PinPromptService
- `src/app/components/pin-prompt-dialog/pin-prompt-dialog.component.ts` - Reusable PIN dialog
