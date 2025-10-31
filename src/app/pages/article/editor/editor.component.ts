import {
  Component,
  inject,
  signal,
  effect,
  computed,
  untracked,
  OnInit,
  OnDestroy,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
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
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';

import { NostrService } from '../../../services/nostr.service';
import { DataService } from '../../../services/data.service';
import { LocalStorageService } from '../../../services/local-storage.service';
import { MatCardModule } from '@angular/material/card';
import { LayoutService } from '../../../services/layout.service';
import { AccountStateService } from '../../../services/account-state.service';
import { RichTextEditorComponent } from '../../../components/rich-text-editor/rich-text-editor.component';
import { nip19 } from 'nostr-tools';
import { DecodedNaddr } from 'nostr-tools/nip19';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { Cache } from '../../../services/cache';
import { NostrRecord } from '../../../interfaces';
import { MentionHoverDirective } from '../../../directives/mention-hover.directive';
import { MediaService } from '../../../services/media.service';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

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
  selector: 'app-editor',
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
    MatExpansionModule,
    MatTooltipModule,
    MentionHoverDirective,
    MatSlideToggleModule,
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private dataService = inject(DataService);
  private accountRelay = inject(AccountRelayService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private sanitizer = inject(DomSanitizer);
  private layout = inject(LayoutService);
  private accountState = inject(AccountStateService);
  private localStorage = inject(LocalStorageService);
  private cache = inject(Cache);
  private media = inject(MediaService);

  // Auto-save configuration
  private readonly AUTO_SAVE_INTERVAL = 2000; // Save every 2 seconds
  private autoSaveTimer?: ReturnType<typeof setTimeout>;

  // Editor state
  isLoading = signal(false);
  isPublishing = signal(false);
  isEditMode = signal(false);
  selectedTabIndex = signal(0);
  autoDTagEnabled = signal(true);
  isLoadingArticle = signal(false); // Track when we're loading an existing article

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
      .replace(/[^\w\-]+/g, '') // Remove all non-word chars (except dashes)
      .replace(/\-\-+/g, '-') // Replace multiple dashes with single dash
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
    const content = this.article().content;
    if (!content.trim()) return this.sanitizer.bypassSecurityTrustHtml('');

    try {
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

  // Tag input
  newTag = signal('');

  // Image upload state
  useImageUrl = signal(true); // Default to URL mode
  previewImage = signal<string | null>(null);
  hasMediaServers = computed(() => this.media.mediaServers().length > 0);

  constructor() {
    // Check if we're editing an existing article
    effect(() => {
      const articleId = this.route.snapshot.paramMap.get('id');
      if (articleId && typeof articleId === 'string') {
        this.isEditMode.set(true);

        untracked(async () => {
          await this.loadArticle(articleId);
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

    // Auto-save effect - disabled to prevent cursor jumping issues
    // Auto-save is now handled directly in the scheduleAutoSave method
    // effect(() => {
    //   const article = this.article();
    //   const pubkey = this.accountState.pubkey();
    //   const isEdit = this.isEditMode();
    //   const isLoadingArticle = this.isLoadingArticle();

    //   // Don't trigger auto-save while loading an existing article or during content updates
    //   if (isLoadingArticle || this.isUpdatingContent) return;

    //   // Only auto-save for new articles (not when editing existing ones)
    //   // Check if there's meaningful content before scheduling auto-save
    //   if (!isEdit && pubkey) {
    //     const hasContent = article.title.trim() ||
    //       article.content.trim() ||
    //       article.summary.trim() ||
    //       article.image.trim() ||
    //       article.tags.length > 0;

    //     if (hasContent) {
    //       this.scheduleAutoSave();
    //     }
    //   }
    // }, { allowSignalWrites: true });
  }

  ngOnInit() {
    setTimeout(() => this.layout.scrollMainContentToTop(), 100);
  }

  ngOnDestroy() {
    // Clear auto-save timer on destroy
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
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

  async loadArticle(articleId: string): Promise<void> {
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
            this.router.navigate(['/articles']);
            return;
          }
        } catch (error) {
          console.warn('Failed to decode article naddr:', articleId, error);
          this.snackBar.open('Invalid article address format', 'Close', {
            duration: 3000,
          });
          this.router.navigate(['/articles']);
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
        this.router.navigate(['/articles']);
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
        const event = record.event;
        const tags = event.tags;

        this.article.set({
          title: this.getTagValue(tags, 'title') || '',
          summary: this.getTagValue(tags, 'summary') || '',
          image: this.getTagValue(tags, 'image') || '',
          content: event.content || '',
          tags: tags.filter(tag => tag[0] === 't').map(tag => tag[1]) || [],
          publishedAt: parseInt(this.getTagValue(tags, 'published_at') || '0') || undefined,
          dTag: this.getTagValue(tags, 'd') || articleId,
        });
      } else {
        this.snackBar.open('Article not found', 'Close', { duration: 3000 });
        this.router.navigate(['/articles']);
      }
    } catch (error) {
      console.error('Error loading article:', error);
      this.snackBar.open('Error loading article', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
      this.isLoadingArticle.set(false); // Clear the loading flag
    }
  }

  private getTagValue(tags: string[][], tagName: string): string | undefined {
    const tag = tags.find(t => t[0] === tagName);
    return tag ? tag[1] : undefined;
  }

  addTag(): void {
    const tag = this.newTag().trim();
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
      this.isPublishing.set(true);
      await this.publishArticle(30024); // Draft kind
      this.snackBar.open('Draft saved successfully', 'Close', {
        duration: 3000,
      });

      // Navigate to drafts list after successful save
      this.router.navigate(['/article/drafts']);
    } catch (error) {
      console.error('Error saving draft:', error);
      this.snackBar.open('Error saving draft', 'Close', { duration: 3000 });
    } finally {
      this.isPublishing.set(false);
    }
  }

  async publishArticle(kind = 30023): Promise<void> {
    // Use different validation for drafts vs final articles
    if (kind === 30023 && !this.isValid()) {
      this.snackBar.open('Please fill in required fields', 'Close', {
        duration: 3000,
      });
      return;
    } else if (kind === 30024 && !this.isDraftValid()) {
      this.snackBar.open('Please add some content to save as draft', 'Close', {
        duration: 3000,
      });
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open('Please log in to publish', 'Close', {
        duration: 3000,
      });
      return;
    }

    try {
      this.isPublishing.set(true);
      const art = this.article();

      // Handle image file upload if selected
      let imageUrl = art.image;
      if (art.selectedImageFile) {
        try {
          const uploadResult = await this.media.uploadFile(
            art.selectedImageFile,
            false,
            this.media.mediaServers()
          );

          if (!uploadResult.item) {
            throw new Error(
              `Failed to upload image: ${uploadResult.message || 'Unknown error'}`
            );
          }

          imageUrl = uploadResult.item.url;
          // Update the article with the uploaded URL
          this.article.update(a => ({ ...a, image: imageUrl, selectedImageFile: undefined }));
        } catch (error) {
          console.error('Error uploading image:', error);
          this.snackBar.open(
            `Failed to upload image: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'Close',
            { duration: 5000 }
          );
          this.isPublishing.set(false);
          return;
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
      this.extractNip27Tags(art.content, tags);

      // Create the event
      const event = await this.nostrService.createEvent(kind, art.content, tags);

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

      const action = kind === 30024 ? 'Draft saved' : 'Article published';
      this.snackBar.open(`${action} successfully`, 'Close', { duration: 3000 });

      if (kind === 30023) {
        // Clear auto-draft after successful publish
        if (!this.isEditMode()) {
          this.clearAutoDraft();
        }

        // We don't do "note" much, we want URLs that embeds the autor.
        // const note = nip19.noteEncode(signedEvent.id);
        // this.router.navigate(['/e', note]); // Navigate to the published event
        // const nevent = nip19.neventEncode({ id: signedEvent.id, author: signedEvent.pubkey });
        // this.router.navigate(['/e', nevent], { state: { event: signedEvent } }); // Navigate to the published event

        // Navigate to the published article
        this.router.navigate(['/a', pubkey, art.dTag], {
          state: { event: signedEvent },
        });
      }
    } catch (error) {
      console.error('Error publishing article:', error);
      this.snackBar.open('Error publishing article', 'Close', {
        duration: 3000,
      });
    } finally {
      this.isPublishing.set(false);
    }
  }

  async publish(): Promise<void> {
    await this.publishArticle(30023);
    // Clear auto-draft after successful publish
    if (!this.isEditMode()) {
      this.clearAutoDraft();
    }
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

    this.router.navigate(['/articles']);
  }

  navigateToDrafts(): void {
    this.router.navigate(['/article/drafts']);
  }

  updateTitle(value: string): void {
    this.article.update(art => ({ ...art, title: value }));

    // Schedule auto-save directly instead of relying on effect
    this.scheduleAutoSaveIfNeeded();
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
  onFileSelected(event: Event): void {
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

      const reader = new FileReader();
      reader.onload = e => {
        const result = e.target?.result as string;
        this.previewImage.set(result);
        // Store the file for later upload
        this.article.update(art => ({ ...art, selectedImageFile: file }));
      };
      reader.readAsDataURL(file);
    }
  }

  // Handle URL input for image
  onImageUrlChange(): void {
    const url = this.article()?.imageUrl || '';
    if (url && url.trim() !== '') {
      this.previewImage.set(url);
      // Update the main image field immediately
      this.article.update(art => ({ ...art, image: url }));
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
}
