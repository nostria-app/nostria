import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';

import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { LoggerService } from '../../services/logger.service';
import { BookmarkCategoryDialogComponent } from './bookmark-category-dialog/bookmark-category-dialog.component';
import { AddBookmarkDialogComponent } from './add-bookmark-dialog/add-bookmark-dialog.component';
import { BookmarkService, BookmarkType } from '../../services/bookmark.service';
import { DataService } from '../../services/data.service';
import { DatabaseService } from '../../services/database.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { OpenGraphService } from '../../services/opengraph.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { ApplicationStateService } from '../../services/application-state.service';
import { AccountStateService } from '../../services/account-state.service';
import { Router } from '@angular/router';
import { LayoutService } from '../../services/layout.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { EventComponent } from '../../components/event/event.component';
import { ArticleComponent } from '../../components/article/article.component';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { CreateListDialogComponent } from './create-list-dialog/create-list-dialog.component';
import { SocialPreviewComponent } from '../../components/social-preview/social-preview.component';

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  description?: string;
  categories: string[];
  type: BookmarkType;
  createdAt: number;
  updatedAt: number;
}

interface BookmarkCategory {
  id: string;
  name: string;
  color: string;
}

export type ViewMode = 'tiles' | 'content' | 'list';

interface CompactEventDetails {
  contentPreview: string;
  authorPubkey: string;
  authorName: string;
  authorPicture: string | null;
}

interface CompactAddressableDetails {
  typeLabel: string;
  contentPreview: string;
  authorName: string;
  authorPicture: string | null;
}

interface CompactUrlDetails {
  title: string;
  subtitle: string;
}

@Component({
  selector: 'app-bookmarks',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatCardModule,
    MatChipsModule,
    MatMenuModule,
    MatTooltipModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatDividerModule,
    DragDropModule,
    EventComponent,
    ArticleComponent,
    SocialPreviewComponent,
  ],
  templateUrl: './bookmarks.component.html',
  styleUrl: './bookmarks.component.scss',
})
export class BookmarksComponent implements OnInit {
  private logger = inject(LoggerService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private localStorage = inject(LocalStorageService);
  private accountLocalState = inject(AccountLocalStateService);
  private accountState = inject(AccountStateService);
  bookmarkService = inject(BookmarkService);
  private appState = inject(ApplicationStateService);
  private router = inject(Router);
  layout = inject(LayoutService);
  private twoColumnLayout = inject(TwoColumnLayoutService);
  private data = inject(DataService);
  private database = inject(DatabaseService);
  private relayPool = inject(RelayPoolService);
  private openGraph = inject(OpenGraphService);

  // Loading states
  loading = signal(false);
  private compactEventDetails = signal<Record<string, CompactEventDetails>>({});
  private compactAddressableDetails = signal<Record<string, CompactAddressableDetails>>({});
  private compactUrlDetails = signal<Record<string, CompactUrlDetails>>({});
  private loadingCompactEventIds = new Set<string>();
  private loadingCompactAddressableIds = new Set<string>();
  private loadingCompactUrlIds = new Set<string>();
  private compactEventRetryCounts = new Map<string, number>();

  // Pagination for continuous scrolling
  private readonly PAGE_SIZE = 10;
  displayedEventCount = signal(this.PAGE_SIZE);
  displayedArticleCount = signal(this.PAGE_SIZE);
  displayedUrlCount = signal(this.PAGE_SIZE);

  // Default categories with types
  categories = signal<BookmarkCategory[]>([
    { id: 'events', name: 'Notes', color: '#2196f3' },
    { id: 'articles', name: 'Other', color: '#4caf50' },
    { id: 'websites', name: 'Websites', color: '#ff9800' },
  ]);

  // Current state
  searchQuery = signal('');
  selectedCategory = signal('events');
  viewMode = signal<ViewMode>('content');

  // Paginated/sliced bookmarks for display
  displayedEvents = computed(() => {
    const events = this.bookmarkService.bookmarkEvents();
    if (this.viewMode() === 'list') {
      return events;
    }
    const count = this.displayedEventCount();
    return events.slice(0, count);
  });

  displayedArticles = computed(() => {
    const articles = this.bookmarkService.bookmarkArticles();
    if (this.viewMode() === 'list') {
      return articles;
    }
    const count = this.displayedArticleCount();
    return articles.slice(0, count);
  });

  displayedUrls = computed(() => {
    const urls = this.bookmarkService.bookmarkUrls();
    if (this.viewMode() === 'list') {
      return urls;
    }
    const count = this.displayedUrlCount();
    return urls.slice(0, count);
  });

  // Get the currently selected list
  currentList = computed(() => {
    const listId = this.bookmarkService.selectedListId();
    return this.bookmarkService.allBookmarkLists().find(l => l.id === listId);
  });

  constructor() {
    this.twoColumnLayout.setWideLeft();
    // Load categories and view preference from storage
    this.loadFromStorage();

    effect(() => {
      this.logger.debug('Selected category changed:', this.selectedCategory());
      this.resetPagination();
    });

    effect(() => {
      this.logger.debug('Search query changed:', this.searchQuery());
    });

    effect(() => {
      this.logger.debug('View mode changed:', this.viewMode());
      this.saveViewMode();
    });

    effect(() => {
      if (this.viewMode() !== 'list' || this.selectedCategory() !== 'events') {
        return;
      }

      void this.loadCompactEventDetails(this.displayedEvents());
    });

    effect(() => {
      if (this.viewMode() !== 'list' || this.selectedCategory() !== 'articles') {
        return;
      }

      void this.loadCompactAddressableDetails(this.displayedArticles());
    });

    effect(() => {
      if (this.viewMode() !== 'list' || this.selectedCategory() !== 'websites') {
        return;
      }

      void this.loadCompactUrlDetails(this.displayedUrls());
    });
  }

  ngOnInit(): void {
    // Scroll to top when bookmarks page is opened
    this.layout.scrollToTop();

    // Reload bookmark lists to retry any failed decryptions
    this.bookmarkService.loadBookmarkLists();

    // Reset pagination when page opens
    this.resetPagination();
  }

  private resetPagination(): void {
    this.displayedEventCount.set(this.PAGE_SIZE);
    this.displayedArticleCount.set(this.PAGE_SIZE);
    this.displayedUrlCount.set(this.PAGE_SIZE);
  }

  /**
   * Load more items when user scrolls near bottom
   */
  loadMore(): void {
    if (this.viewMode() === 'list') {
      return;
    }

    const category = this.selectedCategory();

    if (category === 'events') {
      const current = this.displayedEventCount();
      const total = this.bookmarkService.bookmarkEvents().length;
      if (current < total) {
        this.displayedEventCount.set(Math.min(current + this.PAGE_SIZE, total));
        this.logger.debug(`[Bookmarks] Loaded more events: ${this.displayedEventCount()}/${total}`);
      }
    } else if (category === 'articles') {
      const current = this.displayedArticleCount();
      const total = this.bookmarkService.bookmarkArticles().length;
      if (current < total) {
        this.displayedArticleCount.set(Math.min(current + this.PAGE_SIZE, total));
        this.logger.debug(`[Bookmarks] Loaded more articles: ${this.displayedArticleCount()}/${total}`);
      }
    } else if (category === 'websites') {
      const current = this.displayedUrlCount();
      const total = this.bookmarkService.bookmarkUrls().length;
      if (current < total) {
        this.displayedUrlCount.set(Math.min(current + this.PAGE_SIZE, total));
        this.logger.debug(`[Bookmarks] Loaded more URLs: ${this.displayedUrlCount()}/${total}`);
      }
    }
  }

  /**
   * Handle scroll events to trigger loading more items
   */
  onScroll(event: Event): void {
    const element = event.target as HTMLElement;
    const scrollPosition = element.scrollTop + element.clientHeight;
    const scrollHeight = element.scrollHeight;

    // Load more when scrolled to 80% of the way down
    if (scrollPosition >= scrollHeight * 0.8) {
      this.loadMore();
    }
  }

  /**
   * Check if there are more items to load
   */
  hasMoreToLoad(): boolean {
    if (this.viewMode() === 'list') {
      return false;
    }

    const category = this.selectedCategory();

    if (category === 'events') {
      return this.displayedEventCount() < this.bookmarkService.bookmarkEvents().length;
    } else if (category === 'articles') {
      return this.displayedArticleCount() < this.bookmarkService.bookmarkArticles().length;
    } else if (category === 'websites') {
      return this.displayedUrlCount() < this.bookmarkService.bookmarkUrls().length;
    }

    return false;
  }

  private loadFromStorage(): void {
    this.logger.debug('Loading categories from storage');

    const savedCategories = this.localStorage.getItem('bookmark_categories');
    if (savedCategories) {
      try {
        const parsedCategories = JSON.parse(savedCategories);
        if (Array.isArray(parsedCategories) && parsedCategories.length > 0) {
          this.categories.set(parsedCategories);
          this.logger.debug('Loaded categories from storage:', parsedCategories);
        }
      } catch (error) {
        this.logger.error('Error parsing saved categories:', error);
      }
    }

    // Load view mode from account-specific state
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const savedViewMode = this.accountLocalState.getBookmarksViewMode(pubkey);
      if (savedViewMode) {
        const viewMode = savedViewMode as ViewMode;
        if (['tiles', 'content', 'list'].includes(viewMode)) {
          this.viewMode.set(viewMode);
          this.logger.debug('Loaded view mode from storage:', viewMode);
        }
      }
    }
  }

  private saveToStorage(): void {
    this.localStorage.setItem('bookmark_categories', JSON.stringify(this.categories()));
    this.logger.debug('Categories saved to storage');
  }

  private saveViewMode(): void {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setBookmarksViewMode(pubkey, this.viewMode());
      this.logger.debug('View mode saved to storage:', this.viewMode());
    }
  }

  // Actions
  selectCategory(categoryId: string): void {
    this.selectedCategory.set(categoryId);
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  toggleViewMode(): void {
    const currentMode = this.viewMode();
    if (currentMode === 'content') {
      this.viewMode.set('tiles');
      return;
    }

    if (currentMode === 'tiles') {
      this.viewMode.set('list');
      return;
    }

    this.viewMode.set('content');
  }

  getViewIcon(): string {
    switch (this.viewMode()) {
      case 'tiles':
        return 'grid_view';
      case 'content':
        return 'view_agenda';
      case 'list':
        return 'view_list';
      default:
        return 'view_agenda';
    }
  }

  async onBookmarksDrop(categoryId: string, event: CdkDragDrop<unknown>): Promise<void> {
    if (event.previousIndex === event.currentIndex) {
      return;
    }

    let bookmarkType: BookmarkType | null = null;

    if (categoryId === 'events') {
      bookmarkType = 'e';
    } else if (categoryId === 'articles') {
      bookmarkType = 'a';
    } else if (categoryId === 'websites') {
      bookmarkType = 'r';
    }

    if (!bookmarkType) {
      return;
    }

    this.loading.set(true);
    try {
      await this.bookmarkService.reorderBookmarksInActiveList(
        bookmarkType,
        event.previousIndex,
        event.currentIndex
      );
    } catch (error) {
      this.logger.error('Error reordering bookmarks:', error);
      this.snackBar.open('Failed to reorder bookmarks', 'Close', { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  openManageCategories(): void {
    const dialogRef = this.dialog.open(BookmarkCategoryDialogComponent, {
      data: { categories: this.categories() },
      width: '500px',
      panelClass: 'responsive-dialog',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.categories.set(result);
        this.saveToStorage();
        this.snackBar.open('Categories updated', 'Close', { duration: 3000 });
      }
    });
  }

  async addBookmark(): Promise<void> {
    const dialogRef = this.dialog.open(AddBookmarkDialogComponent, {
      width: '500px',
      panelClass: 'responsive-dialog',
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (!result) {
      return;
    }

    this.loading.set(true);
    try {
      await this.bookmarkService.addBookmark(result.url, result.type);
      this.snackBar.open('Bookmark added successfully', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.logger.error('Error adding bookmark:', error);
      this.snackBar.open('Failed to add bookmark', 'Close', { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  editBookmark(bookmark: Bookmark, event: Event): void {
    event.stopPropagation();
    // For now, just show a message - in a full implementation this would open a dialog
    this.snackBar.open('Edit bookmark functionality - coming soon', 'Close', {
      duration: 3000,
    });
  }

  async deleteBookmark(bookmark: Bookmark, event: Event): Promise<void> {
    event.stopPropagation();

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Bookmark',
        message: `Are you sure you want to delete this bookmark?\n${bookmark.title}`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      },
    });

    const confirmed = await dialogRef.afterClosed().toPromise();
    if (!confirmed) {
      return;
    }

    this.loading.set(true);
    try {
      await this.bookmarkService.addBookmark(bookmark.id, bookmark.type); // Toggle removes it
      this.snackBar.open('Bookmark deleted successfully', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.logger.error('Error deleting bookmark:', error);
      this.snackBar.open('Failed to delete bookmark', 'Close', {
        duration: 3000,
      });
    } finally {
      this.loading.set(false);
    }
  }

  async removeArticleBookmark(articleId: string, event: Event): Promise<void> {
    event.stopPropagation();

    this.loading.set(true);
    try {
      await this.bookmarkService.addBookmark(articleId, 'a'); // Toggle removes it from current list
      this.snackBar.open('Removed from bookmark list', 'Close', {
        duration: 2000,
      });
    } catch (error) {
      this.logger.error('Error removing bookmark:', error);
      this.snackBar.open('Failed to remove bookmark', 'Close', {
        duration: 3000,
      });
    } finally {
      this.loading.set(false);
    }
  }

  openBookmark(bookmark: Bookmark): void {
    if (bookmark.type === 'r') {
      window.open(bookmark.url, '_blank');
    } else if (bookmark.type === 'a') {
      this.layout.openArticle(bookmark.id);
    } else {
      this.layout.openGenericEvent(bookmark.id);
    }
    this.logger.debug('Opening bookmark:', bookmark.url);
  }

  getCategoryById(id: string): BookmarkCategory | undefined {
    return this.categories().find(category => category.id === id);
  }

  getFormattedDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString();
  }

  getBookmarkTypeIcon(type: BookmarkType): string {
    switch (type) {
      case 'e':
        return 'event';
      case 'a':
        return 'article';
      case 'r':
        return 'link';
      default:
        return 'bookmark';
    }
  }

  getBookmarkTypeLabel(type: BookmarkType): string {
    switch (type) {
      case 'e':
        return 'Event';
      case 'a':
        return 'Article';
      case 'r':
        return 'Website';
      default:
        return 'Bookmark';
    }
  }

  getCompactEventLabel(id: string): string {
    if (id.length <= 24) {
      return id;
    }

    return `${id.slice(0, 10)}...${id.slice(-8)}`;
  }

  getCompactPubkeyLabel(pubkey: string): string {
    if (!pubkey) {
      return 'Article';
    }

    if (pubkey.length <= 24) {
      return pubkey;
    }

    return `${pubkey.slice(0, 10)}...${pubkey.slice(-8)}`;
  }

  getCompactUrlLabel(url: string): string {
    try {
      const parsed = new URL(url);
      const value = `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
      if (value.length <= 56) {
        return value;
      }

      return `${value.slice(0, 53)}...`;
    } catch {
      if (url.length <= 56) {
        return url;
      }

      return `${url.slice(0, 53)}...`;
    }
  }

  getListEventAuthorName(id: string): string {
    return this.compactEventDetails()[id]?.authorName || 'Unknown';
  }

  getListEventAuthorPicture(id: string): string | null {
    return this.compactEventDetails()[id]?.authorPicture || null;
  }

  getListEventContentPreview(id: string): string {
    return this.compactEventDetails()[id]?.contentPreview || 'Loading...';
  }

  getListAddressableAuthorName(id: string): string {
    return this.compactAddressableDetails()[id]?.authorName || 'Loading...';
  }

  getListAddressableAuthorPicture(id: string): string | null {
    return this.compactAddressableDetails()[id]?.authorPicture || null;
  }

  getListAddressableTypeLabel(id: string): string {
    return this.compactAddressableDetails()[id]?.typeLabel || 'Content';
  }

  getListAddressableContentPreview(id: string): string {
    return this.compactAddressableDetails()[id]?.contentPreview || 'Loading details...';
  }

  getListUrlTitle(id: string): string {
    return this.compactUrlDetails()[id]?.title || this.getCompactUrlLabel(id);
  }

  getListUrlSubtitle(id: string): string {
    return this.compactUrlDetails()[id]?.subtitle || this.getCompactUrlLabel(id);
  }

  private async loadCompactEventDetails(items: Array<{ id: string; relay?: string }>): Promise<void> {
    const dedupedById = new Map<string, { id: string; relay?: string }>();
    items.forEach(item => {
      if (!dedupedById.has(item.id)) {
        dedupedById.set(item.id, item);
      }
    });

    const uniqueItems = Array.from(dedupedById.values());
    const current = this.compactEventDetails();
    const missing = uniqueItems.filter(item => !current[item.id] && !this.loadingCompactEventIds.has(item.id));

    if (missing.length === 0) {
      return;
    }

    missing.forEach(item => this.loadingCompactEventIds.add(item.id));

    try {
      const updates: Record<string, CompactEventDetails> = {};

      await Promise.all(
        missing.map(async item => {
          const id = item.id;
          let event = await this.database.getEventById(id);

          if (!event) {
            const record = await this.data.getEventById(id, { cache: true, save: true }, false);
            event = record?.event || null;
          }

          if (!event && item.relay) {
            event = await this.relayPool.getEventById([item.relay], id, 4000);
            if (event) {
              await this.database.saveEvent(event);
            }
          }

          if (!event) {
            const retries = this.compactEventRetryCounts.get(id) || 0;
            if (retries < 2) {
              this.compactEventRetryCounts.set(id, retries + 1);
              setTimeout(() => {
                void this.loadCompactEventDetails([item]);
              }, 1500 * (retries + 1));
            } else {
              updates[id] = {
                contentPreview: 'Unavailable event',
                authorPubkey: '',
                authorName: 'Unknown',
                authorPicture: null,
              };
            }
            return;
          }

          this.compactEventRetryCounts.delete(id);
          const preview = this.toCompactPreview(event.content);
          const authorPubkey = event.pubkey;

          let authorName = this.getCompactPubkeyLabel(authorPubkey);
          let authorPicture: string | null = null;

          if (authorPubkey) {
            const cachedProfile = this.data.getCachedProfile(authorPubkey);
            const profile = cachedProfile || (await this.data.getProfile(authorPubkey));
            const profileData = profile?.data as Record<string, unknown> | undefined;

            if (profileData) {
              const displayName = typeof profileData['display_name'] === 'string'
                ? profileData['display_name']
                : typeof profileData['name'] === 'string'
                  ? profileData['name']
                  : '';
              const picture = typeof profileData['picture'] === 'string' ? profileData['picture'] : '';

              if (displayName) {
                authorName = displayName;
              }
              if (picture) {
                authorPicture = picture;
              }
            }
          }

          updates[id] = {
            contentPreview: preview,
            authorPubkey,
            authorName,
            authorPicture,
          };
        })
      );

      this.compactEventDetails.update(existing => ({
        ...existing,
        ...updates,
      }));
    } finally {
      missing.forEach(item => this.loadingCompactEventIds.delete(item.id));
    }
  }

  private toCompactPreview(content: string): string {
    if (!content) {
      return '[no content]';
    }

    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return '[no content]';
    }

    if (normalized.length <= 90) {
      return normalized;
    }

    return `${normalized.slice(0, 87)}...`;
  }

  private getAddressableTypeLabel(kind: number): string {
    if (kind === 30023) {
      return 'Article';
    }

    if (kind === 30311) {
      return 'Live';
    }

    if (kind === 30315) {
      return 'Music';
    }

    if (kind === 30402) {
      return 'Video';
    }

    if (kind === 31990 || kind === 31989) {
      return 'Calendar';
    }

    return 'Content';
  }

  private getTagValue(eventTags: string[][], keys: string[]): string {
    for (const key of keys) {
      const value = eventTags.find(tag => tag[0] === key)?.[1];
      if (value) {
        return value;
      }
    }

    return '';
  }

  private async resolveAuthorProfile(pubkey: string): Promise<{ name: string; picture: string | null }> {
    if (!pubkey) {
      return { name: 'Unknown', picture: null };
    }

    let name = this.getCompactPubkeyLabel(pubkey);
    let picture: string | null = null;

    const cachedProfile = this.data.getCachedProfile(pubkey);
    const profile = cachedProfile || (await this.data.getProfile(pubkey));
    const profileData = profile?.data as Record<string, unknown> | undefined;

    if (profileData) {
      const displayName = typeof profileData['display_name'] === 'string'
        ? profileData['display_name']
        : typeof profileData['name'] === 'string'
          ? profileData['name']
          : '';
      const pictureUrl = typeof profileData['picture'] === 'string' ? profileData['picture'] : '';

      if (displayName) {
        name = displayName;
      }

      if (pictureUrl) {
        picture = pictureUrl;
      }
    }

    return { name, picture };
  }

  private async loadCompactAddressableDetails(items: Array<{ id: string; relay?: string }>): Promise<void> {
    const dedupedById = new Map<string, { id: string; relay?: string }>();
    items.forEach(item => {
      if (!dedupedById.has(item.id)) {
        dedupedById.set(item.id, item);
      }
    });

    const uniqueItems = Array.from(dedupedById.values());
    const current = this.compactAddressableDetails();
    const missing = uniqueItems.filter(item => !current[item.id] && !this.loadingCompactAddressableIds.has(item.id));

    if (missing.length === 0) {
      return;
    }

    missing.forEach(item => this.loadingCompactAddressableIds.add(item.id));

    try {
      const updates: Record<string, CompactAddressableDetails> = {};

      await Promise.all(
        missing.map(async item => {
          const parsed = this.bookmarkService.parseArticleId(item.id);
          const typeLabel = this.getAddressableTypeLabel(parsed.kind);

          if (!parsed.slug) {
            const author = await this.resolveAuthorProfile(parsed.id);
            updates[item.id] = {
              typeLabel,
              contentPreview: this.getCompactPubkeyLabel(parsed.id),
              authorName: author.name,
              authorPicture: author.picture,
            };
            return;
          }

          let record = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
            parsed.id,
            parsed.kind,
            parsed.slug,
            { cache: true, save: true }
          );

          if (!record?.event && item.relay) {
            const fallbackEvent = await this.relayPool.get(
              [item.relay],
              {
                authors: [parsed.id],
                kinds: [parsed.kind],
                '#d': [parsed.slug],
              },
              4500
            );

            if (fallbackEvent) {
              await this.database.saveEvent(fallbackEvent);
              record = { event: fallbackEvent, data: fallbackEvent.content };
            }
          }

          const author = await this.resolveAuthorProfile(parsed.id);
          const event = record?.event;

          const tagTitle = event ? this.getTagValue(event.tags, ['title', 'name', 'subject', 'alt']) : '';
          const contentSource = tagTitle || (event ? this.toCompactPreview(event.content) : '') || parsed.slug;

          updates[item.id] = {
            typeLabel,
            contentPreview: this.toCompactPreview(contentSource),
            authorName: author.name,
            authorPicture: author.picture,
          };
        })
      );

      this.compactAddressableDetails.update(existing => ({
        ...existing,
        ...updates,
      }));
    } finally {
      missing.forEach(item => this.loadingCompactAddressableIds.delete(item.id));
    }
  }

  private async loadCompactUrlDetails(items: Array<{ id: string }>): Promise<void> {
    const deduped = Array.from(new Set(items.map(item => item.id)));
    const current = this.compactUrlDetails();
    const missing = deduped.filter(id => !current[id] && !this.loadingCompactUrlIds.has(id));

    if (missing.length === 0) {
      return;
    }

    missing.forEach(id => this.loadingCompactUrlIds.add(id));

    try {
      const updates: Record<string, CompactUrlDetails> = {};

      await Promise.all(
        missing.map(async url => {
          try {
            const meta = await this.openGraph.getOpenGraphData(url);
            const fallbackTitle = this.getCompactUrlLabel(url);
            const subtitle = meta.description || meta.siteName || new URL(url).hostname;

            updates[url] = {
              title: meta.title || fallbackTitle,
              subtitle: this.toCompactPreview(subtitle || fallbackTitle),
            };
          } catch {
            updates[url] = {
              title: this.getCompactUrlLabel(url),
              subtitle: this.getCompactUrlLabel(url),
            };
          }
        })
      );

      this.compactUrlDetails.update(existing => ({
        ...existing,
        ...updates,
      }));
    } finally {
      missing.forEach(id => this.loadingCompactUrlIds.delete(id));
    }
  }

  openEventBookmark(id: string): void {
    this.layout.openGenericEvent(id);
  }

  openArticleBookmark(id: string): void {
    this.layout.openArticle(id);
  }

  openUrlBookmark(url: string): void {
    window.open(url, '_blank');
  }

  async removeEventBookmark(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    this.loading.set(true);
    try {
      await this.bookmarkService.addBookmark(id, 'e');
      this.snackBar.open('Removed from bookmark list', 'Close', { duration: 2000 });
    } catch (error) {
      this.logger.error('Error removing bookmark:', error);
      this.snackBar.open('Failed to remove bookmark', 'Close', { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  async removeUrlBookmark(url: string, event: Event): Promise<void> {
    event.stopPropagation();
    this.loading.set(true);
    try {
      await this.bookmarkService.addBookmark(url, 'r');
      this.snackBar.open('Removed from bookmark list', 'Close', { duration: 2000 });
    } catch (error) {
      this.logger.error('Error removing bookmark:', error);
      this.snackBar.open('Failed to remove bookmark', 'Close', { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  async onListChange(listId: string) {
    this.bookmarkService.selectedListId.set(listId);

    // Decrypt private list content on-demand when user selects it
    if (listId !== 'default') {
      await this.bookmarkService.decryptPrivateList(listId);
    }
  }

  async createNewList() {
    const dialogRef = this.dialog.open(CreateListDialogComponent, {
      width: '500px',
      panelClass: 'responsive-dialog'
    });

    const result = await dialogRef.afterClosed().toPromise();

    if (result) {
      const newList = await this.bookmarkService.createBookmarkList(result.name, result.id, result.isPrivate);
      if (newList) {
        this.snackBar.open(`Created "${result.name}"`, 'Close', { duration: 2000 });
        this.bookmarkService.selectedListId.set(newList.id);
      }
    }
  }

  async renameCurrentList() {
    const currentListId = this.bookmarkService.selectedListId();
    const currentList = this.bookmarkService.allBookmarkLists().find(l => l.id === currentListId);

    if (!currentList) {
      return;
    }

    const dialogRef = this.dialog.open(CreateListDialogComponent, {
      width: '500px',
      panelClass: 'responsive-dialog',
      data: { name: currentList.name, id: currentListId, isRename: true }
    });

    const result = await dialogRef.afterClosed().toPromise();

    if (result && result.name.trim() !== currentList.name) {
      await this.bookmarkService.updateBookmarkList(currentListId, result.name.trim());
      this.snackBar.open(`Renamed to "${result.name.trim()}"`, 'Close', { duration: 2000 });
    }
  }

  async toggleListPrivacy() {
    const list = this.currentList();
    if (!list) {
      return;
    }

    const newState = list.isPrivate ? 'public' : 'private';
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `Make List ${list.isPrivate ? 'Public' : 'Private'}`,
        message: list.isPrivate
          ? `Are you sure you want to make "${list.name}" public? The bookmarks will be visible to everyone.`
          : `Are you sure you want to make "${list.name}" private? The bookmarks will be encrypted and only visible to you.`,
        confirmText: `Make ${list.isPrivate ? 'Public' : 'Private'}`,
        cancelText: 'Cancel',
      },
    });

    const confirmed = await dialogRef.afterClosed().toPromise();

    if (confirmed) {
      await this.bookmarkService.toggleListPrivacy(list.id);
      this.snackBar.open(`List is now ${newState}`, 'Close', { duration: 2000 });
    }
  }

  async deleteCurrentList() {
    const currentListId = this.bookmarkService.selectedListId();
    const currentList = this.bookmarkService.allBookmarkLists().find(l => l.id === currentListId);

    if (!currentList) {
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Bookmark List',
        message: `Are you sure you want to delete "${currentList.name}"? This will remove all bookmarks in this list.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn'
      }
    });

    const confirmed = await dialogRef.afterClosed().toPromise();

    if (confirmed) {
      await this.bookmarkService.deleteBookmarkList(currentListId);
      this.snackBar.open(`Deleted "${currentList.name}"`, 'Close', { duration: 2000 });
    }
  }
}
