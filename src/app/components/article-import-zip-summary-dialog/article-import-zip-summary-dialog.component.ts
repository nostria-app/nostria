import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CustomDialogRef } from '../../services/custom-dialog.service';

export interface ArticleZipImportMediaSummaryItem {
  path: string;
  size: number;
  mimeType: string;
}

export interface ArticleZipImportSummaryDialogData {
  eventKind: number;
  dTag: string;
  title: string;
  mediaCount: number;
  totalMediaBytes: number;
  mediaFiles: ArticleZipImportMediaSummaryItem[];
}

@Component({
  selector: 'app-article-import-zip-summary-dialog',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './article-import-zip-summary-dialog.component.html',
  styleUrl: './article-import-zip-summary-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleImportZipSummaryDialogComponent {
  private dialogRef = inject(
    CustomDialogRef<ArticleImportZipSummaryDialogComponent, boolean>
  );

  data: ArticleZipImportSummaryDialogData = {
    eventKind: 30023,
    dTag: '',
    title: '',
    mediaCount: 0,
    totalMediaBytes: 0,
    mediaFiles: [],
  };

  readonly previewFiles = computed(() => this.data.mediaFiles.slice(0, 12));
  readonly hiddenCount = computed(() => Math.max(0, this.data.mediaFiles.length - this.previewFiles().length));

  confirm(): void {
    this.dialogRef.close(true);
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  formatBytes(value: number): string {
    if (value <= 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const normalized = value / 1024 ** index;
    const display = normalized >= 10 || index === 0 ? normalized.toFixed(0) : normalized.toFixed(1);
    return `${display} ${units[index]}`;
  }
}
