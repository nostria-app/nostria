import { Component, inject, signal, computed, effect } from '@angular/core';

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
import { LoggerService } from '../../services/logger.service';
import { BookmarkCategoryDialogComponent } from './bookmark-category-dialog/bookmark-category-dialog.component';
import { BookmarkService, BookmarkType } from '../../services/bookmark.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { ApplicationStateService } from '../../services/application-state.service';
import { Router } from '@angular/router';
import { LayoutService } from '../../services/layout.service';
import { EventComponent } from '../../components/event/event.component';
import { ArticleComponent } from '../../components/article/article.component';

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

@Component({
  selector: 'app-bookmarks',
  standalone: true,
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
    EventComponent,
    ArticleComponent,
  ],
  templateUrl: './bookmarks.component.html',
  styleUrl: './bookmarks.component.scss',
})
export class BookmarksComponent {
  private logger = inject(LoggerService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private localStorage = inject(LocalStorageService);
  bookmarkService = inject(BookmarkService);
  private appState = inject(ApplicationStateService);
  private router = inject(Router);
  layout = inject(LayoutService);

  // Loading states
  loading = signal(false);

  // Bookmark data from service
  // bookmarks = computed(() => {
  //   const events = this.bookmarkService.bookmarkEvents().map(b => ({
  //     id: b.id,
  //     title: `Event ${b.id.substring(0, 8)}...`,
  //     url: `/e/${b.id}`,
  //     description: 'Nostr event bookmark',
  //     categories: ['all', 'events'],
  //     type: 'e' as BookmarkType,
  //     createdAt: Date.now(),
  //     updatedAt: Date.now()
  //   }));

  //   const articles = this.bookmarkService.bookmarkArticles().map(b => ({
  //     id: b.id,
  //     title: `Article ${b.id.substring(0, 8)}...`,
  //     url: `/a/${b.id}`,
  //     description: 'Nostr article bookmark',
  //     categories: ['all', 'articles'],
  //     type: 'a' as BookmarkType,
  //     createdAt: Date.now(),
  //     updatedAt: Date.now()
  //   }));

  //   const urls = this.bookmarkService.bookmarkUrls().map(b => ({
  //     id: b.id,
  //     title: this.extractTitleFromUrl(b.id),
  //     url: b.id,
  //     description: 'Website bookmark',
  //     categories: ['all', 'websites'],
  //     type: 'r' as BookmarkType,
  //     createdAt: Date.now(),
  //     updatedAt: Date.now()
  //   }));

  //   return [...events, ...articles, ...urls];
  // });

  // Default categories with types
  categories = signal<BookmarkCategory[]>([
    { id: 'events', name: 'Events', color: '#2196f3' },
    { id: 'articles', name: 'Articles', color: '#4caf50' },
    { id: 'websites', name: 'Websites', color: '#ff9800' },
  ]);

  // Current state
  searchQuery = signal('');
  selectedCategory = signal('events');

  // Computed state for filtered bookmarks
  // filteredBookmarks = computed(() => {
  //   const search = this.searchQuery().toLowerCase().trim();
  //   const category = this.selectedCategory();

  //   return this.bookmarks().filter(bookmark => {
  //     // First filter by category
  //     if (category !== 'all' && !bookmark.categories.includes(category)) {
  //       return false;
  //     }

  //     // Then filter by search query if present
  //     if (search) {
  //       return (
  //         bookmark.title.toLowerCase().includes(search) ||
  //         bookmark.url.toLowerCase().includes(search) ||
  //         (bookmark.description?.toLowerCase().includes(search) ?? false)
  //       );
  //     }

  //     return true;
  //   });
  // });

  constructor() {
    // Load categories from storage
    this.loadFromStorage();

    effect(() => {
      this.logger.debug('Selected category changed:', this.selectedCategory());
    });

    effect(() => {
      this.logger.debug('Search query changed:', this.searchQuery());
    });

    // Log bookmark changes
    // effect(() => {
    //   this.logger.debug('Bookmarks updated:', this.bookmarks());
    // });
  }

  // private extractTitleFromUrl(url: string): string {
  //   try {
  //     const urlObj = new URL(url);
  //     const hostname = urlObj.hostname.replace('www.', '');
  //     const pathSegments = urlObj.pathname.split('/').filter(segment => segment);

  //     if (pathSegments.length > 0) {
  //       return `${hostname}/${pathSegments[0]}`;
  //     }

  //     return hostname;
  //   } catch {
  //     return url.length > 30 ? url.substring(0, 30) + '...' : url;
  //   }
  // }

  private loadFromStorage(): void {
    this.logger.debug('Loading categories from storage');

    const savedCategories = this.localStorage.getItem('bookmark_categories');
    if (savedCategories) {
      try {
        const parsedCategories = JSON.parse(savedCategories);
        if (Array.isArray(parsedCategories) && parsedCategories.length > 0) {
          this.categories.set(parsedCategories);
          this.logger.debug(
            'Loaded categories from storage:',
            parsedCategories
          );
        }
      } catch (error) {
        this.logger.error('Error parsing saved categories:', error);
      }
    }
  }

  private saveToStorage(): void {
    this.localStorage.setItem(
      'bookmark_categories',
      JSON.stringify(this.categories())
    );
    this.logger.debug('Categories saved to storage');
  }

  // Actions
  selectCategory(categoryId: string): void {
    this.selectedCategory.set(categoryId);
  }

  openManageCategories(): void {
    const dialogRef = this.dialog.open(BookmarkCategoryDialogComponent, {
      data: { categories: this.categories() },
      width: '500px',
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
    // Simple prompt for now - in a full implementation this would be a dialog
    const url = prompt('Enter URL to bookmark:');
    if (!url?.trim()) {
      return;
    }

    this.loading.set(true);
    try {
      await this.bookmarkService.addBookmark(url.trim(), 'r');
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

    if (
      !confirm(
        `Are you sure you want to delete this bookmark?\n${bookmark.title}`
      )
    ) {
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

  openBookmark(bookmark: Bookmark): void {
    if (bookmark.type === 'r') {
      window.open(bookmark.url, '_blank');
    } else {
      // For events and articles, navigate within the app
      // this.router.navigate([bookmark.url]);
      this.layout.openEvent(bookmark.id);
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
}
