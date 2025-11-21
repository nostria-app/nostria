import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MemosService } from '../../../services/memos.service';

@Component({
  selector: 'app-memos-history-dialog',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
  ],
  template: `
    <h2 mat-dialog-title>Memos History</h2>
    <mat-dialog-content>
      <p class="description">
        Merge a previous version of your memos with your current ones. This will restore missing memos but keep newer versions of existing ones.
        Backups are stored locally on this device. Only last 10 edits are kept.
      </p>

      @if (backups().length === 0) {
        <div class="empty-state">
          <mat-icon>history</mat-icon>
          <p>No history available yet.</p>
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
                {{ backup.memos.length }} memos
              </div>
              <div matListItemMeta>
                <button mat-stroked-button (click)="restore(backup.id)">Merge</button>
              </div>
            </mat-list-item>
          }
        </mat-list>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .description {
      color: var(--text-secondary);
      margin-bottom: 16px;
    }
    
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px;
      color: var(--text-secondary);
      gap: 8px;
    }

    .empty-state mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      opacity: 0.5;
    }

    mat-list-item {
      margin-bottom: 8px;
      background-color: var(--mat-sys-surface-container-high);
      border-radius: 8px;
    }
  `]
})
export class MemosHistoryDialogComponent {
  private dialogRef = inject(MatDialogRef<MemosHistoryDialogComponent>);
  private memosService = inject(MemosService);

  backups = signal(this.memosService.getBackups());

  async restore(backupId: string) {
    const success = await this.memosService.restoreBackup(backupId);
    if (success) {
      this.dialogRef.close(true);
    }
  }
}
