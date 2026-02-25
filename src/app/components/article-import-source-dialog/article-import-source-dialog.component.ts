import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CustomDialogRef } from '../../services/custom-dialog.service';

export type ArticleImportSourceDialogResult =
  | { type: 'reference'; value: string }
  | { type: 'zip'; file: File }
  | null;

@Component({
  selector: 'app-article-import-source-dialog',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule],
  templateUrl: './article-import-source-dialog.component.html',
  styleUrl: './article-import-source-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleImportSourceDialogComponent {
  private dialogRef = inject(
    CustomDialogRef<ArticleImportSourceDialogComponent, ArticleImportSourceDialogResult>
  );

  readonly referenceInput = signal('');
  readonly selectedZipFile = signal<File | null>(null);
  readonly isZipDragOver = signal(false);

  onReferenceInput(value: string): void {
    this.referenceInput.set(value);
  }

  openZipPicker(fileInput: HTMLInputElement): void {
    fileInput.click();
  }

  onZipDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.isZipDragOver.set(true);
  }

  onZipDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isZipDragOver.set(true);
  }

  onZipDragLeave(event: DragEvent): void {
    event.preventDefault();

    const currentTarget = event.currentTarget as HTMLElement | null;
    const relatedTarget = event.relatedTarget as Node | null;
    if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
      return;
    }

    this.isZipDragOver.set(false);
  }

  onZipDrop(event: DragEvent, fileInput: HTMLInputElement): void {
    event.preventDefault();
    this.isZipDragOver.set(false);

    const droppedFile = event.dataTransfer?.files?.[0];
    if (!droppedFile) {
      return;
    }

    this.setZipFileIfValid(droppedFile, fileInput);
  }

  onZipFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    this.setZipFileIfValid(file, input);
  }

  clearZipSelection(fileInput: HTMLInputElement): void {
    this.selectedZipFile.set(null);
    this.isZipDragOver.set(false);
    fileInput.value = '';
  }

  private setZipFileIfValid(file: File, fileInput: HTMLInputElement): void {
    const isZipByType = file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
    const isZipByName = file.name.toLowerCase().endsWith('.zip');

    if (!isZipByType && !isZipByName) {
      this.selectedZipFile.set(null);
      fileInput.value = '';
      return;
    }

    this.selectedZipFile.set(file);
  }

  importReference(): void {
    const value = this.referenceInput().trim();
    if (!value) {
      return;
    }

    this.dialogRef.close({ type: 'reference', value });
  }

  importZip(): void {
    const file = this.selectedZipFile();
    if (!file) {
      return;
    }

    this.dialogRef.close({ type: 'zip', file });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
