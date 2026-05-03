import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CustomDialogRef } from '../../../services/custom-dialog.service';
import { OpenGraphService } from '../../../services/opengraph.service';
import { WebBookmark, WebBookmarkService } from '../../../services/web-bookmark.service';
import { SocialPreviewComponent } from '../../../components/social-preview/social-preview.component';

export interface SaveWebBookmarkDialogData {
  bookmark?: WebBookmark;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-save-web-bookmark-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    SocialPreviewComponent,
  ],
  templateUrl: './save-web-bookmark-dialog.component.html',
  styleUrl: './save-web-bookmark-dialog.component.scss',
})
export class SaveWebBookmarkDialogComponent implements OnInit, OnDestroy {
  private readonly dialogRef = inject(CustomDialogRef<SaveWebBookmarkDialogComponent, boolean>);
  private readonly openGraph = inject(OpenGraphService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly webBookmarks = inject(WebBookmarkService);
  private previewLookupTimer: ReturnType<typeof setTimeout> | null = null;
  private previewLookupToken = 0;

  data?: SaveWebBookmarkDialogData;
  readonly separatorKeysCodes = [ENTER, COMMA] as const;

  readonly urlInput = signal('');
  readonly titleInput = signal('');
  readonly descriptionInput = signal('');
  readonly topicInput = signal('');
  readonly topics = signal<string[]>([]);
  readonly saving = signal(false);
  readonly previewLoading = signal(false);
  readonly previewHint = signal('');

  readonly normalizedUrl = signal('');

  ngOnInit(): void {
    const bookmark = this.data?.bookmark;
    if (!bookmark) {
      return;
    }

    this.urlInput.set(bookmark.url);
    this.normalizedUrl.set(bookmark.url);
    this.titleInput.set(bookmark.title);
    this.descriptionInput.set(bookmark.description);
    this.topics.set(bookmark.tags);
  }

  ngOnDestroy(): void {
    this.cancelPreviewLookup();
  }

  onUrlInputChange(value: string): void {
    this.urlInput.set(value);
    this.schedulePreviewLookup(value);
  }

  addTopic(event?: MatChipInputEvent): void {
    const rawValue = event?.value ?? this.topicInput();
    const nextTopics = rawValue
      .split(/[,#\s]+/)
      .map(topic => topic.trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean);

    if (nextTopics.length === 0) {
      event?.chipInput?.clear();
      this.topicInput.set('');
      return;
    }

    this.topics.update(current => [...new Set([...current, ...nextTopics])]);
    event?.chipInput?.clear();
    this.topicInput.set('');
  }

  removeTopic(topic: string): void {
    this.topics.update(current => current.filter(item => item !== topic));
  }

  async save(): Promise<void> {
    if (this.saving()) {
      return;
    }

    const url = this.urlInput().trim();
    if (!url) {
      this.snackBar.open('Add a URL first', 'Close', { duration: 2500 });
      return;
    }

    this.addTopic();
    this.saving.set(true);

    try {
      const success = await this.webBookmarks.saveBookmark({
        url,
        title: this.titleInput(),
        description: this.descriptionInput(),
        tags: this.topics(),
      });

      if (!success) {
        this.snackBar.open('Could not publish bookmark', 'Close', { duration: 3500 });
        return;
      }

      this.snackBar.open('Social bookmark published', 'Close', { duration: 2500 });
      this.dialogRef.close(true);
    } finally {
      this.saving.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  private schedulePreviewLookup(value: string): void {
    const token = ++this.previewLookupToken;
    this.previewHint.set('');

    if (this.previewLookupTimer) {
      clearTimeout(this.previewLookupTimer);
      this.previewLookupTimer = null;
    }

    const normalized = this.webBookmarks.normalizeUrl(value);
    this.normalizedUrl.set(normalized?.url ?? '');
    if (!normalized) {
      this.previewLoading.set(false);
      return;
    }

    this.previewLookupTimer = setTimeout(() => {
      void this.loadPreviewMetadata(normalized.url, token);
    }, 550);
  }

  private async loadPreviewMetadata(url: string, token: number): Promise<void> {
    this.previewLoading.set(true);

    try {
      const preview = await this.openGraph.getOpenGraphData(url);
      const currentUrl = this.webBookmarks.normalizeUrl(this.urlInput())?.url;
      if (token !== this.previewLookupToken || currentUrl !== url || preview.error) {
        return;
      }

      const title = preview.title?.trim();
      const description = preview.description?.trim();
      let hydrated = false;

      if (title && !this.titleInput().trim()) {
        this.titleInput.set(title);
        hydrated = true;
      }

      if (description && !this.descriptionInput().trim()) {
        this.descriptionInput.set(description);
        hydrated = true;
      }

      if (hydrated) {
        this.previewHint.set('Link details added');
      }
    } finally {
      if (token === this.previewLookupToken) {
        this.previewLoading.set(false);
      }
    }
  }

  private cancelPreviewLookup(): void {
    this.previewLookupToken++;
    this.previewLoading.set(false);
    this.previewHint.set('');

    if (this.previewLookupTimer) {
      clearTimeout(this.previewLookupTimer);
      this.previewLookupTimer = null;
    }
  }
}
