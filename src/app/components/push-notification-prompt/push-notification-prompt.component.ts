import { Component, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';

@Component({
  selector: 'app-push-notification-prompt',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './push-notification-prompt.component.html',
  styleUrl: './push-notification-prompt.component.scss',
})
export class PushNotificationPromptComponent {
  private bottomSheetRef = inject(MatBottomSheetRef<PushNotificationPromptComponent>);
  private router = inject(Router);
  private accountLocalState = inject(AccountLocalStateService);
  private accountState = inject(AccountStateService);

  enableNotifications(): void {
    // Mark as dismissed
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setDismissedPushNotificationDialog(pubkey, true);
    }

    this.bottomSheetRef.dismiss();
    this.router.navigate(['/notifications/settings']);
  }

  dismiss(): void {
    // Mark as dismissed
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setDismissedPushNotificationDialog(pubkey, true);
    }

    this.bottomSheetRef.dismiss();
  }
}
