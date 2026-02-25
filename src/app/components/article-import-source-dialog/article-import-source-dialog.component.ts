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
  | { type: 'folder'; files: { relativePath: string; file: File }[]; folderName: string }
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
  readonly selectedFolderFiles = signal<{ relativePath: string; file: File }[]>([]);
  readonly selectedFolderName = signal<string | null>(null);
  readonly isZipDragOver = signal(false);
  readonly zipWarning = signal<string | null>(null);
  readonly supportsDragAndDrop = signal(false);

  constructor() {
    if (typeof window !== 'undefined') {
      const isMobileLike = window.matchMedia('(hover: none), (pointer: coarse)').matches;
      this.supportsDragAndDrop.set(!isMobileLike);
    }
  }

  onReferenceInput(value: string): void {
    this.referenceInput.set(value);
  }

  openZipPicker(fileInput: HTMLInputElement): void {
    fileInput.click();
  }

  openFolderPicker(folderInput: HTMLInputElement): void {
    folderInput.click();
  }

  onZipDragEnter(event: DragEvent): void {
    if (!this.supportsDragAndDrop()) {
      return;
    }

    event.preventDefault();
    this.isZipDragOver.set(true);
  }

  onZipDragOver(event: DragEvent): void {
    if (!this.supportsDragAndDrop()) {
      return;
    }

    event.preventDefault();
    this.isZipDragOver.set(true);
  }

  onZipDragLeave(event: DragEvent): void {
    if (!this.supportsDragAndDrop()) {
      return;
    }

    event.preventDefault();

    const currentTarget = event.currentTarget as HTMLElement | null;
    const relatedTarget = event.relatedTarget as Node | null;
    if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
      return;
    }

    this.isZipDragOver.set(false);
  }

  onZipDrop(event: DragEvent, fileInput: HTMLInputElement): void {
    if (!this.supportsDragAndDrop()) {
      return;
    }

    event.preventDefault();
    this.isZipDragOver.set(false);

    const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
    if (droppedFiles.length === 0) {
      return;
    }

    const droppedZip = droppedFiles.find(file => this.isZipFile(file));
    const hasDirectory = this.isDirectoryDrop(event);

    if (droppedZip) {
      this.setZipFileIfValid(droppedZip, fileInput);
      return;
    }

    if (hasDirectory || droppedFiles.length > 1) {
      this.setFolderFilesFromDroppedFiles(droppedFiles, fileInput);
      return;
    }

    this.zipWarning.set('Only .zip files or folders containing event.json are supported for package import.');
    this.selectedZipFile.set(null);
    this.selectedFolderFiles.set([]);
    this.selectedFolderName.set(null);
    fileInput.value = '';
  }

  onZipFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    this.setZipFileIfValid(file, input);
  }

  onFolderSelected(event: Event, zipInput: HTMLInputElement): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      return;
    }

    const mappedFiles = files.map(file => ({
      relativePath: this.normalizeRelativePath(file.webkitRelativePath || file.name),
      file,
    }));

    const folderName = this.extractFolderName(mappedFiles.map(item => item.relativePath)) || 'Imported Folder';
    this.selectedFolderFiles.set(mappedFiles);
    this.selectedFolderName.set(folderName);
    this.selectedZipFile.set(null);
    this.zipWarning.set(null);
    zipInput.value = '';
  }

  clearZipSelection(fileInput: HTMLInputElement): void {
    this.selectedZipFile.set(null);
    this.selectedFolderFiles.set([]);
    this.selectedFolderName.set(null);
    this.isZipDragOver.set(false);
    this.zipWarning.set(null);
    fileInput.value = '';
  }

  private setZipFileIfValid(file: File, fileInput: HTMLInputElement): void {
    const isZipByType = file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
    const isZipByName = file.name.toLowerCase().endsWith('.zip');

    if (!isZipByType && !isZipByName) {
      this.selectedZipFile.set(null);
      this.selectedFolderFiles.set([]);
      this.selectedFolderName.set(null);
      this.zipWarning.set('Only .zip files are supported for package import.');
      fileInput.value = '';
      return;
    }

    this.selectedZipFile.set(file);
    this.selectedFolderFiles.set([]);
    this.selectedFolderName.set(null);
    this.zipWarning.set(null);
  }

  private setFolderFilesFromDroppedFiles(files: File[], zipInput: HTMLInputElement): void {
    const mappedFiles = files.map(file => ({
      relativePath: this.normalizeRelativePath(file.webkitRelativePath || file.name),
      file,
    }));

    const hasEventJson = mappedFiles.some(item => item.relativePath.toLowerCase().endsWith('event.json'));
    if (!hasEventJson) {
      this.zipWarning.set('Dropped folder does not contain event.json.');
      this.selectedFolderFiles.set([]);
      this.selectedFolderName.set(null);
      this.selectedZipFile.set(null);
      return;
    }

    const folderName = this.extractFolderName(mappedFiles.map(item => item.relativePath)) || 'Dropped Folder';
    this.selectedFolderFiles.set(mappedFiles);
    this.selectedFolderName.set(folderName);
    this.selectedZipFile.set(null);
    this.zipWarning.set(null);
    zipInput.value = '';
  }

  private isDirectoryDrop(event: DragEvent): boolean {
    const items = event.dataTransfer?.items;
    if (!items || items.length === 0) {
      return false;
    }

    for (const item of Array.from(items)) {
      const maybeEntry = item as DataTransferItem & {
        webkitGetAsEntry?: () => { isDirectory?: boolean } | null;
      };

      const entry = maybeEntry.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        return true;
      }
    }

    return false;
  }

  private normalizeRelativePath(path: string): string {
    return path
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\//, '')
      .trim();
  }

  private extractFolderName(paths: string[]): string | null {
    for (const path of paths) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length > 1) {
        return parts[0];
      }
    }

    return null;
  }

  private isZipFile(file: File): boolean {
    const isZipByType = file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
    const isZipByName = file.name.toLowerCase().endsWith('.zip');
    return isZipByType || isZipByName;
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

  importFolder(): void {
    const files = this.selectedFolderFiles();
    if (files.length === 0) {
      return;
    }

    this.dialogRef.close({
      type: 'folder',
      files,
      folderName: this.selectedFolderName() || 'Imported Folder',
    });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
