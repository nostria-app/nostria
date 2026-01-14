import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { AccountStateService } from '../../services/account-state.service';
import { Event, nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { ApplicationService } from '../../services/application.service';
import { standardizedTag } from '../../standardized-tags';
import { AccountRelayService } from '../../services/relays/account-relay';

import { LayoutService } from '../../services/layout.service';
import { NostrRecord } from '../../interfaces';
import { AccountLocalStateService } from '../../services/account-local-state.service';

export interface ArticleItem {
  id: string;
  dTag: string;
  title: string;
  summary: string;
  content: string;
  createdAt: number;
  lastModified: number;
  tags: string[];
  imageUrl?: string;
  event: Event;
  status: 'draft' | 'published';
  publishedEvent?: Event;
  isEdited?: boolean; // If draft is different from published
}

@Component({
  selector: 'app-articles-list',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule,
    MatMenuModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatTabsModule,
    AgoPipe
  ],
  templateUrl: './articles-list.component.html',
  styleUrl: './articles-list.component.scss',
})
export class ArticlesListComponent {
  private router = inject(Router);
  private nostrService = inject(NostrService);
  private accountRelay = inject(AccountRelayService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private data = inject(DataService);
  private app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private dialog = inject(MatDialog);
  private layout = inject(LayoutService);

  isLoading = signal(true);
  articles = signal<ArticleItem[]>([]);
  error = signal<string | null>(null);
  selectedTags = signal<string[]>([]);
  selectedDraftTags = signal<string[]>([]);
  selectedPublishedTags = signal<string[]>([]);
  selectedTab = signal<number>(0); // 0: Drafts, 1: Published

  // Extract unique tags from all articles
  availableTags = computed(() => {
    const tagSet = new Set<string>();
    const tab = this.selectedTab();

    // Only show tags relevant to the current tab
    this.articles().forEach(article => {
      // Filter logic duplicated from filteredArticles to ensure tags match visible items
      const isDraftTab = tab === 0;
      const isPublishedTab = tab === 1;

      const showInDrafts = article.status === 'draft' || (article.status === 'published' && article.isEdited);
      const showInPublished = article.status === 'published';

      if ((isDraftTab && showInDrafts) || (isPublishedTab && showInPublished)) {
        article.tags.forEach(tag => tagSet.add(tag));
      }
    });
    return Array.from(tagSet).sort();
  });

  // Filter articles based on selected tags and tab
  filteredArticles = computed(() => {
    const tab = this.selectedTab();
    const tags = tab === 0 ? this.selectedDraftTags() : this.selectedPublishedTags();

    let filtered = this.articles();

    // Filter by tab
    if (tab === 0) { // Drafts
      filtered = filtered.filter(a => a.status === 'draft' || (a.status === 'published' && a.isEdited));
    } else { // Published
      filtered = filtered.filter(a => a.status === 'published');
    }

    if (tags.length === 0) return filtered;

    return filtered.filter(article =>
      tags.some(tag => article.tags.includes(tag))
    );
  });

  constructor() {
    effect(() => {
      if (this.app.initialized() && this.accountState.account()) {
        const pubkey = this.accountState.account()!.pubkey;
        this.selectedTab.set(this.accountLocalState.getArticlesActiveTab(pubkey));
        this.loadArticles();
      }
    });
  }

  async loadArticles(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      const currentAccount = this.accountState.account();
      if (!currentAccount) {
        this.error.set('Please log in to view your articles');
        this.isLoading.set(false);
        return;
      }

      // Get draft events (kind 30024) and published articles (kind 30023)
      const [publishedEvents, draftEvents] = await Promise.all([
        this.data.getEventsByPubkeyAndKind(currentAccount.pubkey, 30023),
        this.data.getEventsByPubkeyAndKind(currentAccount.pubkey, 30024)
      ]);

      const events = [...publishedEvents, ...draftEvents];

      const articleMap = new Map<string, { draft?: Event, published?: Event }>();

      // Group by d-tag
      events.forEach((record: NostrRecord) => {
        const event = record.event;
        const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1];
        if (!dTag) return;

        if (!articleMap.has(dTag)) {
          articleMap.set(dTag, {});
        }

        const entry = articleMap.get(dTag)!;
        if (event.kind === 30024) {
          // If multiple drafts exist, take the newest one
          if (!entry.draft || event.created_at > entry.draft.created_at) {
            entry.draft = event;
          }
        } else if (event.kind === 30023) {
          // If multiple published versions exist, take the newest one
          if (!entry.published || event.created_at > entry.published.created_at) {
            entry.published = event;
          }
        }
      });

      const articles: ArticleItem[] = [];

      articleMap.forEach((entry, dTag) => {
        const mainEvent = entry.draft || entry.published!;
        const isPublished = !!entry.published;
        const hasDraft = !!entry.draft;

        // Determine status and edited state
        let status: 'draft' | 'published' = 'draft';
        let isEdited = false;

        if (isPublished && !hasDraft) {
          status = 'published';
        } else if (isPublished && hasDraft) {
          status = 'published';
          // Check if draft is different/newer
          if (entry.draft!.content !== entry.published!.content ||
            entry.draft!.created_at > entry.published!.created_at) {
            isEdited = true;
          }
        } else {
          status = 'draft';
        }

        // If we have a draft, we want to show it in the drafts tab even if published
        // But for the main list, we create one item per d-tag

        // Extract metadata
        const titleTag = this.nostrService.getTags(mainEvent, standardizedTag.title);
        const imageTag = this.nostrService.getTags(mainEvent, standardizedTag.image);
        const summaryTag = this.nostrService.getTags(mainEvent, standardizedTag.summary);
        const topicTags = mainEvent.tags.filter(tag => tag[0] === 't').map(tag => tag[1]);

        articles.push({
          id: mainEvent.id,
          dTag: dTag,
          title: titleTag[0] || 'Untitled Article',
          summary: summaryTag[0] || this.generateSummary(mainEvent.content),
          content: mainEvent.content,
          createdAt: mainEvent.created_at,
          lastModified: mainEvent.created_at,
          tags: topicTags,
          imageUrl: imageTag[0],
          event: mainEvent,
          status: status,
          publishedEvent: entry.published,
          isEdited: isEdited
        });
      });

      // Sort by last modified
      articles.sort((a, b) => b.lastModified - a.lastModified);

      this.articles.set(articles);
    } catch (error) {
      this.logger.error('Error loading articles:', error);
      this.error.set('Failed to load articles');
    } finally {
      this.isLoading.set(false);
    }
  }

  private generateSummary(content: string): string {
    if (!content) return '';
    // Create a summary from the first ~150 chars of content
    const summary = content.slice(0, 150).trim();
    return summary.length < content.length ? `${summary}...` : summary;
  }

  async openArticle(article: ArticleItem, event?: MouseEvent): Promise<void> {
    if (event) {
      event.stopPropagation();
    }

    // Navigate to article editor with the article's naddr
    // If it's a draft, use the draft event. If it's published, use the published event (or draft if available)
    // Actually, we should always prefer the draft if we are editing.
    // But if we are in "Published" tab and there is no draft, we edit the published version (which creates a draft).

    const targetEvent = article.status === 'draft' || article.isEdited ? article.event : (article.publishedEvent || article.event);
    const kind = targetEvent.kind;

    const naddr = nip19.naddrEncode({
      identifier: article.dTag,
      pubkey: targetEvent.pubkey,
      kind: kind,
    });

    const dialogRef = await this.layout.createArticle(naddr);
    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result) {
        this.loadArticles();
      }
    });
  }

  async createNewArticle(): Promise<void> {
    const dialogRef = await this.layout.createArticle();
    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result) {
        this.loadArticles();
      }
    });
  }

  async deleteArticle(article: ArticleItem, event?: MouseEvent): Promise<void> {
    if (event) {
      event.stopPropagation();
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Article',
        message: `Are you sure you want to delete the article "${article.title}"? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      try {
        // Create a deletion event (kind 5)
        // We should delete both draft and published version if they exist?
        // Or just the one we are looking at?
        // Usually "Delete" implies deleting the whole thing.

        const tags = [];
        if (article.event) {
          tags.push(['a', `${article.event.kind}:${article.event.pubkey}:${article.dTag}`]);
          tags.push(['e', article.event.id]);
        }

        if (article.publishedEvent) {
          tags.push(['a', `${article.publishedEvent.kind}:${article.publishedEvent.pubkey}:${article.dTag}`]);
          tags.push(['e', article.publishedEvent.id]);
        }

        const deleteEvent = this.nostrService.createEvent(5, 'Deleted article', tags);

        const signedEvent = await this.nostrService.signEvent(deleteEvent);
        await this.accountRelay.publish(signedEvent);

        // Remove from local list
        this.articles.update(articles => articles.filter(a => a.id !== article.id));

        this.snackBar.open('Article deleted successfully', 'Close', {
          duration: 3000,
        });
      } catch (error) {
        this.logger.error('Error deleting article:', error);
        this.snackBar.open('Failed to delete article', 'Close', {
          duration: 3000,
        });
      }
    }
  }

  async refreshArticles(): Promise<void> {
    await this.loadArticles();
    this.snackBar.open('Articles refreshed', 'Close', {
      duration: 2000,
    });
  }

  onTagSelectionChange(selectedTags: string[]): void {
    if (this.selectedTab() === 0) {
      this.selectedDraftTags.set(selectedTags);
    } else {
      this.selectedPublishedTags.set(selectedTags);
    }
  }

  clearTagFilter(): void {
    if (this.selectedTab() === 0) {
      this.selectedDraftTags.set([]);
    } else {
      this.selectedPublishedTags.set([]);
    }
  }

  viewArticle(article: ArticleItem, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }

    const targetEvent = article.publishedEvent || article.event;
    const naddr = nip19.naddrEncode({
      identifier: article.dTag,
      pubkey: targetEvent.pubkey,
      kind: targetEvent.kind,
    });

    this.router.navigate([{ outlets: { right: ['a', naddr] } }]);
  }

  onTabChange(index: number): void {
    this.selectedTab.set(index);
    const account = this.accountState.account();
    if (account) {
      this.accountLocalState.setArticlesActiveTab(account.pubkey, index);
    }
  }
}
