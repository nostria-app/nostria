import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { FollowingBackupService } from '../../../services/following-backup.service';

@Component({
  selector: 'app-following-history-dialog',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatSnackBarModule,
    MatMenuModule,
  ],
  template: `
    <h2 mat-dialog-title>Following List History</h2>
    <mat-dialog-content>
      <p class="description">
        View and restore previous versions of your following list. You can either restore (replace your current list) or merge (combine with your current list).
        Backups are stored locally on this device. Only the last 10 versions are kept.
      </p>

      @if (backups().length === 0) {
        <div class="empty-state">
          <mat-icon>history</mat-icon>
          <p>No history available yet.</p>
          <p class="hint">Backups are created automatically when you follow or unfollow someone.</p>
        </div>
      } @else {
        <mat-list>
          @for (backup of backups(); track backup.id) {
            <mat-list-item>
              <mat-icon matListItemIcon>backup</mat-icon>
              <div matListItemTitle>
                {{ backup.timestamp | date:'medium' }}
              </div>
              <div matListItemLine>
                {{ backup.pubkeys.length }} accounts following
              </div>
              <div matListItemMeta class="actions">
                <button mat-stroked-button [matMenuTriggerFor]="menu" [disabled]="processing()">
                  <mat-icon>more_vert</mat-icon>
                  Actions
                </button>
                <mat-menu #menu="matMenu">
                  <button mat-menu-item (click)="restore(backup.id)">
                    <mat-icon>restore</mat-icon>
                    <span>Restore (Replace)</span>
                  </button>
                  <button mat-menu-item (click)="merge(backup.id)">
                    <mat-icon>merge</mat-icon>
                    <span>Merge (Combine)</span>
                  </button>
                  <button mat-menu-item (click)="deleteBackup(backup.id)">
                    <mat-icon>delete</mat-icon>
                    <span>Delete</span>
                  </button>
                </mat-menu>
              </div>
            </mat-list-item>
          }
        </mat-list>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (backups().length > 0) {
        <button mat-button (click)="clearAll()" [disabled]="processing()" color="warn">
          Clear All
        </button>
      }
      <button mat-button mat-dialog-close [disabled]="processing()">Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .description {
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 16px;
      line-height: 1.5;
    }
    
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 32px;
      color: var(--mat-sys-on-surface-variant);
      gap: 8px;
      text-align: center;
    }

    .empty-state mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      opacity: 0.5;
    }

    .empty-state .hint {
      font-size: 14px;
      opacity: 0.7;
      margin-top: 8px;
    }

    mat-list-item {
      margin-bottom: 8px;
      background-color: var(--mat-sys-surface-container-high);
      border-radius: 8px;
      min-height: 72px;
    }

    .actions {
      display: flex;
      gap: 8px;
    }

    mat-dialog-content {
      min-width: 500px;
      max-height: 60vh;
    }
  `]
})
export class FollowingHistoryDialogComponent {
  private dialogRef = inject(MatDialogRef<FollowingHistoryDialogComponent>);
  private followingBackupService = inject(FollowingBackupService);
  private snackBar = inject(MatSnackBar);

  backups = signal(this.followingBackupService.getBackups());
  processing = signal(false);

  async restore(backupId: string) {
    if (this.processing()) return;

    this.processing.set(true);
    try {
      const success = await this.followingBackupService.restoreBackup(backupId);
      if (success) {
        this.showMessage('Following list restored successfully');
        this.dialogRef.close(true);
      } else {
        this.showMessage('Failed to restore following list', true);
      }
    } finally {
      this.processing.set(false);
    }
  }

  async merge(backupId: string) {
    if (this.processing()) return;

    this.processing.set(true);
    try {
      const success = await this.followingBackupService.mergeBackup(backupId);
      if (success) {
        this.showMessage('Following lists merged successfully');
        this.dialogRef.close(true);
      } else {
        this.showMessage('Failed to merge following lists', true);
      }
    } finally {
      this.processing.set(false);
    }
  }

  deleteBackup(backupId: string) {
    const success = this.followingBackupService.deleteBackup(backupId);
    if (success) {
      this.backups.set(this.followingBackupService.getBackups());
      this.showMessage('Backup deleted');
    } else {
      this.showMessage('Failed to delete backup', true);
    }
  }

  clearAll() {
    if (this.processing()) return;

    this.followingBackupService.clearAllBackups();
    this.backups.set([]);
    this.showMessage('All backups cleared');
  }

  private showMessage(message: string, isError = false): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: isError ? ['error-snackbar'] : undefined,
    });
  }
}
