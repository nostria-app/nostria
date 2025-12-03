import { Component, inject, AfterViewInit, OnDestroy, ViewChild, ElementRef, signal, ChangeDetectionStrategy, NgZone } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { FormsModule } from '@angular/forms';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

export interface ExternalSignerDialogData {
  eventJson: string;
  nostrSignerUrl: string;
}

@Component({
  selector: 'app-external-signer-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    FormsModule,
    ClipboardModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Sign with External App</h2>
    <mat-dialog-content class="dialog-content">
      <p>
        Click the button below to open your external signer app (like Amber), or copy the event JSON manually.
      </p>

      <div class="actions">
        <a mat-flat-button [href]="safeUrl">
          <mat-icon>open_in_new</mat-icon>
          Open Signer App
        </a>
        <button mat-stroked-button [cdkCopyToClipboard]="data.eventJson">
          <mat-icon>content_copy</mat-icon>
          Copy Event JSON
        </button>
      </div>

      @if (autoConfirmCountdown() > 0) {
        <div class="auto-confirm-notice">
          <mat-icon>check_circle</mat-icon>
          <span>Signature detected! Auto-confirming in {{ autoConfirmCountdown() }}...</span>
          <button mat-icon-button (click)="cancelAutoConfirm()" matTooltip="Cancel auto-confirm">
            <mat-icon>close</mat-icon>
          </button>
        </div>
        <mat-progress-bar mode="determinate" [value]="(3 - autoConfirmCountdown()) * 33.33"></mat-progress-bar>
      } @else {
        <div class="status-notice" [class.monitoring]="isMonitoring()">
          <mat-icon>{{ isMonitoring() ? 'sync' : 'info' }}</mat-icon>
          <span>{{ isMonitoring() ? 'Monitoring clipboard for signature...' : 'Waiting for signed event' }}</span>
        </div>
      }

      <div class="divider">
        <span>OR PASTE MANUALLY</span>
      </div>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Paste Signature or Signed Event JSON</mat-label>
        <textarea matInput [(ngModel)]="resultJson" rows="4" placeholder='{"id": "...", "pubkey": "...", "sig": "..."}' #resultInput></textarea>
      </mat-form-field>

    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!resultJson" (click)="confirm()">
        Confirm
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 300px;
      max-width: 500px;
    }
    .actions {
      display: flex;
      justify-content: center;
      gap: 8px;
      padding: 16px 0;
      flex-wrap: wrap;
    }
    .auto-confirm-notice {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background-color: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      border-radius: var(--mat-sys-corner-small);
    }
    .auto-confirm-notice mat-icon:first-child {
      color: var(--mat-success-color);
    }
    .auto-confirm-notice span {
      flex: 1;
    }
    .status-notice {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background-color: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface-variant);
      border-radius: var(--mat-sys-corner-small);
    }
    .status-notice.monitoring mat-icon {
      animation: spin 2s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .divider {
      display: flex;
      align-items: center;
      text-align: center;
      color: var(--mat-sys-outline);
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .divider span {
      padding: 0 10px;
      font-size: 12px;
    }
    .full-width {
      width: 100%;
    }
    mat-progress-bar {
      margin-top: -8px;
      border-radius: 0 0 var(--mat-sys-corner-small) var(--mat-sys-corner-small);
    }
  `]
})
export class ExternalSignerDialogComponent implements AfterViewInit, OnDestroy {
  readonly dialogRef = inject(MatDialogRef<ExternalSignerDialogComponent>);
  readonly data = inject<ExternalSignerDialogData>(MAT_DIALOG_DATA);
  private sanitizer = inject(DomSanitizer);
  private ngZone = inject(NgZone);

  @ViewChild('resultInput') resultInput!: ElementRef<HTMLTextAreaElement>;

  resultJson = '';
  autoConfirmCountdown = signal(0);
  isMonitoring = signal(false);

  private autoConfirmTimer: ReturnType<typeof setInterval> | null = null;
  private clipboardPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastClipboardContent = '';

  get safeUrl(): SafeUrl {
    return this.sanitizer.bypassSecurityTrustUrl(this.data.nostrSignerUrl);
  }

  ngAfterViewInit() {
    this.resultInput.nativeElement.focus();
    window.addEventListener('focus', this.onWindowFocus);

    // Start clipboard polling for better UX
    this.startClipboardPolling();
  }

  ngOnDestroy() {
    window.removeEventListener('focus', this.onWindowFocus);
    this.stopAutoConfirm();
    this.stopClipboardPolling();
  }

  private startClipboardPolling() {
    this.isMonitoring.set(true);

    // Poll clipboard every 500ms
    this.clipboardPollTimer = setInterval(() => {
      this.checkClipboard();
    }, 500);
  }

  private stopClipboardPolling() {
    if (this.clipboardPollTimer) {
      clearInterval(this.clipboardPollTimer);
      this.clipboardPollTimer = null;
    }
    this.isMonitoring.set(false);
  }

  private async checkClipboard() {
    try {
      const text = (await navigator.clipboard.readText()).trim();

      // Skip if empty or same as last check
      if (!text || text === this.lastClipboardContent) return;

      const validData = this.extractValidSignatureData(text);
      if (validData) {
        this.lastClipboardContent = text;
        this.ngZone.run(() => {
          this.resultJson = validData;
          this.startAutoConfirm();
        });
      }
    } catch {
      // Ignore clipboard read errors (permission denied, etc.)
    }
  }

  private extractValidSignatureData(text: string): string | null {
    // JSON Event check - must have 'sig' field to be a signed event
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const parsed = JSON.parse(text);
        // Check if it's a valid signed Nostr event
        if (parsed.sig && typeof parsed.sig === 'string' && parsed.sig.length === 128) {
          return text;
        }
      } catch {
        // Invalid JSON, continue to other checks
      }
    }

    // Signature check (Hex) - Schnorr signature is 64 bytes (128 hex characters)
    const isHex = /^[0-9a-fA-F]+$/.test(text);
    if (isHex && text.length === 128) {
      return text;
    }

    return null;
  }

  private startAutoConfirm() {
    // Stop polling once we have valid data
    this.stopClipboardPolling();

    // Start countdown from 3
    this.autoConfirmCountdown.set(3);

    this.autoConfirmTimer = setInterval(() => {
      const current = this.autoConfirmCountdown();
      if (current <= 1) {
        this.stopAutoConfirm();
        this.confirm();
      } else {
        this.autoConfirmCountdown.set(current - 1);
      }
    }, 1000);
  }

  private stopAutoConfirm() {
    if (this.autoConfirmTimer) {
      clearInterval(this.autoConfirmTimer);
      this.autoConfirmTimer = null;
    }
  }

  cancelAutoConfirm() {
    this.stopAutoConfirm();
    this.autoConfirmCountdown.set(0);
    // Resume polling in case user wants to try again
    this.startClipboardPolling();
  }

  onWindowFocus = async () => {
    this.resultInput.nativeElement.focus();
    // Immediately check clipboard on window focus for faster detection
    await this.checkClipboard();
  };

  confirm() {
    this.stopAutoConfirm();
    this.stopClipboardPolling();
    this.dialogRef.close(this.resultJson);
  }
}