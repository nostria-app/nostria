import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { MaterialCustomDialogComponent } from '../material-custom-dialog/material-custom-dialog.component';
import { AiModelDownloadProgressTracker } from '../../utils/ai-model-download-progress';

export interface ModelLoadDialogData {
  model: string;
  task: string;
}

@Component({
  selector: 'app-model-load-dialog',
  imports: [MaterialCustomDialogComponent, MatProgressBarModule, MatButtonModule],
  template: `
    <app-material-custom-dialog
      title="Loading AI Model"
      icon="download"
      [showDefaultActions]="false"
      [showCloseButton]="false"
    >
      <div dialog-content>
        <p>Downloading model <strong>{{ data.model }}</strong> for {{ data.task }}...</p>
        <p class="note">This happens only once. The model will be cached for future use.</p>

        <mat-progress-bar
          [mode]="progress() > 0 ? 'determinate' : 'indeterminate'"
          [value]="progress()">
        </mat-progress-bar>

        <div class="status-text">
          <span>{{ status() || 'Initializing...' }}</span>
          @if (progress() > 0) {
          <span>{{ progress() }}%</span>
          }
        </div>
        @if (details()) {
        <div class="details-text">
          {{ details() }}
        </div>
        }
      </div>

      <div dialog-actions>
        <button mat-button type="button" (click)="cancel()">Cancel</button>
      </div>
    </app-material-custom-dialog>
  `,
  styles: [`
    .note {
      font-size: 0.9em;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 16px;
    }
    .status-text {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 8px;
      font-size: 0.85em;
      min-height: 1.2em;
    }
    .details-text {
      margin-top: 4px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.78em;
      overflow-wrap: anywhere;
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
  details = signal('');
  private readonly progressTracker = new AiModelDownloadProgressTracker(this.data.model);

  constructor() {
    this.dialogRef.disableClose = true;
  }

  updateProgress(data: unknown) {
    const progress = this.progressTracker.update(data);
    if (!progress) {
      return;
    }

    this.status.set(progress.status);
    this.progress.set(progress.progress ?? 0);

    const details: string[] = [];
    if (progress.file) {
      details.push(progress.file);
    }

    if (progress.loadedBytes !== null && progress.totalBytes !== null && progress.totalBytes > 0) {
      details.push(`${this.formatFileSize(progress.loadedBytes)} of ${this.formatFileSize(progress.totalBytes)}`);
    } else if (progress.loadedBytes !== null) {
      details.push(this.formatFileSize(progress.loadedBytes));
    }

    this.details.set(details.join(' · '));
  }

  cancel() {
    this.dialogRef.close(false);
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
  }
}
