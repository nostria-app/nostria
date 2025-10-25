# Coinos Wallet Integration - One-Click Setup

## Overview

Implemented automatic one-click Coinos custodial wallet setup for Nostria, allowing users to quickly get started with lightning payments without manual configuration.

## Implementation Details

### 1. Coinos Service (`src/app/services/coinos.service.ts`)

Created a new service that implements deterministic Coinos wallet account creation based on the user's Nostr private key. This follows the same approach as the [Damus iOS implementation](https://github.com/damus-io/damus/blob/02296d77524020b44b751ec1426af4d155d55334/damus/Features/Wallet/Models/CoinosDeterministicAccountClient.swift).

**Key Features:**
- **Deterministic Account Derivation**: Username, password, and NWC keypair are derived from the user's private key using SHA256 hashing
- **Automatic Account Management**: Handles registration and login to Coinos API
- **NWC Connection Creation**: Creates and manages Nostr Wallet Connect connections
- **Security**: Uses irreversible SHA256 derivation so the user's nsec cannot be derived from the Coinos credentials

**Methods:**
- `setupDeterministicWallet(userPrivkey)` - Main entry point for one-click setup
- `loginOrRegister(userPrivkey)` - Handles authentication
- `createNWCConnection(userPrivkey)` - Creates the wallet connection
- `getExpectedLud16(userPrivkey)` - Returns the Lightning Address
- `updateNWCConnection(userPrivkey, maxAmount)` - Updates spending limits

**Default Settings:**
- Weekly spending limit: 50,000 sats
- Budget renewal: Weekly
- Connection name: "Nostria"

### 2. UI Integration

#### Credentials Component Updates

**HTML** (`src/app/pages/credentials/credentials.component.html`):
- Added new "Quick Setup: Coinos Wallet" card in the Wallets tab
- Includes prominent custodial wallet warning with clear messaging
- Shows features and benefits of the quick setup
- Displays expected Lightning Address format
- Setup button disabled when requirements aren't met (needs nsec account)

**TypeScript** (`src/app/pages/credentials/credentials.component.ts`):
- `setupCoinosWallet()` - Handles the one-click setup flow
- `canSetupCoinos()` - Checks if user has required private key
- `getCoinosLightningAddress()` - Shows placeholder for Lightning Address
- `getDecryptedPrivkeyWithPrompt()` - Handles PIN authentication

**Styling** (`src/app/pages/credentials/credentials.component.scss`):
- Custom styling for the Coinos card with gradient background
- Warning box styling for custodial notice
- Feature list styling with code blocks
- Responsive design matching existing UI patterns

### 3. Wallets Service Enhancement

Updated the `Wallets` service (`src/app/services/wallets.ts`) to:
- Support optional metadata (data field) for wallet connections
- Fixed TypeScript typing issues (replaced `any` with proper types)
- Added `data` field to `Wallet` interface for storing provider info

## User Experience Flow

1. User navigates to **Credentials → Wallets** tab
2. Sees "Quick Setup: Coinos Wallet" card with prominent custodial warning
3. Clicks "Setup Coinos Wallet" button
4. If needed, enters PIN to decrypt private key
5. Service automatically:
   - Derives deterministic Coinos credentials
   - Registers/logs into Coinos
   - Creates NWC connection
   - Adds wallet to user's wallet list
6. User receives success message with Lightning Address
7. Wallet appears in "Connected Wallets" list

## Security Considerations

### Custodial Warning
Prominent warning messages inform users that:
- Coinos is a custodial wallet (they don't control the keys)
- Only suitable for small amounts
- Not recommended for storing larger amounts of Bitcoin
- Third party holds their funds

### Private Key Handling
- Private key is decrypted only when needed
- PIN authentication required for nsec accounts
- Deterministic derivation uses one-way SHA256 hashing
- Original nsec cannot be reverse-engineered from Coinos credentials

### Default Limits
- 50,000 sats weekly spending limit to minimize risk
- Users can manually adjust if needed via `updateNWCConnection()`

## Technical Implementation Notes

### Deterministic Key Derivation
Following the Damus implementation:
- **Username**: First 16 characters of SHA256("coinos_username:" + privkey)
- **Password**: SHA256("coinos_password:" + privkey)
- **NWC Keypair**: SHA256(privkey) used as new private key

This ensures:
1. Consistent account across devices
2. No need to store additional credentials
3. Cannot derive user's main nsec from Coinos credentials
4. Low collision risk (16 hex chars = 2^64 possibilities)

### API Integration
Coinos API endpoints used:
- `POST /api/register` - Account creation
- `POST /api/login` - Authentication
- `POST /api/app` - Create/update NWC connection
- `GET /api/app/{pubkey}` - Get NWC connection details

### Error Handling
- Clear error messages for different failure scenarios
- Graceful fallback if setup fails
- PIN re-prompt on authentication failure
- Network error handling with user-friendly messages

## Testing Recommendations

1. **Setup Flow**: Test one-click setup with fresh account
2. **PIN Authentication**: Verify PIN prompt works correctly
3. **Repeat Setup**: Ensure idempotency (running setup twice doesn't break)
4. **Wallet Display**: Confirm wallet appears in list with correct details
5. **Lightning Address**: Verify generated address format is correct
6. **Error Cases**: Test with wrong PIN, network failures, etc.

## Future Enhancements

Potential improvements:
1. Add ability to view/edit spending limits in UI
2. Display wallet balance from Coinos API
3. Transaction history integration
4. Support for other custodial providers
5. Migration path to self-custodial solutions

## References

- [Damus CoinosDeterministicAccountClient.swift](https://github.com/damus-io/damus/blob/02296d77524020b44b751ec1426af4d155d55334/damus/Features/Wallet/Models/CoinosDeterministicAccountClient.swift)
- [Coinos.io](https://coinos.io)
- [Nostr Wallet Connect (NIP-47)](https://github.com/nostr-protocol/nips/blob/master/47.md)
