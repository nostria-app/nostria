import { Component, inject, signal, effect, computed } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { MemosService } from '../../services/memos.service';
import { Memo } from '../../models/memo.model';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
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
    RouterModule,
    MemoCardComponent,
    InfoTooltipComponent
  ],
  template: `
    @if (!app.authenticated()) {
      <div class="unauthenticated-state">
        <mat-icon>account_circle</mat-icon>
        <h2>Sign in to use Memos</h2>
        <p>Create encrypted private notes that sync across all your devices.</p>
      </div>
    } @else if (!isPremium()) {
      <div class="premium-gate">
        <!-- Blurred preview background -->
        <div class="preview-backdrop">
          <div class="mock-memos-grid">
            <div class="mock-memo-card yellow">
              <div class="mock-memo-title"></div>
              <div class="mock-memo-line"></div>
              <div class="mock-memo-line short"></div>
            </div>
            <div class="mock-memo-card blue">
              <div class="mock-memo-title"></div>
              <div class="mock-memo-line"></div>
              <div class="mock-memo-line"></div>
              <div class="mock-memo-line short"></div>
            </div>
            <div class="mock-memo-card green">
              <div class="mock-memo-title"></div>
              <div class="mock-memo-line short"></div>
            </div>
            <div class="mock-memo-card pink">
              <div class="mock-memo-title"></div>
              <div class="mock-memo-line"></div>
              <div class="mock-memo-line"></div>
            </div>
            <div class="mock-memo-card purple">
              <div class="mock-memo-title"></div>
              <div class="mock-memo-line"></div>
              <div class="mock-memo-line short"></div>
              <div class="mock-memo-line"></div>
            </div>
            <div class="mock-memo-card orange">
              <div class="mock-memo-title"></div>
              <div class="mock-memo-line"></div>
            </div>
          </div>
        </div>

        <!-- Premium CTA overlay -->
        <div class="premium-cta-overlay">
          <div class="premium-badge">
            <mat-icon>note_stack</mat-icon>
          </div>
          <h1 class="premium-title">Unlock Memos</h1>
          <p class="premium-subtitle">
            Create encrypted private notes that sync across all your devices
          </p>

          <div class="features-grid">
            <div class="feature-card">
              <div class="feature-icon">
                <mat-icon>lock</mat-icon>
              </div>
              <h3>End-to-End Encrypted</h3>
              <p>Only you can read your memos with your private key</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <mat-icon>sync</mat-icon>
              </div>
              <h3>Cross-Device Sync</h3>
              <p>Access your memos from any device, anywhere</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <mat-icon>palette</mat-icon>
              </div>
              <h3>Color Coding</h3>
              <p>Organize your notes with beautiful color themes</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <mat-icon>history</mat-icon>
              </div>
              <h3>Version History</h3>
              <p>Local backups keep your memos safe</p>
            </div>
          </div>

          <div class="cta-section">
            <a mat-flat-button routerLink="/premium/upgrade" class="upgrade-btn">
              <mat-icon>stars</mat-icon>
              Upgrade to Premium
            </a>
            <p class="cta-hint">Includes all premium features • Cancel anytime</p>
          </div>
        </div>
      </div>
    } @else {
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
    }
  `,
  styles: [`
    .unauthenticated-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 3rem;
      min-height: 60vh;
    }

    .unauthenticated-state mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: var(--mat-sys-primary);
      opacity: 0.7;
      margin-bottom: 1rem;
    }

    .unauthenticated-state h2 {
      margin: 0 0 0.5rem 0;
    }

    .unauthenticated-state p {
      color: var(--mat-sys-on-surface-variant);
      max-width: 400px;
    }

    /* Premium Gate Styles */
    .premium-gate {
      position: relative;
      min-height: 100vh;
      overflow: hidden;
    }

    .preview-backdrop {
      position: absolute;
      inset: 0;
      padding: 2rem;
      filter: blur(8px);
      opacity: 0.3;
      pointer-events: none;
    }

    .mock-memos-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      max-width: 800px;
      margin: 80px auto;
    }

    .mock-memo-card {
      padding: 1.5rem;
      border-radius: 12px;
      min-height: 120px;
    }

    .mock-memo-card.yellow { background: #fff9c4; }
    .mock-memo-card.blue { background: #bbdefb; }
    .mock-memo-card.green { background: #c8e6c9; }
    .mock-memo-card.pink { background: #f8bbd9; }
    .mock-memo-card.purple { background: #e1bee7; }
    .mock-memo-card.orange { background: #ffe0b2; }

    .mock-memo-title {
      height: 16px;
      width: 60%;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      margin-bottom: 12px;
    }

    .mock-memo-line {
      height: 10px;
      width: 100%;
      background: rgba(0, 0, 0, 0.1);
      border-radius: 4px;
      margin-bottom: 8px;
    }

    .mock-memo-line.short {
      width: 70%;
    }

    .premium-cta-overlay {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
      background: linear-gradient(180deg, 
        transparent 0%, 
        var(--mat-sys-surface) 15%, 
        var(--mat-sys-surface) 85%, 
        transparent 100%);
    }

    .premium-badge {
      width: 80px;
      height: 80px;
      border-radius: 24px;
      background: linear-gradient(135deg, 
        var(--mat-sys-secondary), 
        var(--mat-sys-tertiary));
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.5rem;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    }

    .premium-badge mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: white;
    }

    .premium-title {
      font-size: 2rem;
      margin: 0 0 0.5rem 0;
      background: linear-gradient(135deg, 
        var(--mat-sys-secondary), 
        var(--mat-sys-primary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .premium-subtitle {
      font-size: 1.1rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 2.5rem 0;
      max-width: 400px;
      text-align: center;
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
      max-width: 600px;
      margin-bottom: 2.5rem;
    }

    .feature-card {
      background: var(--mat-sys-surface-container);
      border-radius: 16px;
      padding: 1.5rem;
      text-align: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .feature-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--mat-sys-level2);
    }

    .feature-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: linear-gradient(135deg, 
        var(--mat-sys-primary-container), 
        var(--mat-sys-secondary-container));
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 0.75rem auto;
    }

    .feature-icon mat-icon {
      color: var(--mat-sys-on-primary-container);
    }

    .feature-card h3 {
      font-size: 0.95rem;
      margin: 0 0 0.25rem 0;
    }

    .feature-card p {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
      line-height: 1.4;
    }

    .cta-section {
      text-align: center;
    }

    .upgrade-btn {
      padding: 0 2rem;
      height: 48px;
      font-size: 1rem;
      gap: 0.5rem;
    }

    .cta-hint {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 1rem 0 0 0;
    }

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

      .mock-memos-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .features-grid {
        grid-template-columns: 1fr;
      }

      .premium-title {
        font-size: 1.5rem;
      }
    }

    @media (max-width: 480px) {
      .mock-memos-grid {
        grid-template-columns: 1fr;
      }

      .feature-card {
        padding: 1rem;
      }

      .feature-icon {
        width: 40px;
        height: 40px;
      }
    }
  `],
})
export class MemosComponent {
  private readonly memosService = inject(MemosService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly accountState = inject(AccountStateService);
  private readonly dialog = inject(MatDialog);
  protected readonly app = inject(ApplicationService);

  readonly loading = signal(true);
  readonly memos = this.memosService.memos;
  private isLoadingMemos = false;

  readonly isPremium = computed(() => {
    const subscription = this.accountState.subscription();
    return subscription?.expires && subscription.expires > Date.now();
  });

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
