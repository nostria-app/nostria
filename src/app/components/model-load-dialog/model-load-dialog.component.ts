import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';

export interface ModelLoadDialogData {
  model: string;
  task: string;
}

@Component({
  selector: 'app-model-load-dialog',
  imports: [MatDialogModule, MatProgressBarModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Loading AI Model</h2>
    <div mat-dialog-content>
      <p>Downloading model <strong>{{ data.model }}</strong> for {{ data.task }}...</p>
      <p class="note">This happens only once. The model will be cached for future use.</p>
      
      <mat-progress-bar 
        [mode]="progress() > 0 ? 'determinate' : 'indeterminate'" 
        [value]="progress()">
      </mat-progress-bar>
      
      <div class="status-text">
        @if (status()) {
          {{ status() }}
        } @else {
          Initializing...
        }
      </div>
    </div>
    <div mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
    </div>
  `,
  styles: [`
    .note {
      font-size: 0.9em;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 16px;
    }
    .status-text {
      margin-top: 8px;
      font-size: 0.85em;
      text-align: right;
      min-height: 1.2em;
    }
    mat-progress-bar {
      margin-top: 8px;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelLoadDialogComponent {
  readonly dialogRef = inject(MatDialogRef<ModelLoadDialogComponent>);
  readonly data = inject<ModelLoadDialogData>(MAT_DIALOG_DATA);

  progress = signal(0);
  status = signal('');

  constructor() {
    this.dialogRef.disableClose = true;
  }

  updateProgress(data: { status: string, progress?: number, file?: string }) {
    if (data.status === 'progress' && data.progress !== undefined) {
      this.progress.set(data.progress);
      if (data.file) {
        this.status.set(`${data.file} (${Math.round(data.progress)}%)`);
      }
    } else if (data.status === 'done') {
      this.status.set('Model loaded!');
      this.progress.set(100);
    } else if (data.status === 'initiate') {
      this.status.set(`Starting download: ${data.file || ''}`);
    } else if (data.status === 'download') {
      this.status.set(`Downloading...`);
    }
  }

  cancel() {
    this.dialogRef.close(false);
  }
}
