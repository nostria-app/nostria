import { Component, inject, signal, effect } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MemosService } from '../../services/memos.service';
import { Memo } from '../../models/memo.model';
import { AccountStateService } from '../../services/account-state.service';
import { InfoTooltipComponent } from '../../components/info-tooltip/info-tooltip.component';
import { MemoCardComponent } from './memos-card/memo-card.component';
import { MemosDownloadDialogComponent } from './memos-download-dialog/memos-download-dialog.component';
import { MemosHistoryDialogComponent } from './memos-history-dialog/memos-history-dialog.component';

@Component({
  selector: 'app-memos',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    MatTooltipModule,
    MemoCardComponent,
    InfoTooltipComponent
],
  template: `


    <div class="notes-container">

      <header class="notes-header">
        <h1>
          Memos 
          <mat-icon class="premium-icon">diamond</mat-icon>
          <app-info-tooltip [content]="notesInfoContent" ariaLabel="Learn about Memos privacy" />
        </h1>
        <div class="header-actions">
          <button mat-icon-button (click)="openHistory()" matTooltip="History">
            <mat-icon>history</mat-icon>
          </button>
          <button mat-raised-button (click)="downloadMemos()">
            <mat-icon>download</mat-icon>
            Download
          </button>
          <button mat-flat-button (click)="createNewMemo()" [disabled]="loading()">
            <mat-icon>add</mat-icon>
            New Memo
          </button>
        </div>
      </header>

      <ng-template #notesInfoContent>
        <div class="info-content">
          <h3>About Memos</h3>
          <p>
            Memos are stored as <strong>encrypted events</strong> using NIP-44 encryption, 
            which means only you can read them with your private key.
          </p>
          <p>
            <strong>⚠️ Important Privacy Notice:</strong>
          </p>
          <ul>
            <li>Memos are published to <strong>public relays</strong>, making them retrievable by anyone</li>
            <li>While currently encrypted, future advances in computing power could potentially decrypt them</li>
            <li>Avoid storing highly sensitive personal information (passwords, private keys, etc.)</li>
            <li>Think of Memos as "encrypted but not completely secret"</li>
          </ul>
          <p>
            <strong>Best practices:</strong> Use Memos for personal reminders, ideas, and non-critical information 
            that you want synced across devices.
          </p>
        </div>
      </ng-template>

      @if (loading()) {
        <div class="loading-container">
          <mat-spinner />
        </div>
      } @else if (memos().length === 0) {
        <div class="empty-state">
          <mat-icon>note</mat-icon>
          <h2>No memos yet</h2>
          <p>Create your first encrypted memo</p>
          <button mat-raised-button color="primary" (click)="createNewMemo()">
            <mat-icon>add</mat-icon>
            Create Note
          </button>
        </div>
      } @else {
        <div class="notes-grid">
          @for (memo of memos(); track memo.id) {
            <app-memo-card
              [memo]="memo"
              (save)="handleSaveMemo($event)"
              (delete)="handleDeleteMemo($event)"
            />
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .notes-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }

    .notes-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
    }

    .notes-header h1 {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .header-actions {
      display: flex;
      gap: 12px;
    }

    .info-content {
      max-width: 500px;
      padding: 16px;
    }

    .info-content h3 {
      margin-top: 0;
      margin-bottom: 12px;
    }

    .info-content p {
      margin-bottom: 12px;
      line-height: 1.6;
    }

    .info-content ul {
      margin: 8px 0;
      padding-left: 20px;
      line-height: 1.6;
    }

    .info-content ul li {
      margin-bottom: 8px;
    }

    .loading-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 400px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      gap: 16px;
      color: var(--text-secondary);
    }

    .empty-state mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      opacity: 0.5;
    }

    .empty-state h2 {
      margin: 0;
      font-size: 24px;
    }

    .empty-state p {
      margin: 0;
      font-size: 16px;
    }

    .notes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      padding-bottom: 32px;
    }

    @media (max-width: 768px) {
      .notes-container {
        padding: 16px;
      }

      .notes-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 16px;
      }

      .notes-grid {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class MemosComponent {
  private readonly memosService = inject(MemosService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly accountState = inject(AccountStateService);
  private readonly dialog = inject(MatDialog);

  readonly loading = signal(true);
  readonly memos = this.memosService.memos;
  private isLoadingMemos = false;

  constructor() {
    // Reload memos when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      console.log('[MemosComponent] Account changed, pubkey:', pubkey?.substring(0, 8));
      if (pubkey) {
        // Use setTimeout to avoid effect timing issues
        setTimeout(() => this.loadMemos(), 0);
      } else {
        // Clear memos if no account
        this.memosService.memos.set([]);
      }
    });
  }

  async loadMemos() {
    // Prevent duplicate loads
    if (this.isLoadingMemos) {
      console.log('[MemosComponent] Already loading memos, skipping...');
      return;
    }

    console.log('[MemosComponent] loadMemos called');
    this.isLoadingMemos = true;
    this.loading.set(true);
    try {
      await this.memosService.loadMemos();
    } finally {
      this.loading.set(false);
      this.isLoadingMemos = false;
    }
  }

  async createNewMemo() {
    const success = await this.memosService.createMemo('', 'default');
    if (success) {
      this.snackBar.open('Note created', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to create note', 'Close', { duration: 3000 });
    }
  }

  async downloadMemos() {
    const dialogRef = this.dialog.open(MemosDownloadDialogComponent, {
      width: '500px',
    });

    const format = await dialogRef.afterClosed().toPromise();

    if (!format) {
      return; // User cancelled
    }

    try {
      if (format === 'encrypted') {
        await this.memosService.downloadEncryptedEvent();
        this.snackBar.open('Encrypted event downloaded', 'Close', { duration: 2000 });
      } else if (format === 'json') {
        await this.memosService.downloadReadableJson();
        this.snackBar.open('JSON file downloaded', 'Close', { duration: 2000 });
      }
    } catch (error) {
      console.error('Download failed:', error);
      this.snackBar.open('Failed to download memos', 'Close', { duration: 3000 });
    }
  }

  openHistory() {
    this.dialog.open(MemosHistoryDialogComponent, {
      width: '500px',
      maxHeight: '80vh'
    });
  }

  async handleSaveMemo(memo: Memo) {
    const success = await this.memosService.updateMemo(memo.id, memo.content, memo.color);
    if (success) {
      this.snackBar.open('Memo saved', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to save memo', 'Close', { duration: 3000 });
    }
  }

  async handleDeleteMemo(memoId: string) {
    const success = await this.memosService.deleteMemo(memoId);
    if (success) {
      this.snackBar.open('Memo deleted', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to delete memo', 'Close', { duration: 3000 });
    }
  }
}
