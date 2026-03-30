import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { nip19 } from 'nostr-tools';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog.component';
import { ApplicationService } from '../../../services/application.service';
import { AccountStateService } from '../../../services/account-state.service';
import type { NostrUser } from '../../../services/nostr.service';

@Component({
  selector: 'app-setting-danger-zone',
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section danger-zone">
      <h2 i18n="@@settings.danger-zone.title">Danger Zone</h2>

      <div class="danger-action">
        <div>
          <h3 i18n="@@settings.danger-zone.wipe-data">Wipe All Data</h3>
          <p i18n="@@settings.danger-zone.wipe-data.description">This will delete all your local app data and reload the application.</p>
        </div>
        <button mat-flat-button class="wipe-data-button" (click)="wipeData()"
          i18n="@@settings.danger-zone.wipe-data.button">Wipe Data</button>
      </div>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }
    .danger-zone h2 {
      color: #f44336;
      margin-top: 0;
      margin-bottom: 8px;
    }
    h3 {
      margin: 0 0 8px 0;
    }
    .danger-action {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .danger-action > div {
      flex: 1;
    }
    .danger-action p {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }
    .wipe-data-button {
      background-color: #f44336;
      color: white;
    }
  `]
})
export class SettingDangerZoneComponent {
  private readonly dialog = inject(MatDialog);
  private readonly app = inject(ApplicationService);
  private readonly accountState = inject(AccountStateService);

  async wipeData(): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Confirm Data Deletion',
        message: 'Are you sure you want to delete all app data? This action cannot be undone.',
        confirmText: 'Continue',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      },
    }).afterClosed());

    if (!confirmed) {
      return;
    }

    const accounts = this.accountState.accounts().map(account => this.formatAccountLabel(account));
    const finalConfirmed = await firstValueFrom(this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
      width: '460px',
      data: {
        title: 'Accounts Will Be Deleted Too',
        message: 'Wiping all data will also remove every account stored on this device.',
        warningText: 'If you do not have a backup of your nsec, it will be lost forever.',
        items: accounts,
        confirmText: 'Delete All Data',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      },
    }).afterClosed());

    if (finalConfirmed) {
      await this.app.wipe();
    }
  }

  private formatAccountLabel(account: NostrUser): string {
    const npub = nip19.npubEncode(account.pubkey);
    return account.name?.trim() ? `${account.name} (${npub})` : npub;
  }
}
