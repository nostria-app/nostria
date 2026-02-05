import { Component, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';

@Component({
  selector: 'app-credentials-backup-prompt',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './credentials-backup-prompt.component.html',
  styleUrl: './credentials-backup-prompt.component.scss',
})
export class CredentialsBackupPromptComponent {
  private bottomSheetRef = inject(MatBottomSheetRef<CredentialsBackupPromptComponent>);
  private router = inject(Router);
  private accountLocalState = inject(AccountLocalStateService);
  private accountState = inject(AccountStateService);

  backupNow(): void {
    // Mark as dismissed
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setDismissedCredentialsBackupDialog(pubkey, true);
    }

    this.bottomSheetRef.dismiss();
    this.router.navigate(['/accounts'], { queryParams: { tab: 'credentials' } });
  }

  dismiss(): void {
    // Mark as dismissed
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setDismissedCredentialsBackupDialog(pubkey, true);
    }

    this.bottomSheetRef.dismiss();
  }
}
