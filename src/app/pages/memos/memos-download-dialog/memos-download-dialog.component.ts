import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

export type DownloadFormat = 'encrypted' | 'json';

@Component({
  selector: 'app-memos-download-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>Download Notes</h2>
    <mat-dialog-content>
      <p>Choose the format to download your notes:</p>
      
      <div class="download-options">
        <button 
          mat-raised-button 
          class="download-option"
          (click)="selectFormat('encrypted')"
        >
          <mat-icon>lock</mat-icon>
          <div class="option-content">
            <strong>Encrypted Nostr Event</strong>
            <span>The raw encrypted event as stored on relays (NIP-78)</span>
          </div>
        </button>

        <button 
          mat-raised-button 
          class="download-option"
          (click)="selectFormat('json')"
        >
          <mat-icon>description</mat-icon>
          <div class="option-content">
            <strong>Readable JSON File</strong>
            <span>Decrypted notes in human-readable JSON format</span>
          </div>
        </button>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      min-width: 400px;
      padding: 20px;
    }

    mat-dialog-content p {
      margin-bottom: 16px;
      color: var(--text-secondary);
    }

    .download-options {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .download-option {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      padding: 16px;
      text-align: left;
      height: auto;
      justify-content: flex-start;
    }

    .download-option mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: var(--primary);
      flex-shrink: 0;
    }

    .option-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .option-content strong {
      font-size: 14px;
      color: var(--text-primary);
    }

    .option-content span {
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    mat-dialog-actions {
      padding: 16px;
    }
  `],
})
export class MemosDownloadDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<MemosDownloadDialogComponent>);

  selectFormat(format: DownloadFormat) {
    this.dialogRef.close(format);
  }
}
