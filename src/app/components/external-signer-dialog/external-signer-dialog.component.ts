import { Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { ClipboardModule } from '@angular/cdk/clipboard';

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
        <a mat-flat-button color="primary" [href]="data.nostrSignerUrl" target="_blank" rel="noopener noreferrer">
          <mat-icon>open_in_new</mat-icon>
          Open Signer App
        </a>
      </div>

      <div class="divider">
        <span>OR</span>
      </div>

      <p>
        After signing, paste the signature or the full signed event JSON below:
      </p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Paste Signature or Signed Event JSON</mat-label>
        <textarea matInput [(ngModel)]="resultJson" rows="6" placeholder='{"id": "...", "pubkey": "...", "sig": "..."}'></textarea>
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
      padding: 16px 0;
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
export class ExternalSignerDialogComponent {
  readonly dialogRef = inject(MatDialogRef<ExternalSignerDialogComponent>);
  readonly data = inject<ExternalSignerDialogData>(MAT_DIALOG_DATA);
  
  resultJson = '';

  confirm() {
    this.dialogRef.close(this.resultJson);
  }
}
