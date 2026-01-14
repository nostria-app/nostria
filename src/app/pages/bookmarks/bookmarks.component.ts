import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';

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
import { LoggerService } from '../../services/logger.service';
import { BookmarkCategoryDialogComponent } from './bookmark-category-dialog/bookmark-category-dialog.component';
import { AddBookmarkDialogComponent } from './add-bookmark-dialog/add-bookmark-dialog.component';
import { BookmarkService, BookmarkType } from '../../services/bookmark.service';
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

export type ViewMode = 'tiles' | 'content';

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

  // Loading states
  loading = signal(false);

  // Pagination for continuous scrolling
  private readonly PAGE_SIZE = 10;
  displayedEventCount = signal(this.PAGE_SIZE);
  displayedArticleCount = signal(this.PAGE_SIZE);
  displayedUrlCount = signal(this.PAGE_SIZE);

  // Default categories with types
  categories = signal<BookmarkCategory[]>([
    { id: 'events', name: 'Notes', color: '#2196f3' },
    { id: 'articles', name: 'Articles', color: '#4caf50' },
    { id: 'websites', name: 'Websites', color: '#ff9800' },
  ]);

  // Current state
  searchQuery = signal('');
  selectedCategory = signal('events');
  viewMode = signal<ViewMode>('content');

  // Paginated/sliced bookmarks for display
  displayedEvents = computed(() => {
    const events = this.bookmarkService.bookmarkEvents();
    const count = this.displayedEventCount();
    return events.slice(0, count);
  });

  displayedArticles = computed(() => {
    const articles = this.bookmarkService.bookmarkArticles();
    const count = this.displayedArticleCount();
    return articles.slice(0, count);
  });

  displayedUrls = computed(() => {
    const urls = this.bookmarkService.bookmarkUrls();
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
    const category = this.selectedCategory();

    if (category === 'events') {
      const current = this.displayedEventCount();
      const total = this.bookmarkService.bookmarkEvents().length;
      if (current < total) {
        this.displayedEventCount.set(Math.min(current + this.PAGE_SIZE, total));
        console.log(`[Bookmarks] Loaded more events: ${this.displayedEventCount()}/${total}`);
      }
    } else if (category === 'articles') {
      const current = this.displayedArticleCount();
      const total = this.bookmarkService.bookmarkArticles().length;
      if (current < total) {
        this.displayedArticleCount.set(Math.min(current + this.PAGE_SIZE, total));
        console.log(`[Bookmarks] Loaded more articles: ${this.displayedArticleCount()}/${total}`);
      }
    } else if (category === 'websites') {
      const current = this.displayedUrlCount();
      const total = this.bookmarkService.bookmarkUrls().length;
      if (current < total) {
        this.displayedUrlCount.set(Math.min(current + this.PAGE_SIZE, total));
        console.log(`[Bookmarks] Loaded more URLs: ${this.displayedUrlCount()}/${total}`);
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
        if (['tiles', 'content'].includes(viewMode)) {
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

  getViewIcon(): string {
    switch (this.viewMode()) {
      case 'tiles':
        return 'grid_view';
      case 'content':
        return 'view_agenda';
      default:
        return 'view_agenda';
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

    if (!confirm(`Are you sure you want to delete this bookmark?\n${bookmark.title}`)) {
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
