import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-note-delete-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>warning</mat-icon>
      Delete Note
    </h2>
    <mat-dialog-content>
      <p>Are you sure you want to delete this note?</p>
      <p class="warning-text">This action cannot be undone.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="warn" [mat-dialog-close]="true">Delete</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      h2 {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
      }

      h2 mat-icon {
        color: var(--warn);
      }

      mat-dialog-content {
        min-width: 300px;
        padding: 20px;
      }

      mat-dialog-content p {
        margin: 0 0 12px 0;
        line-height: 1.5;
      }

      .warning-text {
        color: var(--text-secondary);
        font-size: 14px;
      }

      mat-dialog-actions {
        padding: 16px;
      }
    `,
  ],
})
export class NoteDeleteDialogComponent { }
