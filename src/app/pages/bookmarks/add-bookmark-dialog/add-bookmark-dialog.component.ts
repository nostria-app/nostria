import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { LoggerService } from '../../../services/logger.service';
import { BookmarkType } from '../../../services/bookmark.service';

export interface AddBookmarkData {
  url: string;
  title?: string;
  description?: string;
  type: BookmarkType;
}

@Component({
  selector: 'app-add-bookmark-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
  ],
  templateUrl: './add-bookmark-dialog.component.html',
  styleUrl: './add-bookmark-dialog.component.scss',
})
export class AddBookmarkDialogComponent {
  private logger = inject(LoggerService);
  private dialogRef = inject(MatDialogRef<AddBookmarkDialogComponent>);

  url = signal('');
  title = signal('');
  description = signal('');
  selectedType = signal<BookmarkType>('r');

  bookmarkTypes: { value: BookmarkType; label: string; icon: string }[] = [
    { value: 'r', label: 'Website', icon: 'link' },
    { value: 'e', label: 'Note', icon: 'event' },
    { value: 'a', label: 'Article', icon: 'article' },
  ];

  isUrlValid = signal(true);

  constructor() {
    this.logger.debug('AddBookmarkDialog initialized');
  }

  validateUrl(): void {
    const urlValue = this.url().trim();
    if (!urlValue) {
      this.isUrlValid.set(false);
      return;
    }

    // For event IDs (hex strings) or article references
    if (this.selectedType() === 'e' || this.selectedType() === 'a') {
      this.isUrlValid.set(urlValue.length > 0);
      return;
    }

    // For URLs, do basic validation
    try {
      new URL(urlValue);
      this.isUrlValid.set(true);
    } catch {
      this.isUrlValid.set(false);
    }
  }

  onTypeChange(): void {
    this.validateUrl();
  }

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    this.validateUrl();

    if (!this.isUrlValid()) {
      return;
    }

    const result: AddBookmarkData = {
      url: this.url().trim(),
      title: this.title().trim() || undefined,
      description: this.description().trim() || undefined,
      type: this.selectedType(),
    };

    this.logger.debug('Saving bookmark:', result);
    this.dialogRef.close(result);
  }

  canSave(): boolean {
    return this.url().trim().length > 0 && this.isUrlValid();
  }
}
