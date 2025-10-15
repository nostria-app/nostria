import { Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-database-error-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div style="max-width: 500px">
      <h2 mat-dialog-title style="display: flex; align-items: center; gap: 12px;">
        <mat-icon style="color: #f44336;">error</mat-icon>
        <span>Database Locked</span>
      </h2>
      <mat-dialog-content>
        <p style="margin-bottom: 16px;">
          <strong>Nostria is unable to access the browser's IndexedDB database.</strong>
        </p>
        <p style="margin-bottom: 16px;">
          This typically happens when:
        </p>
        <ul style="margin-bottom: 16px; padding-left: 20px;">
          <li>Another browser tab or window has a lock on the database</li>
          <li>The browser's storage has become corrupted</li>
          <li>A browser extension is interfering with database access</li>
        </ul>
        <p style="margin-bottom: 8px;">
          <strong>To resolve this issue:</strong>
        </p>
        <ol style="padding-left: 20px;">
          <li>Close ALL browser tabs and windows running Nostria</li>
          <li>Completely restart your browser (close and reopen)</li>
          <li>If the issue persists, clear your browser's site data for Nostria</li>
        </ol>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-raised-button color="primary" (click)="close()">
          I Understand
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      mat-dialog-content {
        line-height: 1.6;
      }
      
      ul, ol {
        line-height: 1.8;
      }
      
      li {
        margin-bottom: 4px;
      }
    `,
  ],
})
export class DatabaseErrorDialogComponent {
  private dialogRef = inject(MatDialogRef<DatabaseErrorDialogComponent>);

  close(): void {
    this.dialogRef.close();
  }
}
