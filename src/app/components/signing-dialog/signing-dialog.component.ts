import { Component, inject, ViewEncapsulation } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-signing-dialog',
  imports: [MatDialogModule, MatIconModule, MatProgressSpinnerModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="signing-dialog-container">
      <div class="signing-dialog-content">
        <mat-spinner [diameter]="48"></mat-spinner>
        <h2 mat-dialog-title>Signing Request</h2>
        <mat-dialog-content>
          <p>Please approve the signing request in your browser extension.</p>
          <p class="extension-hint">Look for a popup from your Nostr extension (Alby, nos2x, etc.)</p>
        </mat-dialog-content>
      </div>
    </div>
  `,
  styles: `
    .signing-dialog-container {
      padding: 24px;
      text-align: center;
      min-width: 300px;
      position: relative;
      z-index: 1001;
    }

    .signing-dialog-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    h2 {
      margin: 0;
      font-size: 20px;
    }

    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 0;
    }

    p {
      margin: 0;
      line-height: 1.5;
    }

    .extension-hint {
      font-size: 14px;
      opacity: 0.7;
    }

    mat-spinner {
      margin: 0 auto;
    }
  `,
})
export class SigningDialogComponent {
  private dialogRef = inject(MatDialogRef<SigningDialogComponent>);

  close() {
    this.dialogRef.close();
  }
}
