import { Component, inject, signal, effect, OnInit } from '@angular/core';

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
import { EventComponent } from '../../components/event/event.component';
import { ArticleComponent } from '../../components/article/article.component';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';

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

  // Loading states
  loading = signal(false);

  // Default categories with types
  categories = signal<BookmarkCategory[]>([
    { id: 'events', name: 'Events', color: '#2196f3' },
    { id: 'articles', name: 'Articles', color: '#4caf50' },
    { id: 'websites', name: 'Websites', color: '#ff9800' },
  ]);

  // Current state
  searchQuery = signal('');
  selectedCategory = signal('events');
  viewMode = signal<ViewMode>('content');

  constructor() {
    // Load categories and view preference from storage
    this.loadFromStorage();

    effect(() => {
      this.logger.debug('Selected category changed:', this.selectedCategory());
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

  onListChange(listId: string) {
    this.bookmarkService.selectedListId.set(listId);
  }

  async createNewList() {
    const name = prompt('Enter a name for the new bookmark list:');

    if (name && name.trim()) {
      const newList = await this.bookmarkService.createBookmarkList(name.trim());
      if (newList) {
        this.snackBar.open(`Created "${name.trim()}"`, 'Close', { duration: 2000 });
        this.bookmarkService.selectedListId.set(newList.id);
      }
    }
  }

  async renameCurrentList() {
    const currentListId = this.bookmarkService.selectedListId();
    const currentList = this.bookmarkService.allBookmarkLists().find(l => l.id === currentListId);

    if (!currentList || currentList.isDefault) {
      return;
    }

    const name = prompt('Enter a new name for this bookmark list:', currentList.name);

    if (name && name.trim() && name.trim() !== currentList.name) {
      await this.bookmarkService.updateBookmarkList(currentListId, name.trim());
      this.snackBar.open(`Renamed to "${name.trim()}"`, 'Close', { duration: 2000 });
    }
  }

  async deleteCurrentList() {
    const currentListId = this.bookmarkService.selectedListId();
    const currentList = this.bookmarkService.allBookmarkLists().find(l => l.id === currentListId);

    if (!currentList || currentList.isDefault) {
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
