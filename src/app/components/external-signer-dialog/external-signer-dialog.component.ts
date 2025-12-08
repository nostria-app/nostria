import { Component, inject, AfterViewInit, OnDestroy, ChangeDetectionStrategy, NgZone } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

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
    MatProgressSpinnerModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Waiting for Signature</h2>
    <mat-dialog-content class="dialog-content">
      <div class="spinner-container">
        <mat-spinner diameter="48"></mat-spinner>
      </div>
      <p class="status-text">
        Please approve the signing request in your external signer app (like Amber).
      </p>
      <p class="hint-text">
        The signed event will be detected automatically.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      min-width: 280px;
      max-width: 400px;
      padding: 24px 16px;
    }
    .spinner-container {
      padding: 16px 0;
    }
    .status-text {
      text-align: center;
      margin: 0;
      color: var(--mat-sys-on-surface);
    }
    .hint-text {
      text-align: center;
      margin: 0;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }
  `]
})
export class ExternalSignerDialogComponent implements AfterViewInit, OnDestroy {
  readonly dialogRef = inject(MatDialogRef<ExternalSignerDialogComponent>);
  readonly data = inject<ExternalSignerDialogData>(MAT_DIALOG_DATA);
  private ngZone = inject(NgZone);

  private resultJson = '';
  private clipboardPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastClipboardContent = '';

  ngAfterViewInit() {
    // Automatically open the signer app and start monitoring
    this.openSignerApp();
  }

  ngOnDestroy() {
    window.removeEventListener('focus', this.onWindowFocus);
    this.stopClipboardPolling();
  }

  private openSignerApp() {
    // Store current clipboard content to ignore it
    navigator.clipboard.readText().then(text => {
      this.lastClipboardContent = text.trim();
    }).catch(() => {
      // Ignore errors
    });

    // Open the signer app using an anchor element with target="_blank"
    // This prevents the main app window from closing/navigating away on Android
    // The nostrsigner: protocol will trigger the Android intent system to open the signer app
    // Using target="_blank" ensures the current window stays open
    this.safeOpenExternalSigner(this.data.nostrSignerUrl);

    // Start monitoring clipboard
    window.addEventListener('focus', this.onWindowFocus);
    this.startClipboardPolling();
  }

  /**
   * Safely opens the external signer URL without navigating away from or closing the main app.
   * Uses an iframe approach first, falling back to anchor with target="_blank".
   */
  private safeOpenExternalSigner(url: string): void {
    // Store current location to verify we're still in the app
    const currentOrigin = window.location.origin;
    const currentHref = window.location.href;

    // Try using an invisible iframe first - this works on Android for intent URLs
    // and prevents any navigation in the main window
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.position = 'absolute';
    document.body.appendChild(iframe);

    // Set the iframe src to trigger the intent
    try {
      iframe.src = url;
    } catch {
      // If iframe approach fails, fall back to anchor
    }

    // Remove the iframe after a short delay
    setTimeout(() => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }

      // Verify we're still on our app - if not, something went wrong
      // This is a safety check but the iframe approach should prevent navigation
      if (window.location.origin !== currentOrigin || window.location.href !== currentHref) {
        // Try to navigate back if we somehow left the app
        window.location.href = currentHref;
      }
    }, 500);
  }

  private startClipboardPolling() {
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
          this.confirm();
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

  private onWindowFocus = async () => {
    // Immediately check clipboard on window focus for faster detection
    await this.checkClipboard();
  };

  private confirm() {
    this.stopClipboardPolling();
    this.dialogRef.close(this.resultJson);
  }
}