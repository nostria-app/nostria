# Gift Premium Feature Implementation

## Overview

The Gift Premium feature allows users to gift Premium or Premium+ subscriptions to other Nostria users using Lightning Network Zaps. The gift is sent as a special zap with a custom JSON structure in the content field, enabling the receiver to be notified when they log in.

## Features

### 1. Gift Premium Dialog

A dedicated dialog component (`gift-premium-dialog`) that provides:

- **Subscription Type Selection**:
  - Premium: Enhanced features and ad-free experience
  - Premium+: All Premium features plus exclusive benefits

- **Duration Options**:
  - 1 month
  - 3 months

- **Pricing** (approximate, based on ~$1 = 3,000 sats):
  - Premium 1 month: 30,000 sats (~$10)
  - Premium 3 months: 90,000 sats (~$30)
  - Premium+ 1 month: 75,000 sats (~$25)
  - Premium+ 3 months: 225,000 sats (~$75)

- **Personal Message**: Optional 200-character message that will be displayed to the recipient

- **Wallet Selection**: Choose from available NWC (Nostr Wallet Connect) wallets

### 2. Gift Premium JSON Structure

The gift is transmitted as a Lightning zap with a JSON-serialized content field:

```json
{
  "receiver": "<pubkey_of_recipient>",
  "message": "Hope you enjoy my gift!",
  "subscription": "premium" | "premium-plus",
  "duration": 1 | 3
}
```

**Field Specifications**:
- `receiver`: Nostr public key (hex format) of the gift recipient
- `message`: Personal message (max 200 characters)
- `subscription`: Type of subscription - either "premium" or "premium-plus"
- `duration`: Number of months - either 1 or 3

### 3. User Interface Integration

Gift Premium buttons have been added to:

1. **Profile Hover Card**: 
   - Located in the actions section alongside Follow/Unfollow and View Profile buttons
   - Accessible when hovering over user avatars throughout the app

2. **Profile Header**: 
   - Added to the more options menu (three-dot menu)
   - Located near the Zap button for easy discovery

### 4. ZapService Extensions

New methods added to `zap.service.ts`:

- **`sendGiftPremiumZap()`**: Sends a gift premium zap with validated gift data
- **`parseGiftPremiumFromZap()`**: Extracts gift premium data from a zap receipt
- **`isGiftPremiumZap()`**: Checks if a zap receipt is a gift premium zap
- **`getGiftPremiumZapsForUser()`**: Retrieves all gift premium zaps received by a user

### 5. Notification System

A new `GiftPremiumNotificationService` handles:

- **Automatic Detection**: Checks for new gift zaps when users log in
- **Notification Display**: Shows snackbar notifications for received gifts
- **Seen Status Tracking**: Tracks which gifts have been viewed using localStorage
- **Unread Counter**: Maintains count of unread gift notifications

**Service Methods**:
- `checkForGiftPremiumZaps()`: Scans for new gift zaps
- `markAsSeen()`: Marks a specific gift as seen
- `markAllAsSeen()`: Marks all gifts as seen
- `clearNotifications()`: Clears all notifications (e.g., on logout)

## Technical Implementation Details

### Component Structure

```
src/app/components/gift-premium-dialog/
├── gift-premium-dialog.component.ts      # Component logic
├── gift-premium-dialog.component.html    # Template with two-state flow
└── gift-premium-dialog.component.scss    # Styles with dark mode support
```

### Service Extensions

```
src/app/services/
├── zap.service.ts                        # Extended with gift premium methods
└── gift-premium-notification.service.ts  # New notification handler
```

### Dialog Flow

1. **Input State**:
   - User selects subscription type (Premium/Premium+)
   - User selects duration (1 or 3 months)
   - User optionally enters personal message
   - Total amount is calculated and displayed
   - User clicks "Continue"

2. **Confirmation State**:
   - Review recipient details
   - Review gift details (subscription, duration, message)
   - Review payment amount
   - User clicks "Send Gift"
   - Processing state with spinner
   - Success/error feedback

### Data Validation

The implementation includes robust validation:

- Recipient must have a Lightning address configured
- Gift data structure is validated before sending
- Message length is limited to 200 characters
- Receiver pubkey must match the gift recipient
- Amount validation based on LNURL pay limits

### Error Handling

Comprehensive error handling for:
- Missing Lightning address
- Wallet connection issues
- Payment failures
- Network errors
- Invalid gift data

## Usage Example

### Opening the Gift Dialog

From the profile hover card:
```typescript
openGiftPremiumDialog(): void {
  const dialogData: GiftPremiumDialogData = {
    recipientPubkey: this.pubkey(),
    recipientName: displayName,
    recipientMetadata: profile.data,
  };

  this.dialog.open(GiftPremiumDialogComponent, {
    data: dialogData,
    width: '500px',
    maxWidth: '95vw',
  });
}
```

### Checking for Gift Notifications

From app initialization:
```typescript
async ngOnInit() {
  const giftNotificationService = inject(GiftPremiumNotificationService);
  await giftNotificationService.checkForGiftPremiumZaps();
}
```

## Nostr Protocol Compliance

The implementation uses standard Nostr zap protocols:

- Zap requests are kind 9734 events
- Zap receipts are kind 9735 events
- Gift data is embedded in the zap request content field
- LNURL-pay protocol is used for Lightning invoices
- Standard NWC (Nostr Wallet Connect) for payments

## Future Enhancements

Potential improvements for future versions:

1. **Gift History**: View sent and received gifts
2. **Gift Animations**: Visual effects when gift is received
3. **Auto-activation**: Automatically activate subscription on gift receipt
4. **Gift Bundles**: Special pricing for bulk gift purchases
5. **Gift Scheduling**: Schedule gifts for future delivery
6. **Gift Cards**: Generate redeemable gift codes
7. **Analytics**: Track gift conversion and popularity

## Testing Checklist

- [ ] Gift dialog opens correctly from hover card
- [ ] Gift dialog opens correctly from profile header
- [ ] Subscription type selection works
- [ ] Duration selection works and updates price
- [ ] Message field accepts input up to 200 characters
- [ ] Total amount calculates correctly
- [ ] Wallet selection functions properly
- [ ] Confirmation screen displays all details
- [ ] Back button returns to input screen
- [ ] Zap is sent successfully with correct amount
- [ ] Gift JSON structure is properly formatted
- [ ] Recipient receives notification
- [ ] Notification shows correct gift details
- [ ] Seen status is tracked correctly
- [ ] Error messages display appropriately
- [ ] Mobile responsive layout works
- [ ] Dark mode styling is correct

## Files Modified/Created

### New Files
- `src/app/components/gift-premium-dialog/gift-premium-dialog.component.ts`
- `src/app/components/gift-premium-dialog/gift-premium-dialog.component.html`
- `src/app/components/gift-premium-dialog/gift-premium-dialog.component.scss`
- `src/app/services/gift-premium-notification.service.ts`

### Modified Files
- `src/app/services/zap.service.ts` - Added gift premium methods and interface
- `src/app/components/user-profile/hover-card/profile-hover-card.component.ts` - Added gift button
- `src/app/components/user-profile/hover-card/profile-hover-card.component.html` - Added gift button
- `src/app/pages/profile/profile-header/profile-header.component.ts` - Added gift method
- `src/app/pages/profile/profile-header/profile-header.component.html` - Added gift menu item

## Dependencies

The feature relies on:
- Angular Material components (Dialog, Button, Card, etc.)
- nostr-tools library for Nostr protocol functions
- Existing ZapService for Lightning payments
- Existing Wallets service for NWC connections
- localStorage for seen status tracking

## Security Considerations

- Lightning invoices are validated before payment
- Amount limits from LNURL are enforced
- Recipient Lightning address is verified
- Gift data structure is validated before sending
- XSS protection through Angular's built-in sanitization
- No sensitive data stored in gift messages
