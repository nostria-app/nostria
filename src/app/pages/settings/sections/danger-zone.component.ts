import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { ApplicationService } from '../../../services/application.service';

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

  wipeData(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Confirm Data Deletion',
        message: 'Are you sure you want to delete all app data? This action cannot be undone.',
        confirmButtonText: 'Delete All Data',
      },
    });

    dialogRef.afterClosed().subscribe(async confirmed => {
      if (confirmed) {
        await this.app.wipe();
      }
    });
  }
}
