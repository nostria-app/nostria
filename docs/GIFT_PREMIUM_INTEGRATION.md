# Gift Premium Integration Guide

## Quick Start

### 1. Opening the Gift Premium Dialog

The gift dialog can be opened from anywhere in the application by injecting `MatDialog` and opening `GiftPremiumDialogComponent`:

```typescript
import { inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  GiftPremiumDialogComponent,
  GiftPremiumDialogData,
} from './components/gift-premium-dialog/gift-premium-dialog.component';

// In your component
private dialog = inject(MatDialog);

openGiftDialog(recipientPubkey: string, recipientMetadata: Record<string, unknown>) {
  const dialogData: GiftPremiumDialogData = {
    recipientPubkey: recipientPubkey,
    recipientName: 'User Name', // Optional
    recipientMetadata: recipientMetadata,
  };

  this.dialog.open(GiftPremiumDialogComponent, {
    data: dialogData,
    width: '500px',
    maxWidth: '95vw',
    disableClose: false,
  });
}
```

### 2. Checking for Gift Notifications

To check for gift notifications when a user logs in:

```typescript
import { inject, OnInit } from '@angular/core';
import { GiftPremiumNotificationService } from './services/gift-premium-notification.service';

export class AppComponent implements OnInit {
  private giftNotificationService = inject(GiftPremiumNotificationService);

  async ngOnInit() {
    // Check for new gift premium zaps
    await this.giftNotificationService.checkForGiftPremiumZaps();
    
    // Access notifications
    const notifications = this.giftNotificationService.giftNotifications();
    const unreadCount = this.giftNotificationService.unreadCount();
  }
}
```

### 3. Displaying Gift Notifications

Subscribe to the notification signals to display in your UI:

```typescript
import { Component, inject, computed } from '@angular/core';
import { GiftPremiumNotificationService } from './services/gift-premium-notification.service';

@Component({
  selector: 'app-notification-badge',
  template: `
    @if (unreadCount() > 0) {
      <span class="badge">{{ unreadCount() }}</span>
    }
  `
})
export class NotificationBadgeComponent {
  private giftService = inject(GiftPremiumNotificationService);
  
  unreadCount = this.giftService.unreadCount;
}
```

### 4. Working with the ZapService

Use the extended ZapService methods to work with gift premium zaps:

```typescript
import { inject } from '@angular/core';
import { ZapService, GiftPremiumData } from './services/zap.service';

export class MyComponent {
  private zapService = inject(ZapService);

  async sendGift() {
    const giftData: GiftPremiumData = {
      receiver: 'recipient_pubkey_hex',
      message: 'Enjoy your premium subscription!',
      subscription: 'premium',
      duration: 1,
    };

    await this.zapService.sendGiftPremiumZap(
      'recipient_pubkey_hex',
      30000, // amount in sats
      giftData,
      recipientMetadata
    );
  }

  async checkForGifts() {
    const gifts = await this.zapService.getGiftPremiumZapsForUser('user_pubkey_hex');
    
    gifts.forEach(gift => {
      console.log('Gift:', gift.giftData);
      console.log('Amount:', gift.amount);
      console.log('Timestamp:', gift.zapReceipt.created_at);
    });
  }

  isGiftZap(zapReceipt: Event) {
    return this.zapService.isGiftPremiumZap(zapReceipt);
  }

  parseGift(zapReceipt: Event) {
    return this.zapService.parseGiftPremiumFromZap(zapReceipt);
  }
}
```

## Gift Data Structure

The gift information is stored in the zap content as JSON:

```typescript
interface GiftPremiumData {
  receiver: string;           // Recipient's pubkey (hex)
  message: string;            // Personal message (max 200 chars)
  subscription: 'premium' | 'premium-plus';
  duration: 1 | 3;           // Number of months
}
```

## Pricing Reference

Current pricing (approximate, based on $1 = 3,000 sats):

| Subscription | Duration | Sats | USD |
|--------------|----------|------|-----|
| Premium | 1 month | 30,000 | ~$10 |
| Premium | 3 months | 90,000 | ~$30 |
| Premium+ | 1 month | 75,000 | ~$25 |
| Premium+ | 3 months | 225,000 | ~$75 |

## Validation Requirements

Before sending a gift, ensure:

1. **Recipient has Lightning address**: Check `recipientMetadata` for `lud16` or `lud06`
2. **Message length**: Maximum 200 characters
3. **Valid subscription type**: Either 'premium' or 'premium-plus'
4. **Valid duration**: Either 1 or 3 months
5. **Wallet connected**: User must have an active NWC wallet

## Error Handling

Common errors and how to handle them:

```typescript
try {
  await zapService.sendGiftPremiumZap(...);
} catch (error) {
  if (error.message.includes('no Lightning address')) {
    // Show error: recipient can't receive gifts
  } else if (error.message.includes('wallet')) {
    // Show error: wallet connection issue
  } else if (error.message.includes('message exceeds')) {
    // Show error: message too long
  } else {
    // Show generic error
  }
}
```

## Best Practices

1. **Always validate recipient data** before opening the gift dialog
2. **Cache recipient metadata** to avoid duplicate network calls
3. **Handle wallet errors gracefully** with user-friendly messages
4. **Show loading states** during zap sending
5. **Provide clear confirmation** after successful gift
6. **Mark notifications as seen** after user views them
7. **Clear notifications on logout** to prevent data leakage

## Example: Complete Gift Flow

```typescript
import { Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  GiftPremiumDialogComponent,
  GiftPremiumDialogData,
} from './components/gift-premium-dialog/gift-premium-dialog.component';
import { DataService } from './services/data.service';

@Component({
  selector: 'app-user-actions',
  template: `
    <button (click)="giftPremium(userPubkey)">
      🎁 Gift Premium
    </button>
  `
})
export class UserActionsComponent {
  private dialog = inject(MatDialog);
  private dataService = inject(DataService);
  private snackBar = inject(MatSnackBar);

  async giftPremium(pubkey: string) {
    // Load user profile
    const profile = await this.dataService.getProfile(pubkey);
    
    if (!profile || !profile.data) {
      this.snackBar.open('Unable to load user profile', 'Dismiss', {
        duration: 3000,
      });
      return;
    }

    // Check for Lightning address
    if (!profile.data.lud16 && !profile.data.lud06) {
      this.snackBar.open(
        'This user cannot receive gifts (no Lightning address)',
        'Dismiss',
        { duration: 4000 }
      );
      return;
    }

    // Open gift dialog
    const dialogData: GiftPremiumDialogData = {
      recipientPubkey: pubkey,
      recipientName: profile.data.display_name || profile.data.name,
      recipientMetadata: profile.data,
    };

    const dialogRef = this.dialog.open(GiftPremiumDialogComponent, {
      data: dialogData,
      width: '500px',
      maxWidth: '95vw',
    });

    // Handle dialog result
    dialogRef.afterClosed().subscribe(result => {
      if (result?.success) {
        this.snackBar.open('Gift sent successfully! 🎉', 'Dismiss', {
          duration: 5000,
        });
      }
    });
  }
}
```

## Integration Checklist

When integrating the gift premium feature:

- [ ] Import `GiftPremiumDialogComponent` in your module/component
- [ ] Inject `MatDialog` for opening the dialog
- [ ] Fetch recipient metadata before opening dialog
- [ ] Validate Lightning address exists
- [ ] Handle dialog result (success/cancel)
- [ ] Set up gift notification checking on app init
- [ ] Subscribe to notification signals for UI updates
- [ ] Implement notification badge/indicator
- [ ] Test with different wallet providers
- [ ] Test error scenarios
- [ ] Verify mobile responsiveness
- [ ] Check dark mode appearance

## Support and Troubleshooting

Common issues:

**Dialog doesn't open:**
- Ensure `GiftPremiumDialogComponent` is properly imported
- Check that recipient metadata is provided
- Verify MatDialog is injected correctly

**Zap fails to send:**
- Check wallet connection status
- Verify recipient has valid Lightning address
- Ensure sufficient wallet balance
- Check network connectivity

**Notifications not appearing:**
- Verify `checkForGiftPremiumZaps()` is called on init
- Check localStorage for stored seen gift IDs
- Ensure user pubkey is available
- Check browser console for errors

**Amount calculation wrong:**
- Verify PRICING constant in component
- Check duration and subscription type values
- Ensure sats conversion is correct
