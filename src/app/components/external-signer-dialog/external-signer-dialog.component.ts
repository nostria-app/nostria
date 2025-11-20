import { Component, inject, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

export interface ExternalSignerDialogData {
  eventJson: string;
  nostrSignerUrl: string;
}

@Component({
  selector: 'app-external-signer-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    ClipboardModule
  ],
  template: `
    <h2 mat-dialog-title>Sign with External App</h2>
    <mat-dialog-content class="dialog-content">
      <p>
        Click the button below to open your external signer app (like Amber), or copy the event JSON manually.
      </p>

      <div class="actions">
        <a mat-flat-button color="primary" [href]="safeUrl">
          <mat-icon>open_in_new</mat-icon>
          Open Signer App
        </a>
        <button mat-stroked-button [cdkCopyToClipboard]="data.eventJson">
          <mat-icon>content_copy</mat-icon>
          Copy Event JSON
        </button>
      </div>

      <div class="divider">
        <span>OR</span>
      </div>

      <p>
        After signing, paste the signature or the full signed event JSON below:
      </p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Paste Signature or Signed Event JSON</mat-label>
        <textarea matInput [(ngModel)]="resultJson" rows="6" placeholder='{"id": "...", "pubkey": "...", "sig": "..."}' #resultInput></textarea>
      </mat-form-field>

    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [disabled]="!resultJson" (click)="confirm()">
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
    .divider {
      display: flex;
      align-items: center;
      text-align: center;
      color: rgba(255, 255, 255, 0.5);
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    }
    .divider span {
      padding: 0 10px;
    }
    .full-width {
      width: 100%;
    }
  `]
})
export class ExternalSignerDialogComponent implements AfterViewInit, OnDestroy {
  readonly dialogRef = inject(MatDialogRef<ExternalSignerDialogComponent>);
  readonly data = inject<ExternalSignerDialogData>(MAT_DIALOG_DATA);
  private sanitizer = inject(DomSanitizer);

  @ViewChild('resultInput') resultInput!: ElementRef<HTMLTextAreaElement>;

  resultJson = '';

  get safeUrl(): SafeUrl {
    return this.sanitizer.bypassSecurityTrustUrl(this.data.nostrSignerUrl);
  }

  ngAfterViewInit() {
    this.resultInput.nativeElement.focus();
    window.addEventListener('focus', this.onWindowFocus);
  }

  ngOnDestroy() {
    window.removeEventListener('focus', this.onWindowFocus);
  }

  onWindowFocus = async () => {
    this.resultInput.nativeElement.focus();
    try {
      const text = (await navigator.clipboard.readText()).trim();

      if (!text) return;

      // JSON Event check
      if (text.startsWith('{') && text.endsWith('}')) {
        this.resultJson = text;
        return;
      }

      // Signature check (Hex)
      // Schnorr signature is 64 bytes (128 hex characters)
      const isHex = /^[0-9a-fA-F]+$/.test(text);
      if (isHex && text.length === 128) {
        this.resultJson = text;
      }
    } catch (err) {
      // Ignore clipboard read errors
    }
  }

  confirm() {
    this.dialogRef.close(this.resultJson);
  }
}