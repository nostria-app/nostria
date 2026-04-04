import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';

export interface DeadRelaysWarningSheetData {
  relayUrls: string[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-dead-relays-warning-sheet',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './dead-relays-warning-sheet.component.html',
  styleUrl: './dead-relays-warning-sheet.component.scss',
})
export class DeadRelaysWarningSheetComponent {
  private readonly bottomSheetRef = inject(MatBottomSheetRef<DeadRelaysWarningSheetComponent>);
  private readonly router = inject(Router);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly accountState = inject(AccountStateService);
  readonly data = inject<DeadRelaysWarningSheetData>(MAT_BOTTOM_SHEET_DATA);

  dismiss(): void {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setDismissedDeadRelaysWarningDialog(pubkey, true);
    }

    this.bottomSheetRef.dismiss();
  }

  openAccountRelays(): void {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setDismissedDeadRelaysWarningDialog(pubkey, true);
    }

    this.bottomSheetRef.dismiss();
    this.router.navigate(['/relays']);
  }

  formatRelayUrl(url: string): string {
    return url.replace(/^wss:\/\//, '');
  }
}
