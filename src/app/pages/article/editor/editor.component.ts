import { Component, inject, signal, effect, computed } from '@angular/core';

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
import { MatCardModule } from '@angular/material/card';
import { LayoutService } from '../../../services/layout.service';
import { AccountStateService } from '../../../services/account-state.service';
import { RichTextEditorComponent } from '../../../components/rich-text-editor/rich-text-editor.component';

interface ArticleDraft {
  title: string;
  summary: string;
  image: string;
  content: string;
  tags: string[];
  publishedAt?: number;
  dTag: string;
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
  private relayService = inject(RelayService);  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private sanitizer = inject(DomSanitizer);
  private layout = inject(LayoutService);
  private accountState = inject(AccountStateService);

  // Editor state
  isLoading = signal(false);
  isPublishing = signal(false);
  isEditMode = signal(false);
  selectedTabIndex = signal(0);
  autoTitleEnabled = signal(true);
  autoDTagEnabled = signal(true);
  
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
        this.loadArticle(articleId);
      }
    });
  }

  ngOnInit() {
    setTimeout(() => this.layout.scrollMainContentToTop(), 100);
  }

  private generateUniqueId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async loadArticle(articleId: string): Promise<void> {
    try {
      this.isLoading.set(true);
      const pubkey = this.accountState.pubkey();
      
      if (!pubkey) {
        this.snackBar.open('Please log in to edit articles', 'Close', { duration: 3000 });
        this.router.navigate(['/articles']);
        return;
      }

      const record = await this.dataService.getEventByPubkeyAndKindAndReplaceableEvent(
        pubkey, 
        30023, 
        articleId, 
        true
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
      } else {
        this.snackBar.open('Article not found', 'Close', { duration: 3000 });
        this.router.navigate(['/articles']);
      }
    } catch (error) {
      console.error('Error loading article:', error);
      this.snackBar.open('Error loading article', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
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
    debugger;
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
        // Navigate to the published article
        this.router.navigate(['/a', art.dTag]);
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
  }

  cancel(): void {
    this.router.navigate(['/articles']);
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
    
    // If auto-title is enabled and there's a suggested title, apply it
    // Removed the check for empty title to allow auto-title to update existing titles
    if (this.autoTitleEnabled() && this.suggestedTitle()) {
      this.applyAutoTitle();
    }
  }

  updateDTag(value: string): void {
    this.article.update(art => ({ ...art, dTag: value }));
  }
  
  toggleAutoTitleMode(): void {
    this.autoTitleEnabled.update(enabled => !enabled);
    // Apply auto-title when enabling, regardless of existing title
    if (this.autoTitleEnabled() && this.suggestedTitle()) {
      this.applyAutoTitle();
    }
  }
  
  applyAutoTitle(): void {
    const suggested = this.suggestedTitle();
    if (suggested) {
      this.updateTitle(suggested);
      this.snackBar.open('Title updated from content', 'Close', { duration: 2000 });
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
