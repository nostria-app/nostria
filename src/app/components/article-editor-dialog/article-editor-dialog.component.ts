import {
  Component,
  inject,
  signal,
  effect,
  computed,
  untracked,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewInit,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { isPlatformBrowser, Location } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { NostrService } from '../../services/nostr.service';
import { DataService } from '../../services/data.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { MatCardModule } from '@angular/material/card';
import { AccountStateService } from '../../services/account-state.service';
import { RichTextEditorComponent } from '../rich-text-editor/rich-text-editor.component';
import { nip19, type Event as NostrEvent } from 'nostr-tools';
import { DecodedNaddr } from 'nostr-tools/nip19';
import { AccountRelayService } from '../../services/relays/account-relay';
import { Cache } from '../../services/cache';
import { NostrRecord } from '../../interfaces';
import { MediaService } from '../../services/media.service';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ImageUrlDialogComponent } from '../image-url-dialog/image-url-dialog.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import type { ArticleData } from '../article-display/article-display.component';
import { ArticleDisplayComponent } from '../article-display/article-display.component';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { AiToolsDialogComponent } from '../ai-tools-dialog/ai-tools-dialog.component';
import { AiService } from '../../services/ai.service';
import { SpeechService } from '../../services/speech.service';
import { normalizeMarkdownLinkDestinations } from '../../services/format/utils';
import { ArticleReferencePickerResult } from '../article-reference-picker-dialog/article-reference-picker-dialog.component';
import { TextInputDialogComponent } from '../text-input-dialog/text-input-dialog.component';

export interface ArticleEditorDialogData {
  articleId?: string;
  articleEvent?: NostrEvent;
}

interface ArticleDraft {
  title: string;
  summary: string;
  image: string;
  content: string;
  tags: string[];
  publishedAt?: number;
  dTag: string;
  lastSaved?: number; // Timestamp for auto-save
  selectedImageFile?: File; // Store selected image file for upload
  imageUrl?: string; // Store URL input separately
}

interface ArticleAutoDraft {
  title: string;
  summary: string;
  image: string;
  content: string;
  tags: string[];
  dTag: string;
  lastModified: number;
  autoDTagEnabled: boolean;
}

@Component({
  selector: 'app-article-editor-dialog',
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTabsModule,
    MatToolbarModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDialogModule,
    MatCardModule,
    RichTextEditorComponent,
    MatTooltipModule,
    MatSlideToggleModule,
    MatMenuModule,
    ArticleDisplayComponent,
  ],
  templateUrl: './article-editor-dialog.component.html',
  styleUrl: './article-editor-dialog.component.scss',
})
export class ArticleEditorDialogComponent implements OnDestroy, AfterViewInit {
  @ViewChild('titleInput') titleInput?: ElementRef<HTMLInputElement>;

  dialogRef?: CustomDialogRef<ArticleEditorDialogComponent>;
  data: ArticleEditorDialogData = {};

  private router = inject(Router);
  private location = inject(Location);
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private nostrService = inject(NostrService);
  private dataService = inject(DataService);
  private accountRelay = inject(AccountRelayService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private aiService = inject(AiService);
  private sanitizer = inject(DomSanitizer);
  private accountState = inject(AccountStateService);
  private media = inject(MediaService);
  private localStorage = inject(LocalStorageService);
  private customDialog = inject(CustomDialogService);
  private cache = inject(Cache);
  private readonly DEFAULT_DIALOG_WIDTH = '920px';
  private readonly SPLIT_DIALOG_WIDTH = '1840px';

  // Signals
  autoDTagEnabled = signal(true);
  isEditMode = signal(false);
  isLoadingArticle = signal(false);
  publishInitiated = false;

  // Auto-save configuration
  private readonly AUTO_SAVE_INTERVAL = 2000; // Save every 2 seconds
  private autoSaveTimer?: ReturnType<typeof setTimeout>;

  // Editor state
  isLoading = signal(false);
  isPublishing = signal(false);
  isRecording = signal(false);
  isTranscribing = signal(false);
  private speechService = inject(SpeechService);

  // Article data
  article = signal<ArticleDraft>({
    title: '',
    summary: '',
    image: '',
    content: '',
    tags: [],
    dTag: this.generateUniqueId(),
  });

  // Auto-dTag feature
  suggestedDTag = computed(() => {
    const title = this.article().title;
    if (!title.trim()) return '';

    // Convert to lowercase, replace spaces with dashes, remove special characters
    return title
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .replace(/[^\w-]+/g, '') // Remove all non-word chars (except dashes)
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .replace(/^-+/, '') // Trim dashes from start
      .replace(/-+$/, ''); // Trim dashes from end
  });

  // Form validation
  isValid = computed(() => {
    const art = this.article();
    return (
      art.title.trim().length > 0 && art.content.trim().length > 0 && art.dTag.trim().length > 0
    );
  });

  // Draft validation - more lenient, only requires some content
  isDraftValid = computed(() => {
    const art = this.article();
    return (
      art.title.trim().length > 0 || art.content.trim().length > 0 || art.summary.trim().length > 0
    );
  });

  // Markdown preview with nostr: reference handling
  markdownHtml = computed(() => {
    const content = normalizeMarkdownLinkDestinations(this.article().content);
    if (!content.trim()) return this.sanitizer.bypassSecurityTrustHtml('');

    try {
      // Configure marked with the same options used throughout the app
      marked.use({
        gfm: true,
        breaks: true, // Enable line breaks for consistency
        pedantic: false,
      });

      // First, parse markdown to HTML
      let html = marked.parse(content) as string;

      // Then, process nostr: references to create clickable links with profile names
      // Note: This is synchronous, so we use cached profiles only
      html = this.processNostrReferences(html);

      return this.sanitizer.bypassSecurityTrustHtml(html);
    } catch (error) {
      console.error('Error parsing markdown:', error);
      return this.sanitizer.bypassSecurityTrustHtml('<p>Error parsing markdown</p>');
    }
  });

  // Computed property for preview - creates ArticleData from current draft
  previewArticleData = computed<ArticleData>(() => {
    const art = this.article();
    const displayImage = this.previewImage() || art.image;
    return {
      title: art.title || 'Untitled Article',
      summary: art.summary,
      image: displayImage,
      parsedContent: this.markdownHtml(),
      contentLoading: false,
      hashtags: art.tags,
      authorPubkey: this.accountState.pubkey() || '',
      publishedAt: null,
      publishedAtTimestamp: 0,
      link: '',
      id: '',
      isJsonContent: false,
      jsonData: null,
    };
  });

  // Tag input
  newTag = signal('');

  // Image upload state
  useImageUrl = signal(true); // Default to URL mode
  previewImage = signal<string | null>(null);
  hasMediaServers = computed(() => this.media.mediaServers().length > 0);
  showArticleImage = signal(false);
  showPreview = signal(false);
  showSplitView = signal(false);
  isLargeScreen = signal(false);
  canUseSplitView = computed(() => this.isLargeScreen());

  private splitViewMediaQuery?: MediaQueryList;
  private readonly splitViewMediaQueryHandler = (event: MediaQueryListEvent): void => {
    this.isLargeScreen.set(event.matches);
    if (!event.matches) {
      this.showSplitView.set(false);
    }
  };

  // Track editor mode to restore after preview
  editorIsRichTextMode = signal(true);

  // Drag and drop state for featured image
  isFeaturedImageDragOver = signal(false);
  private featuredImageDragCounter = 0;
  private readonly base64ImageDataUrlRegex = /^data:image\/[a-zA-Z0-9.+-]+;base64,/i;
  private readonly articleUrlPattern = /\/a\/(npub1[02-9ac-hj-np-z]+)\/([^/?#]+)/i;

  constructor() {
    this.initializeSplitViewSupport();

    effect(() => {
      const isSplitEnabled = this.showSplitView();
      this.updateDialogWidth(isSplitEnabled);
    });

    effect(() => {
      this.article().title;
      this.isEditMode();
      this.syncDialogTitle();
    });

    // Check if we're editing an existing article
    effect(() => {
      const articleId = this.data.articleId;
      const articleEvent = this.data.articleEvent;
      if (articleId && typeof articleId === 'string') {
        this.isEditMode.set(true);

        untracked(async () => {
          await this.loadArticle(articleId, articleEvent);
        });
      } else {
        // Only load auto-saved draft for completely new articles (not editing existing ones)
        this.isEditMode.set(false);
        // Defer auto-draft loading to ensure it doesn't interfere with article loading
        setTimeout(() => {
          if (!this.isEditMode()) {
            this.loadAutoDraft();
          }
        }, 0);
      }
    });

    // Show article image section if there's an image
    effect(() => {
      const image = this.article().image;
      if (image && image.trim()) {
        this.showArticleImage.set(true);
      }
    });

    // Effect to reload draft when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();

      // Only load draft if we have an account and we're not in edit mode
      if (pubkey && !this.isEditMode() && !this.isLoadingArticle()) {
        untracked(() => {
          // Clear current article and load the new account's draft
          this.loadAutoDraft();
        });
      }
    });
  }

  ngAfterViewInit() {
    // Focus the title input when the editor opens
    setTimeout(() => {
      this.titleInput?.nativeElement.focus();
    }, 0);

    this.syncDialogTitle();
  }

  ngOnDestroy() {
    if (this.splitViewMediaQuery) {
      this.splitViewMediaQuery.removeEventListener('change', this.splitViewMediaQueryHandler);
    }

    // Clear auto-save timer on destroy
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
  }

  private initializeSplitViewSupport(): void {
    if (!this.isBrowser) {
      return;
    }

    this.splitViewMediaQuery = window.matchMedia('(min-width: 1280px)');
    this.isLargeScreen.set(this.splitViewMediaQuery.matches);
    this.splitViewMediaQuery.addEventListener('change', this.splitViewMediaQueryHandler);
  }

  private updateDialogWidth(isSplitEnabled: boolean): void {
    const width = isSplitEnabled ? this.SPLIT_DIALOG_WIDTH : this.DEFAULT_DIALOG_WIDTH;
    this.dialogRef?.updateWidth(width);
    this.dialogRef?.updateMaxWidth('100vw');
  }

  private generateUniqueId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private getAutoDraftKey(): string {
    const pubkey = this.accountState.pubkey();
    return `article-auto-draft-${pubkey}`;
  }

  private scheduleAutoSave(): void {
    // Clear existing timer
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    // Only schedule if there's meaningful content
    const article = this.article();
    const hasContent =
      article.title.trim() ||
      article.content.trim() ||
      article.summary.trim() ||
      article.image.trim() ||
      article.tags.length > 0;

    if (!hasContent) return;

    // Schedule new auto-save
    this.autoSaveTimer = setTimeout(() => {
      this.saveAutoDraft();
    }, this.AUTO_SAVE_INTERVAL);
  }

  private scheduleAutoSaveIfNeeded(): void {
    const pubkey = this.accountState.pubkey();
    const isEdit = this.isEditMode();
    const isLoadingArticle = this.isLoadingArticle();

    // Don't auto-save while loading an existing article
    if (isLoadingArticle) return;

    // Only auto-save for new articles (not when editing existing ones)
    if (!isEdit && pubkey) {
      this.scheduleAutoSave();
    }
  }

  private saveAutoDraft(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey || this.isEditMode()) return;

    const article = this.article();

    // Check if there's meaningful content
    const hasContent =
      article.title.trim() ||
      article.content.trim() ||
      article.summary.trim() ||
      article.image.trim() ||
      article.tags.length > 0;

    if (!hasContent) return;

    const autoDraft: ArticleAutoDraft = {
      title: article.title,
      summary: article.summary,
      image: article.image,
      content: article.content,
      tags: [...article.tags],
      dTag: article.dTag,
      lastModified: Date.now(),
      autoDTagEnabled: this.autoDTagEnabled(),
    };

    const key = this.getAutoDraftKey();

    // Check if this is meaningfully different from the last save
    const previousDraft = this.localStorage.getObject<ArticleAutoDraft>(key);
    if (previousDraft) {
      const isSimilar =
        previousDraft.title === autoDraft.title &&
        previousDraft.content === autoDraft.content &&
        previousDraft.summary === autoDraft.summary &&
        previousDraft.image === autoDraft.image &&
        JSON.stringify(previousDraft.tags) === JSON.stringify(autoDraft.tags);

      // If content is very similar, don't save again (prevents spam)
      if (isSimilar) return;
    }

    this.localStorage.setObject(key, autoDraft);

    // Only show notification for the first auto-save or significant changes
    if (!previousDraft) {
      // Silent auto-save, no notification needed for regular saves
      console.debug('Article auto-draft saved');
    }
  }

  private loadAutoDraft(): void {
    const pubkey = this.accountState.pubkey();
    // Don't load auto-draft when editing existing articles or when currently loading an article
    if (!pubkey || this.isEditMode() || this.isLoadingArticle()) return;

    const key = this.getAutoDraftKey();
    const autoDraft = this.localStorage.getObject<ArticleAutoDraft>(key);

    if (autoDraft) {
      // Check if draft is not too old (7 days)
      const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
      const isExpired = Date.now() - autoDraft.lastModified > sevenDaysInMs;

      if (!isExpired) {
        this.article.set({
          title: autoDraft.title,
          summary: autoDraft.summary,
          image: autoDraft.image,
          content: autoDraft.content,
          tags: [...autoDraft.tags],
          dTag: autoDraft.dTag,
        });
        this.previewImage.set(autoDraft.image || null);

        this.autoDTagEnabled.set(autoDraft.autoDTagEnabled);

        // Show restoration message if there's meaningful content
        if (autoDraft.title.trim() || autoDraft.content.trim() || autoDraft.summary.trim()) {
          this.snackBar.open('Draft restored from previous session', 'Dismiss', {
            duration: 4000,
            panelClass: 'info-snackbar',
          });
        }
      } else {
        // Remove expired draft
        this.clearAutoDraft();
      }
    }
  }

  private clearAutoDraft(): void {
    const key = this.getAutoDraftKey();
    this.localStorage.removeItem(key);
  }

  async loadArticle(articleId: string, sourceEvent?: NostrEvent): Promise<void> {
    try {
      this.isLoading.set(true);
      this.isLoadingArticle.set(true); // Mark that we're loading an existing article

      let kind = 30023; // Default to article kind
      let pubkey = this.accountState.pubkey();

      if (articleId.startsWith('naddr')) {
        let naddr: DecodedNaddr;
        try {
          naddr = nip19.decode(articleId) as DecodedNaddr;

          if (naddr.data.kind !== 30023 && naddr.data.kind !== 30024) {
            this.snackBar.open('Invalid article kind', 'Close', {
              duration: 3000,
            });
            this.dialogRef?.close();
            return;
          }
        } catch (error) {
          console.warn('Failed to decode article naddr:', articleId, error);
          this.snackBar.open('Invalid article address format', 'Close', {
            duration: 3000,
          });
          this.dialogRef?.close();
          return;
        }

        if (naddr.data.kind) {
          kind = naddr.data.kind;
        }

        if (naddr.data.pubkey) {
          pubkey = naddr.data.pubkey;
        }

        articleId = naddr.data.identifier;
      }

      if (!pubkey) {
        this.snackBar.open('Please log in to edit articles', 'Close', {
          duration: 3000,
        });
        this.dialogRef?.close();
        return;
      }

      if (sourceEvent) {
        this.applyArticleEventToDraft(sourceEvent, articleId);
        return;
      }

      // Since we're doing editing here, we'll save and cache locally.
      const record = await this.dataService.getEventByPubkeyAndKindAndReplaceableEvent(
        pubkey,
        kind,
        articleId,
        {
          cache: false,
          save: false,
        }
      );

      if (record?.event) {
        this.applyArticleEventToDraft(record.event, articleId);
      } else {
        this.snackBar.open('Article not found', 'Close', { duration: 3000 });
        this.dialogRef?.close();
      }
    } catch (error) {
      console.error('Error loading article:', error);
      this.snackBar.open('Error loading article', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
      this.isLoadingArticle.set(false); // Clear the loading flag
    }
  }

  private applyArticleEventToDraft(event: NostrEvent, fallbackDTag: string): void {
    const tags = event.tags;
    const image = this.getTagValue(tags, 'image') || '';

    this.article.set({
      title: this.getTagValue(tags, 'title') || '',
      summary: this.getTagValue(tags, 'summary') || '',
      image,
      content: event.content || '',
      tags: tags.filter(tag => tag[0] === 't').map(tag => tag[1]) || [],
      publishedAt: parseInt(this.getTagValue(tags, 'published_at') || '0', 10) || undefined,
      dTag: this.getTagValue(tags, 'd') || fallbackDTag,
      selectedImageFile: undefined,
      imageUrl: image,
    });

    this.previewImage.set(image || null);
  }

  private getTagValue(tags: string[][], tagName: string): string | undefined {
    const tag = tags.find(t => t[0] === tagName);
    return tag ? tag[1] : undefined;
  }

  addTag(): void {
    const tag = this.newTag().trim().toLowerCase();
    if (tag && !this.article().tags.includes(tag)) {
      this.article.update(art => ({
        ...art,
        tags: [...art.tags, tag],
      }));
      this.newTag.set('');
    }
  }

  removeTag(tag: string): void {
    this.article.update(art => ({
      ...art,
      tags: art.tags.filter(t => t !== tag),
    }));
  }

  onTagKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addTag();
    }
  }

  async saveDraft(): Promise<void> {
    if (!this.isDraftValid()) {
      this.snackBar.open('Please add some content to save as draft', 'Close', {
        duration: 3000,
      });
      return;
    }

    try {
      // Don't set isPublishing here, let publishArticle handle it
      // This prevents the guard in publishArticle from blocking execution
      const event = await this.publishArticle(30024); // Draft kind

      if (event) {
        this.snackBar.open('Draft saved successfully', 'Close', {
          duration: 3000,
        });

        // Close dialog after successful save
        this.dialogRef?.close(event);
      }
    } catch (error) {
      console.error('Error saving draft:', error);
      this.snackBar.open('Error saving draft', 'Close', { duration: 3000 });
    }
  }

  async publishArticle(kind = 30023): Promise<unknown | null> {
    // Guard against double-clicks and race conditions
    if (this.isPublishing() || this.publishInitiated) {
      return null;
    }

    // Set guard flag immediately
    this.publishInitiated = true;

    // Use different validation for drafts vs final articles
    if (kind === 30023 && !this.isValid()) {
      this.publishInitiated = false; // Reset on validation failure
      this.snackBar.open('Please fill in required fields', 'Close', {
        duration: 3000,
      });
      return null;
    } else if (kind === 30024 && !this.isDraftValid()) {
      this.publishInitiated = false; // Reset on validation failure
      this.snackBar.open('Please add some content to save as draft', 'Close', {
        duration: 3000,
      });
      return null;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.publishInitiated = false; // Reset on validation failure
      this.snackBar.open('Please log in to publish', 'Close', {
        duration: 3000,
      });
      return null;
    }

    try {
      this.isPublishing.set(true);
      const art = this.article();
      const normalizedContent = normalizeMarkdownLinkDestinations(art.content);

      // Handle image upload if selected file exists or image is base64 data URL
      let imageUrl = art.image.trim();
      if (art.selectedImageFile || this.isBase64ImageDataUrl(imageUrl)) {
        try {
          let fileToUpload = art.selectedImageFile;
          if (!fileToUpload) {
            fileToUpload = this.dataUrlToFile(imageUrl);
          }

          const mediaServers = await this.getMediaServersForUpload();
          if (mediaServers.length === 0) {
            throw new Error('No media server configured. Please add a media server before publishing.');
          }

          const uploadResult = await this.media.uploadFile(
            fileToUpload,
            false,
            mediaServers
          );

          if (!uploadResult.item) {
            throw new Error(
              `Failed to upload image: ${uploadResult.message || 'Unknown error'}`
            );
          }

          imageUrl = uploadResult.item.url;
          // Update the article with the uploaded URL
          this.article.update(a => ({ ...a, image: imageUrl, selectedImageFile: undefined }));
          this.previewImage.set(imageUrl);
        } catch (error) {
          console.error('Error uploading image:', error);
          this.snackBar.open(
            `Failed to upload image: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'Close',
            { duration: 5000 }
          );
          this.isPublishing.set(false);
          return null;
        }
      }

      // Ensure dTag has a value, generate one if empty (especially for drafts)
      let dTag = art.dTag.trim();
      if (!dTag) {
        dTag = this.generateUniqueId();
        this.article.update(a => ({ ...a, dTag }));
      }

      // Build tags array according to NIP-23
      const tags: string[][] = [['d', dTag]];

      // Add title and summary if they exist (required for final articles, optional for drafts)
      if (art.title.trim()) {
        tags.push(['title', art.title]);
      } else if (kind === 30023) {
        // For final articles, we need a title
        tags.push(['title', 'Untitled']);
      }

      if (art.summary.trim()) {
        tags.push(['summary', art.summary]);
      }

      if (imageUrl) {
        tags.push(['image', imageUrl]);
      }

      // Add published_at for first time publication
      if (!this.isEditMode() || !art.publishedAt) {
        const publishedAt = Math.floor(Date.now() / 1000);
        tags.push(['published_at', publishedAt.toString()]);
        this.article.update(a => ({ ...a, publishedAt }));
      } else if (art.publishedAt) {
        tags.push(['published_at', art.publishedAt.toString()]);
      }

      // Add topic tags
      art.tags.forEach(tag => {
        tags.push(['t', tag]);
      });

      // Parse NIP-27 references from content and add appropriate tags
      // This is optional according to NIP-27, but recommended for notifications
      this.extractNip27Tags(normalizedContent, tags);

      // Create the event
      const event = await this.nostrService.createEvent(kind, normalizedContent, tags);

      if (!event) {
        throw new Error('Failed to create event');
      }

      // Use the centralized publishing service which handles relay distribution
      // This ensures articles with mentions are published to all mentioned users' relays
      const result = await this.nostrService.signAndPublish(event);
      if (!result.success || !result.event) {
        throw new Error('Failed to publish event');
      }

      const signedEvent = result.event;

      // CRITICAL: Clear draft immediately after signing to prevent duplicate publishes
      // If user clicks publish again while this is processing, there's no draft to republish
      if (!this.isEditMode()) {
        this.clearAutoDraft();
      }

      const action = kind === 30024 ? 'Draft saved' : 'Article published';
      this.snackBar.open(`${action} successfully`, 'Close', { duration: 3000 });

      if (kind === 30023) {
        // Close dialog
        this.dialogRef?.close(signedEvent);

        // Navigate to the published article
        this.router.navigate(['/a', pubkey, art.dTag], {
          state: { event: signedEvent },
        });
      }

      return signedEvent;
    } catch (error) {
      console.error('Error publishing article:', error);
      this.snackBar.open('Error publishing article', 'Close', {
        duration: 3000,
      });
      return null;
    } finally {
      this.isPublishing.set(false);
      this.publishInitiated = false; // Reset guard flag
    }
  }

  async publish(): Promise<void> {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Publish Article',
        message: 'Are you sure you want to publish this article? It will be visible to everyone.',
        confirmText: 'Publish',
        cancelText: 'Cancel',
        confirmColor: 'primary',
      },
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        await this.publishArticle(30023);
      }
    });
  }

  cancel(): void {
    // Ask user if they want to keep the auto-draft when canceling
    const article = this.article();
    const hasContent = article.title.trim() || article.content.trim() || article.summary.trim();

    if (!this.isEditMode() && hasContent) {
      // Keep the auto-draft - user might want to continue later
      this.snackBar.open('Draft saved automatically. You can continue later.', 'Dismiss', {
        duration: 5000,
        panelClass: 'info-snackbar',
      });
    }

    this.dialogRef?.close();
  }

  resetDraft(): void {
    const article = this.article();
    const hasContent = article.title.trim() || article.content.trim() || article.summary.trim() || article.image.trim();

    if (hasContent) {
      const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: 'Reset Draft',
          message: 'Are you sure you want to reset the draft? All current content will be lost.',
          confirmText: 'Reset',
          cancelText: 'Cancel',
          confirmColor: 'warn' as const,
        },
      });

      dialogRef.afterClosed().subscribe((confirmed) => {
        if (confirmed) {
          this.performReset();
        }
      });
    } else {
      this.performReset();
    }
  }

  private performReset(): void {
    // Reset article to initial state
    this.article.set({
      title: '',
      summary: '',
      image: '',
      content: '',
      tags: [],
      dTag: this.generateUniqueId(),
    });
    this.previewImage.set(null);
    this.showArticleImage.set(false);

    // Clear auto-draft from storage
    this.clearAutoDraft();

    // Show confirmation
    this.snackBar.open('Draft reset successfully', 'Dismiss', {
      duration: 3000,
      panelClass: 'success-snackbar',
    });
  }

  updateTitle(value: string): void {
    this.article.update(art => ({ ...art, title: value }));
    this.syncDialogTitle();

    // Schedule auto-save directly instead of relying on effect
    this.scheduleAutoSaveIfNeeded();
  }

  private syncDialogTitle(): void {
    if (!this.dialogRef) {
      return;
    }

    const title = this.article().title.trim();
    const baseTitle = this.isEditMode() ? 'Edit Article' : 'New Article';
    const dialogTitle = title ? `${baseTitle} · ${title}` : baseTitle;
    this.dialogRef.updateTitle(dialogTitle);
  }

  onTitleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      // Focus on the rich text editor content
      // Use a small timeout to ensure the editor is ready
      setTimeout(() => {
        const editorContent = document.querySelector('.rich-text-content') as HTMLElement;
        if (editorContent) {
          editorContent.focus();
        }
      }, 0);
    }
  }

  updateSummary(value: string): void {
    this.article.update(art => ({ ...art, summary: value }));

    // Schedule auto-save directly instead of relying on effect
    this.scheduleAutoSaveIfNeeded();
  }

  updateImage(value: string): void {
    this.article.update(art => ({ ...art, image: value, imageUrl: value }));

    // Update preview if in URL mode
    if (this.useImageUrl()) {
      this.previewImage.set(value || null);
    }

    // Schedule auto-save directly instead of relying on effect
    this.scheduleAutoSaveIfNeeded();
  }

  // Handle file selection for article image
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      // Simple file type validation
      if (!file.type.includes('image/')) {
        this.snackBar.open('Please select a valid image file', 'Close', {
          duration: 3000,
        });
        return;
      }

      await this.uploadFeaturedImageFile(file);
    }
  }

  // Handle URL input for image
  onImageUrlChange(): void {
    const url = this.article()?.imageUrl || '';
    if (url && url.trim() !== '') {
      this.previewImage.set(url);
      // Update the main image field immediately
      this.article.update(art => ({ ...art, image: url, selectedImageFile: undefined }));
    } else {
      this.previewImage.set(null);
    }
  }

  // Toggle image input method
  toggleImageInputMethod(): void {
    const currentUrl = this.article()?.image || '';
    this.useImageUrl.update(current => !current);

    if (this.useImageUrl()) {
      // Switching to URL mode - preserve existing URL
      this.article.update(art => ({
        ...art,
        imageUrl: currentUrl,
        selectedImageFile: undefined,
      }));
      if (currentUrl) {
        this.previewImage.set(currentUrl);
      }
    } else {
      // Switching to file mode - clear file selection but keep URL for potential switch back
      this.article.update(art => ({
        ...art,
        selectedImageFile: undefined,
      }));
      this.previewImage.set(currentUrl || null);
    }
  }

  // Navigate to media settings
  navigateToMediaSettings(): void {
    this.router.navigate(['/media'], { queryParams: { tab: 'servers' } });
  }

  private hasConfiguredMediaServers(): boolean {
    return this.media.mediaServers().length > 0;
  }

  private showMediaServerWarning(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'No Media Server Configured',
        message: 'You need to configure a media server before selecting media. Would you like to set one up now?',
        confirmText: 'Setup Media Server',
        cancelText: 'Cancel',
        confirmColor: 'primary',
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
      }
    });
  }

  updateContent(value: string): void {
    this.article.update(art => ({ ...art, content: value }));

    // Schedule auto-save directly instead of relying on effect
    this.scheduleAutoSaveIfNeeded();
  }

  updateDTag(value: string): void {
    this.article.update(art => ({ ...art, dTag: value }));

    // Schedule auto-save directly instead of relying on effect
    this.scheduleAutoSaveIfNeeded();
  }

  toggleAutoDTagMode(): void {
    this.autoDTagEnabled.update(enabled => !enabled);
    // Apply auto-dTag when enabling
    if (this.autoDTagEnabled() && this.suggestedDTag()) {
      this.applyAutoDTag();
    }
  }

  toggleArticleImageSection(): void {
    this.showArticleImage.update(show => !show);
  }

  openFeaturedImageUpload(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (event: Event) => this.onFeaturedImageSelected(event);
    input.click();
  }

  openFeaturedImageUrl(): void {
    const dialogRef = this.dialog.open(ImageUrlDialogComponent, {
      width: '500px',
    });

    dialogRef.afterClosed().subscribe((url: string | undefined) => {
      if (url) {
        this.article.update(art => ({ ...art, image: url, selectedImageFile: undefined }));
        this.previewImage.set(url);
        this.showArticleImage.set(true);
      }
    });
  }

  async openFeaturedImageChooser(): Promise<void> {
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    const { MediaChooserDialogComponent } = await import('../media-chooser-dialog/media-chooser-dialog.component');
    type MediaChooserResult = import('../media-chooser-dialog/media-chooser-dialog.component').MediaChooserResult;

    const dialogRef = this.customDialog.open<typeof MediaChooserDialogComponent.prototype, MediaChooserResult>(
      MediaChooserDialogComponent,
      {
        title: 'Choose from Library',
        width: '700px',
        maxWidth: '95vw',
        data: {
          multiple: false,
          mediaType: 'images',
        },
      }
    );

    dialogRef.afterClosed$.subscribe(({ result }) => {
      const selected = result?.items?.[0];
      if (!selected) {
        return;
      }

      this.article.update(art => ({
        ...art,
        image: selected.url,
        selectedImageFile: undefined,
      }));
      this.previewImage.set(selected.url);
      this.showArticleImage.set(true);
    });
  }

  async onFeaturedImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      if (!file.type.includes('image/')) {
        this.snackBar.open('Please select a valid image file', 'Close', {
          duration: 3000,
        });
        return;
      }

      await this.uploadFeaturedImageFile(file);
    }
  }

  clearFeaturedImage(): void {
    this.article.update(art => ({
      ...art,
      image: '',
      imageUrl: '',
      selectedImageFile: undefined,
    }));
    this.previewImage.set(null);
    this.showArticleImage.set(false);
  }

  private isBase64ImageDataUrl(value: string): boolean {
    return this.base64ImageDataUrlRegex.test(value);
  }

  private dataUrlToFile(dataUrl: string): File {
    const [metadata, base64Data] = dataUrl.split(',');
    if (!metadata || !base64Data) {
      throw new Error('Invalid base64 image data');
    }

    const mimeMatch = metadata.match(/data:([^;]+);base64/i);
    const mimeType = mimeMatch?.[1] || 'image/png';
    const extension = mimeType.split('/')[1] || 'png';
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new File([bytes], `featured-image.${extension}`, { type: mimeType });
  }

  private async getMediaServersForUpload(): Promise<string[]> {
    let servers = this.media.mediaServers();
    if (servers.length > 0) {
      return servers;
    }

    await this.media.load();
    servers = this.media.mediaServers();
    return servers;
  }

  // Drag and drop handlers for featured image
  onFeaturedImageDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.featuredImageDragCounter++;
    if (this.featuredImageDragCounter === 1) {
      this.isFeaturedImageDragOver.set(true);
    }
  }

  onFeaturedImageDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onFeaturedImageDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.featuredImageDragCounter--;
    if (this.featuredImageDragCounter <= 0) {
      this.featuredImageDragCounter = 0;
      this.isFeaturedImageDragOver.set(false);
    }
  }

  async onFeaturedImageDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.featuredImageDragCounter = 0;
    this.isFeaturedImageDragOver.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];

      // Check if it's an image
      if (!file.type.includes('image/')) {
        this.snackBar.open('Please drop a valid image file', 'Close', {
          duration: 3000,
        });
        return;
      }

      try {
        await this.uploadFeaturedImageFile(file);
      } catch (error) {
        this.snackBar.open(
          'Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
          'Close',
          { duration: 5000 }
        );
      }
    }
  }

  private async uploadFeaturedImageFile(file: File): Promise<void> {
    const mediaServers = await this.getMediaServersForUpload();
    if (mediaServers.length === 0) {
      this.showMediaServerWarning();
      return;
    }

    const result = await this.media.uploadFile(file, false, mediaServers);

    if (result.status !== 'success' || !result.item) {
      throw new Error(result.message || 'Failed to upload image');
    }

    const uploadedUrl = result.item.url;
    this.previewImage.set(uploadedUrl);
    this.article.update(art => ({
      ...art,
      image: uploadedUrl,
      imageUrl: uploadedUrl,
      selectedImageFile: undefined,
    }));
    this.showArticleImage.set(true);

    this.snackBar.open('Featured image uploaded successfully', 'Close', {
      duration: 3000,
    });
  }

  togglePreview(): void {
    if (this.showSplitView()) {
      this.showSplitView.set(false);
    }

    this.showPreview.update(show => !show);
  }

  toggleSplitView(): void {
    if (!this.canUseSplitView()) {
      this.snackBar.open('Split view is available on larger screens only', 'Close', {
        duration: 3000,
      });
      return;
    }

    this.showPreview.set(false);
    this.showSplitView.update(show => !show);
  }

  async openReferencePicker(): Promise<void> {
    const { ArticleReferencePickerDialogComponent } = await import(
      '../article-reference-picker-dialog/article-reference-picker-dialog.component'
    );

    const dialogRef = this.customDialog.open<
      typeof ArticleReferencePickerDialogComponent.prototype,
      ArticleReferencePickerResult
    >(ArticleReferencePickerDialogComponent, {
      title: 'Insert Reference',
      width: '760px',
      maxWidth: '96vw',
      showCloseButton: true,
    });

    dialogRef.afterClosed$.subscribe(({ result }) => {
      const references = result?.references ?? [];
      if (references.length > 0) {
        this.insertReferences(references);
      }
    });
  }

  async openImportArticleDialog(): Promise<void> {
    const dialogRef = this.dialog.open(TextInputDialogComponent, {
      data: {
        title: 'Import Existing Article',
        message: 'Paste an naddr, nostr:naddr URI, article URL (/a/npub/slug), or event JSON.',
        label: 'Article event reference',
        placeholder: 'naddr1... or https://nostria.app/a/npub.../slug',
        required: true,
      },
      width: '640px',
      maxWidth: '95vw',
    });

    const value = await dialogRef.afterClosed().toPromise();
    const rawInput = typeof value === 'string' ? value.trim() : '';
    if (!rawInput) {
      return;
    }

    const hasCurrentContent = !!(
      this.article().title.trim() ||
      this.article().summary.trim() ||
      this.article().content.trim() ||
      this.article().image.trim() ||
      this.article().tags.length > 0
    );

    if (hasCurrentContent) {
      const confirmRef = this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: 'Replace Current Draft?',
          message: 'Importing will replace your current article draft content.',
          confirmText: 'Import',
          cancelText: 'Cancel',
        },
      });

      const confirmed = await confirmRef.afterClosed().toPromise();
      if (!confirmed) {
        return;
      }
    }

    try {
      this.isLoading.set(true);
      const importedEvent = await this.resolveImportedArticleEvent(rawInput);

      if (!importedEvent) {
        this.snackBar.open('Could not resolve article event from input', 'Close', { duration: 4000 });
        return;
      }

      const importedDTag = this.getTagValue(importedEvent.tags, 'd') || this.generateUniqueId();
      this.applyArticleEventToDraft(importedEvent, importedDTag);
      this.isEditMode.set(false);
      this.scheduleAutoSaveIfNeeded();

      this.snackBar.open('Article imported into editor', 'Close', { duration: 3000 });
    } catch (error) {
      this.snackBar.open(
        `Failed to import article: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'Close',
        { duration: 5000 }
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  private async resolveImportedArticleEvent(input: string): Promise<NostrEvent | null> {
    const trimmed = input.trim();

    const fromJson = this.tryParseArticleEventJson(trimmed);
    if (fromJson) {
      return fromJson;
    }

    const fromReference = this.parseArticleReference(trimmed);
    if (!fromReference) {
      return null;
    }

    const { pubkey, identifier, kind } = fromReference;

    const primaryRecord = await this.dataService.getEventByPubkeyAndKindAndReplaceableEvent(
      pubkey,
      kind,
      identifier,
      { save: true, cache: true }
    );

    if (primaryRecord?.event) {
      return primaryRecord.event as NostrEvent;
    }

    const fallbackKind = kind === 30023 ? 30024 : 30023;
    const fallbackRecord = await this.dataService.getEventByPubkeyAndKindAndReplaceableEvent(
      pubkey,
      fallbackKind,
      identifier,
      { save: true, cache: true }
    );

    return (fallbackRecord?.event as NostrEvent | undefined) || null;
  }

  private tryParseArticleEventJson(input: string): NostrEvent | null {
    if (!input.startsWith('{')) {
      return null;
    }

    try {
      const parsed = JSON.parse(input) as Partial<NostrEvent>;
      if (
        parsed &&
        typeof parsed.kind === 'number' &&
        (parsed.kind === 30023 || parsed.kind === 30024) &&
        typeof parsed.pubkey === 'string' &&
        Array.isArray(parsed.tags) &&
        typeof parsed.content === 'string'
      ) {
        return parsed as NostrEvent;
      }
    } catch {
      return null;
    }

    return null;
  }

  private parseArticleReference(input: string): { pubkey: string; identifier: string; kind: number } | null {
    const normalized = input.replace(/^nostr:/i, '');

    if (normalized.startsWith('naddr1')) {
      const decoded = nip19.decode(normalized);
      if (decoded.type === 'naddr') {
        return {
          pubkey: decoded.data.pubkey,
          identifier: decoded.data.identifier,
          kind: decoded.data.kind,
        };
      }
      return null;
    }

    const articleUrlMatch = normalized.match(this.articleUrlPattern);
    if (articleUrlMatch?.[1] && articleUrlMatch?.[2]) {
      const npubDecode = nip19.decode(articleUrlMatch[1]);
      if (npubDecode.type !== 'npub') {
        return null;
      }

      return {
        pubkey: npubDecode.data,
        identifier: decodeURIComponent(articleUrlMatch[2]),
        kind: 30023,
      };
    }

    if (normalized.includes(':')) {
      const parts = normalized.split(':');
      const maybeKind = parseInt(parts[0], 10);
      const maybePubkey = parts[1];
      const identifier = parts.slice(2).join(':');

      if (
        (maybeKind === 30023 || maybeKind === 30024) &&
        /^[0-9a-fA-F]{64}$/.test(maybePubkey || '') &&
        !!identifier
      ) {
        return {
          pubkey: maybePubkey,
          identifier,
          kind: maybeKind,
        };
      }
    }

    return null;
  }

  private insertReferences(references: string[]): void {
    const uniqueReferences = Array.from(new Set(references.filter(reference => !!reference?.trim())));
    if (uniqueReferences.length === 0) {
      return;
    }

    const currentContent = this.article().content;
    const separator = !currentContent.trim()
      ? ''
      : currentContent.endsWith('\n')
        ? '\n'
        : '\n\n';

    this.updateContent(`${currentContent}${separator}${uniqueReferences.join('\n')}`);

    this.snackBar.open(
      uniqueReferences.length === 1 ? 'Reference inserted' : `${uniqueReferences.length} references inserted`,
      'Close',
      { duration: 2500 }
    );
  }

  onEditorModeChange(isRichTextMode: boolean): void {
    this.editorIsRichTextMode.set(isRichTextMode);
  }

  applyAutoDTag(): void {
    const suggested = this.suggestedDTag();
    if (suggested) {
      this.article.update(art => ({ ...art, dTag: suggested }));
    }
  }

  /**
   * Extract NIP-27 references from content and add corresponding tags
   * According to NIP-27, adding tags is optional but recommended for notifications
   */
  private extractNip27Tags(content: string, tags: string[][]): void {
    // Match all nostr: URIs in content
    const nostrUriPattern = /nostr:(note1|nevent1|npub1|nprofile1|naddr1)([a-zA-Z0-9]+)/g;
    const matches = content.matchAll(nostrUriPattern);

    const addedEventIds = new Set(tags.filter(tag => tag[0] === 'e').map(tag => tag[1]));
    const addedPubkeys = new Set(tags.filter(tag => tag[0] === 'p').map(tag => tag[1]));

    for (const match of matches) {
      const fullIdentifier = match[1] + match[2];

      try {
        const decoded = nip19.decode(fullIdentifier);

        switch (decoded.type) {
          case 'note':
            // Add e tag for note reference
            if (!addedEventIds.has(decoded.data)) {
              tags.push(['e', decoded.data, '']);
              addedEventIds.add(decoded.data);
            }
            break;

          case 'nevent':
            // Add e tag for event reference with optional relay and pubkey
            if (!addedEventIds.has(decoded.data.id)) {
              const relay = decoded.data.relays?.[0] || '';
              const pubkey = decoded.data.author || '';
              tags.push(['e', decoded.data.id, relay, '', pubkey]);
              addedEventIds.add(decoded.data.id);
            }
            // Also add p tag for the author if available
            if (decoded.data.author && !addedPubkeys.has(decoded.data.author)) {
              tags.push(['p', decoded.data.author, '']);
              addedPubkeys.add(decoded.data.author);
            }
            break;

          case 'npub':
            // Add p tag for profile reference
            if (!addedPubkeys.has(decoded.data)) {
              tags.push(['p', decoded.data, '']);
              addedPubkeys.add(decoded.data);
            }
            break;

          case 'nprofile':
            // Add p tag for profile reference
            if (!addedPubkeys.has(decoded.data.pubkey)) {
              tags.push(['p', decoded.data.pubkey, '']);
              addedPubkeys.add(decoded.data.pubkey);
            }
            break;

          case 'naddr': {
            // Add a tag for addressable event reference
            const aTagValue = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
            const relay = decoded.data.relays?.[0] || '';
            tags.push(['a', aTagValue, relay]);
            break;
          }
        }
      } catch (error) {
        // Invalid NIP-19 identifier, skip it
        console.warn('Failed to decode NIP-19 identifier:', fullIdentifier, error);
      }
    }
  }

  /**
   * Process nostr: references in HTML content to create clickable links with profile names
   * This enhances the preview to show profile display names for npub/nprofile references
   * Uses nostr-mention class and data attributes for hover card functionality
   */
  private processNostrReferences(html: string): string {
    // Match nostr: URIs in the HTML content
    const nostrUriPattern = /nostr:(note1|nevent1|npub1|nprofile1|naddr1)([a-zA-Z0-9]+)/g;

    return html.replace(nostrUriPattern, (match, prefix, identifier) => {
      const fullIdentifier = prefix + identifier;

      try {
        const decoded = nip19.decode(fullIdentifier);
        const decodedType = decoded.type as string;

        if (decodedType === 'npub') {
          // For npub references, create profile link with hover card support
          const pubkey = decoded.data as unknown as string;
          const npubIdentifier = nip19.npubEncode(pubkey);

          // Get display name from cache (synchronous)
          const displayName = this.getCachedDisplayName(pubkey);

          return `<a href="/p/${npubIdentifier}" class="nostr-mention" data-pubkey="${pubkey}" data-type="profile" title="${match}">@${displayName}</a>`;
        } else if (decodedType === 'nprofile') {
          // For nprofile references, create profile link with hover card support
          const profileData = decoded.data as unknown as { pubkey: string; relays?: string[] };
          const pubkey = profileData.pubkey;
          const npubIdentifier = nip19.npubEncode(pubkey);

          // Get display name from cache (synchronous)
          const displayName = this.getCachedDisplayName(pubkey);

          return `<a href="/p/${npubIdentifier}" class="nostr-mention" data-pubkey="${pubkey}" data-type="profile" title="${match}">@${displayName}</a>`;
        } else if (decodedType === 'note') {
          // For note references, show as a link
          const eventId = decoded.data as unknown as string;
          const neventIdentifier = nip19.neventEncode({ id: eventId });
          return `<a href="/e/${neventIdentifier}" class="nostr-event-link" title="${match}">📝 Note</a>`;
        } else if (decodedType === 'nevent') {
          // For nevent references, show as a link
          const neventIdentifier = fullIdentifier;
          return `<a href="/e/${neventIdentifier}" class="nostr-event-link" title="${match}">📝 Note</a>`;
        } else if (decodedType === 'naddr') {
          // For addressable events, show as a link
          const addrData = decoded.data as unknown as {
            identifier: string;
            pubkey: string;
            kind: number;
            relays?: string[];
          };
          const npubIdentifier = nip19.npubEncode(addrData.pubkey);
          return `<a href="/a/${npubIdentifier}/${addrData.identifier}" class="nostr-addr-link" title="${match}">📄 Article</a>`;
        }

        return match;
      } catch (error) {
        // If decoding fails, just return the original match
        console.warn('Failed to decode nostr reference in preview:', fullIdentifier, error);
        return match;
      }
    });
  }

  /**
   * Get cached profile display name synchronously
   * Uses the same cache as DataService to avoid async operations in computed properties
   * Uses untracked() to prevent cache stats from triggering computed recalculation
   */
  private getCachedDisplayName(pubkey: string): string {
    // Use untracked to avoid creating reactive dependency on cache stats
    return untracked(() => {
      const cacheKey = `metadata-${pubkey}`;
      const record = this.cache.get<NostrRecord>(cacheKey);

      if (record?.data) {
        // Same priority as ParsingService: display_name > name > truncated npub
        return (
          record.data.display_name ||
          record.data.name ||
          `${nip19.npubEncode(pubkey).substring(0, 12)}...`
        );
      }

      // Fallback to truncated npub if not cached
      return `${nip19.npubEncode(pubkey).substring(0, 12)}...`;
    });
  }

  openAiDialog(action: 'generate' | 'translate' | 'sentiment' = 'generate') {
    const dialogRef = this.dialog.open(AiToolsDialogComponent, {
      data: { content: this.article().content, initialAction: action },
      width: '500px'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.updateContent(result);
      }
    });
  }

  async toggleRecording() {
    if (this.isRecording()) {
      this.speechService.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  async startRecording() {
    await this.speechService.startRecording({
      silenceDuration: 3000,
      onRecordingStateChange: (isRecording) => {
        this.isRecording.set(isRecording);
      },
      onTranscribingStateChange: (isTranscribing) => {
        this.isTranscribing.set(isTranscribing);
      },
      onTranscription: (text) => {
        const currentContent = this.article().content;
        const newContent = currentContent ? currentContent + ' ' + text : text;
        this.updateContent(newContent);
      }
    });
  }

  stopRecording() {
    this.speechService.stopRecording();
  }
}
