import { Component, inject, signal, effect, computed, untracked } from '@angular/core';

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
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';

import { NostrService } from '../../../services/nostr.service';
import { DataService } from '../../../services/data.service';
import { RelayService } from '../../../services/relay.service';
import { LocalStorageService } from '../../../services/local-storage.service';
import { MatCardModule } from '@angular/material/card';
import { LayoutService } from '../../../services/layout.service';
import { AccountStateService } from '../../../services/account-state.service';
import { RichTextEditorComponent } from '../../../components/rich-text-editor/rich-text-editor.component';
import { nip19 } from 'nostr-tools';
import { DecodedNaddr } from 'nostr-tools/nip19';

interface ArticleDraft {
  title: string;
  summary: string;
  image: string;
  content: string;
  tags: string[];
  publishedAt?: number;
  dTag: string;
  lastSaved?: number; // Timestamp for auto-save
}

interface ArticleAutoDraft {
  title: string;
  summary: string;
  image: string;
  content: string;
  tags: string[];
  dTag: string;
  lastModified: number;
  autoTitleEnabled: boolean;
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
    MatTooltipModule
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss'
})
export class EditorComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private dataService = inject(DataService);
  private relayService = inject(RelayService); private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private sanitizer = inject(DomSanitizer);
  private layout = inject(LayoutService);
  private accountState = inject(AccountStateService);
  private localStorage = inject(LocalStorageService);

  // Auto-save configuration
  private readonly AUTO_SAVE_INTERVAL = 2000; // Save every 2 seconds
  private autoSaveTimer?: ReturnType<typeof setTimeout>;

  // Editor state
  isLoading = signal(false);
  isPublishing = signal(false);
  isEditMode = signal(false);
  selectedTabIndex = signal(0);
  autoTitleEnabled = signal(true);
  autoDTagEnabled = signal(true);
  isLoadingArticle = signal(false); // Track when we're loading an existing article

  // Article data
  article = signal<ArticleDraft>({
    title: '',
    summary: '',
    image: '',
    content: '',
    tags: [],
    dTag: this.generateUniqueId()
  });

  // Auto-title feature
  suggestedTitle = computed(() => {
    if (!this.autoTitleEnabled()) return '';

    const content = this.article().content;
    if (!content.trim()) return '';

    // Extract first line and clean it up
    const firstLine = content.split('\n')[0];

    // Remove markdown heading syntax
    let title = firstLine.replace(/^#{1,6}\s+/, '');

    // Remove other markdown formatting
    title = title
      .replace(/\*\*/g, '')  // Bold
      .replace(/\*/g, '')     // Italic
      .replace(/\_\_/g, '')   // Bold
      .replace(/\_/g, '')     // Italic
      .replace(/\~\~/g, '')   // Strikethrough
      .replace(/\`/g, '');    // Code

    // Limit length
    if (title.length > 100) {
      title = title.substring(0, 97) + '...';
    }

    return title;
  });

  // Auto-dTag feature
  suggestedDTag = computed(() => {
    const title = this.article().title;
    if (!title.trim()) return '';

    // Convert to lowercase, replace spaces with dashes, remove special characters
    return title
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')          // Replace spaces with dashes
      .replace(/[^\w\-]+/g, '')       // Remove all non-word chars (except dashes)
      .replace(/\-\-+/g, '-')         // Replace multiple dashes with single dash
      .replace(/^-+/, '')             // Trim dashes from start
      .replace(/-+$/, '');            // Trim dashes from end
  });

  // Form validation
  isValid = computed(() => {
    const art = this.article();
    return art.title.trim().length > 0 &&
      art.content.trim().length > 0 &&
      art.dTag.trim().length > 0;
  });
  // Markdown preview
  markdownHtml = computed(() => {
    const content = this.article().content;
    if (!content.trim()) return this.sanitizer.bypassSecurityTrustHtml('');

    try {
      const html = marked.parse(content);
      return this.sanitizer.bypassSecurityTrustHtml(html as string);
    } catch (error) {
      console.error('Error parsing markdown:', error);
      return this.sanitizer.bypassSecurityTrustHtml('<p>Error parsing markdown</p>');
    }
  });

  // Tag input
  newTag = signal('');

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

    // Auto-save effect - watches for article content changes with debouncing
    effect(() => {
      const article = this.article();
      const pubkey = this.accountState.pubkey();
      const isEdit = this.isEditMode();
      const isLoadingArticle = this.isLoadingArticle();

      // Don't trigger auto-save while loading an existing article
      if (isLoadingArticle) return;

      // Only auto-save for new articles (not when editing existing ones)
      // Check if there's meaningful content before scheduling auto-save
      if (!isEdit && pubkey) {
        const hasContent = article.title.trim() ||
          article.content.trim() ||
          article.summary.trim() ||
          article.image.trim() ||
          article.tags.length > 0;

        if (hasContent) {
          this.scheduleAutoSave();
        }
      }
    }, { allowSignalWrites: true });
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
    const hasContent = article.title.trim() ||
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

  private saveAutoDraft(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey || this.isEditMode()) return;

    const article = this.article();

    // Check if there's meaningful content
    const hasContent = article.title.trim() ||
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
      autoTitleEnabled: this.autoTitleEnabled(),
      autoDTagEnabled: this.autoDTagEnabled()
    };

    const key = this.getAutoDraftKey();

    // Check if this is meaningfully different from the last save
    const previousDraft = this.localStorage.getObject<ArticleAutoDraft>(key);
    if (previousDraft) {
      const isSimilar = previousDraft.title === autoDraft.title &&
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
          dTag: autoDraft.dTag
        });

        this.autoTitleEnabled.set(autoDraft.autoTitleEnabled);
        this.autoDTagEnabled.set(autoDraft.autoDTagEnabled);

        // Show restoration message if there's meaningful content
        if (autoDraft.title.trim() || autoDraft.content.trim() || autoDraft.summary.trim()) {
          this.snackBar.open('Draft restored from previous session', 'Dismiss', {
            duration: 4000,
            panelClass: 'info-snackbar'
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
        const naddr = nip19.decode(articleId) as DecodedNaddr;

        if (naddr.data.kind !== 30023 && naddr.data.kind !== 30024) {
          this.snackBar.open('Invalid article kind', 'Close', { duration: 3000 });
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
        this.snackBar.open('Please log in to edit articles', 'Close', { duration: 3000 });
        this.router.navigate(['/articles']);
        return;
      }

      // Since we're doing editing here, we'll save and cache locally.
      const record = await this.dataService.getEventByPubkeyAndKindAndReplaceableEvent(
        pubkey,
        kind,
        articleId,
        {
          cache: true,
          save: true
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
          dTag: this.getTagValue(tags, 'd') || articleId
        });

        // Disable auto-title when editing existing article since title is already established
        this.autoTitleEnabled.set(false);
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
        tags: [...art.tags, tag]
      }));
      this.newTag.set('');
    }
  }

  removeTag(tag: string): void {
    this.article.update(art => ({
      ...art,
      tags: art.tags.filter(t => t !== tag)
    }));
  }

  onTagKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addTag();
    }
  }

  async saveDraft(): Promise<void> {
    if (!this.isValid()) {
      this.snackBar.open('Please fill in required fields', 'Close', { duration: 3000 });
      return;
    }

    try {
      this.isPublishing.set(true);
      await this.publishArticle(30024); // Draft kind
      this.snackBar.open('Draft saved successfully', 'Close', { duration: 3000 });
    } catch (error) {
      console.error('Error saving draft:', error);
      this.snackBar.open('Error saving draft', 'Close', { duration: 3000 });
    } finally {
      this.isPublishing.set(false);
    }
  }

  async publishArticle(kind: number = 30023): Promise<void> {
    if (!this.isValid()) {
      this.snackBar.open('Please fill in required fields', 'Close', { duration: 3000 });
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open('Please log in to publish', 'Close', { duration: 3000 });
      return;
    }

    try {
      this.isPublishing.set(true);
      const art = this.article();

      // Build tags array according to NIP-23
      const tags: string[][] = [
        ['d', art.dTag],
        ['title', art.title],
        ['summary', art.summary]
      ];

      if (art.image) {
        tags.push(['image', art.image]);
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

      // Create the event
      const event = await this.nostrService.createEvent(
        kind,
        art.content,
        tags
      );

      if (!event) {
        throw new Error('Failed to create event');
      }

      // Sign the event
      const signedEvent = await this.nostrService.signEvent(event);
      if (!signedEvent) {
        throw new Error('Failed to sign event');
      }      // Publish to relays
      await this.relayService.publish(signedEvent);

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
        this.router.navigate(['/a', pubkey, art.dTag], { state: { event: signedEvent } });
      }
    } catch (error) {
      console.error('Error publishing article:', error);
      this.snackBar.open('Error publishing article', 'Close', { duration: 3000 });
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
        panelClass: 'info-snackbar'
      });
    }

    this.router.navigate(['/articles']);
  }

  navigateToDrafts(): void {
    this.router.navigate(['/drafts']);
  }

  updateTitle(value: string): void {
    this.article.update(art => ({ ...art, title: value }));

    // If auto-dTag is enabled and there's a suggested dTag, apply it
    if (this.autoDTagEnabled() && this.suggestedDTag()) {
      this.applyAutoDTag();
    }
  }

  updateSummary(value: string): void {
    this.article.update(art => ({ ...art, summary: value }));
  }

  updateImage(value: string): void {
    this.article.update(art => ({ ...art, image: value }));
  }

  updateContent(value: string): void {
    this.article.update(art => ({ ...art, content: value }));

    // If auto-title is enabled and there's a suggested title, apply it silently
    if (this.autoTitleEnabled() && this.suggestedTitle()) {
      this.applyAutoTitle();
    }
  }

  updateDTag(value: string): void {
    this.article.update(art => ({ ...art, dTag: value }));
  }

  toggleAutoTitleMode(): void {
    const wasEnabled = this.autoTitleEnabled();
    this.autoTitleEnabled.update(enabled => !enabled);

    // Apply auto-title when enabling and show notification
    if (!wasEnabled && this.autoTitleEnabled() && this.suggestedTitle()) {
      this.applyAutoTitle();
      this.snackBar.open('Auto-title enabled - title updated from content', 'Close', { duration: 3000 });
    }
  }

  applyAutoTitle(): void {
    const suggested = this.suggestedTitle();
    if (suggested) {
      this.article.update(art => ({ ...art, title: suggested }));
      // Only show notification when manually triggered, not during auto-updates
    }
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
}
