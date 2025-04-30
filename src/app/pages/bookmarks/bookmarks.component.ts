import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { LoggerService } from '../../services/logger.service';
import { BookmarkCategoryDialogComponent } from './bookmark-category-dialog/bookmark-category-dialog.component';
import { StorageService } from '../../services/storage.service';
import { LocalStorageService } from '../../services/local-storage.service';

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  description?: string;
  categories: string[];
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
    CommonModule,
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
    MatSnackBarModule
  ],
  templateUrl: './bookmarks.component.html',
  styleUrl: './bookmarks.component.scss'
})
export class BookmarksComponent {
  private logger = inject(LoggerService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private localStorage = inject(LocalStorageService);
  private storageService = inject(StorageService);

  // Mock data
  bookmarks = signal<Bookmark[]>([
    {
      id: '1',
      title: 'Nostr Protocol',
      url: 'https://nostr.com/',
      description: 'Official site for the Nostr protocol, a simple open protocol that enables truly censorship-resistant and global social network.',
      categories: ['all', 'nostr', 'dev'],
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
      updatedAt: Date.now() - 30 * 24 * 60 * 60 * 1000
    },
    {
      id: '2',
      title: 'GitHub: Nostr Implementation',
      url: 'https://github.com/nostr-protocol/nostr',
      description: 'Implementation of the Nostr protocol.',
      categories: ['all', 'nostr', 'dev', 'github'],
      createdAt: Date.now() - 25 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 25 * 24 * 60 * 60 * 1000
    },
    {
      id: '3',
      title: 'Nostria Documentation',
      url: 'https://docs.nostria.com',
      description: 'Comprehensive documentation for the Nostria application.',
      categories: ['all', 'nostria', 'documentation'],
      createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 18 * 24 * 60 * 60 * 1000
    },
    {
      id: '4',
      title: 'Angular Documentation',
      url: 'https://angular.io/docs',
      description: 'Official documentation for Angular framework.',
      categories: ['all', 'dev', 'frontend'],
      createdAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 15 * 24 * 60 * 60 * 1000
    },
    {
      id: '5',
      title: 'Nostr Resources',
      url: 'https://nostr-resources.com',
      description: 'Collection of resources for learning about and developing with Nostr.',
      categories: ['all', 'nostr', 'resources'],
      createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 10 * 24 * 60 * 60 * 1000
    },
    {
      id: '6',
      title: 'Lightning Network',
      url: 'https://lightning.network',
      description: 'Learn about the Lightning Network for Bitcoin.',
      categories: ['all', 'crypto', 'bitcoin'],
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000
    }
  ]);

  // Default categories with "All" as the first option
  categories = signal<BookmarkCategory[]>([
    { id: 'all', name: 'All', color: '#9c27b0' },
    { id: 'nostr', name: 'Nostr', color: '#2196f3' },
    { id: 'dev', name: 'Development', color: '#4caf50' },
    { id: 'github', name: 'GitHub', color: '#607d8b' },
    { id: 'nostria', name: 'Nostria', color: '#ff9800' },
    { id: 'documentation', name: 'Documentation', color: '#795548' },
    { id: 'frontend', name: 'Frontend', color: '#e91e63' },
    { id: 'resources', name: 'Resources', color: '#00bcd4' },
    { id: 'crypto', name: 'Crypto', color: '#673ab7' },
    { id: 'bitcoin', name: 'Bitcoin', color: '#ff5722' }
  ]);
  
  // Current state
  searchQuery = signal('');
  selectedCategory = signal('all');
  
  // Computed state for filtered bookmarks
  filteredBookmarks = computed(() => {
    const search = this.searchQuery().toLowerCase().trim();
    const category = this.selectedCategory();
    
    return this.bookmarks().filter(bookmark => {
      // First filter by category
      if (category !== 'all' && !bookmark.categories.includes(category)) {
        return false;
      }
      
      // Then filter by search query if present
      if (search) {
        return (
          bookmark.title.toLowerCase().includes(search) ||
          bookmark.url.toLowerCase().includes(search) ||
          (bookmark.description?.toLowerCase().includes(search) ?? false)
        );
      }
      
      return true;
    });
  });

  constructor() {
    // Load bookmarks and categories from storage
    this.loadFromStorage();

    effect(() => {
      this.logger.debug('Selected category changed:', this.selectedCategory());
    });
    
    effect(() => {
      this.logger.debug('Search query changed:', this.searchQuery());
    });
  }
  
  private loadFromStorage(): void {
    // In a real implementation, this would load from persistent storage
    // For now, we're just using the mock data
    this.logger.debug('Loading bookmarks from storage');
    
    // Try to load categories from local storage
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
  }
  
  private saveToStorage(): void {
    // Save categories to local storage
    this.localStorage.setItem('bookmark_categories', JSON.stringify(this.categories()));
    this.logger.debug('Categories saved to storage');
    
    // In a real implementation, this would save bookmarks to persistent storage as well
  }
  
  // Actions
  selectCategory(categoryId: string): void {
    this.selectedCategory.set(categoryId);
  }
  
  openManageCategories(): void {
    const dialogRef = this.dialog.open(BookmarkCategoryDialogComponent, {
      data: { categories: this.categories() },
      width: '500px'
    });
    
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.categories.set(result);
        this.saveToStorage();
        this.snackBar.open('Categories updated', 'Close', { duration: 3000 });
      }
    });
  }
  
  addBookmark(): void {
    // This would open a dialog to add a new bookmark
    // For now, just show a message
    this.snackBar.open('Add bookmark functionality would open a dialog', 'Close', { duration: 3000 });
  }
  
  editBookmark(bookmark: Bookmark, event: Event): void {
    event.stopPropagation();
    this.snackBar.open('Edit bookmark functionality would open a dialog', 'Close', { duration: 3000 });
  }
  
  deleteBookmark(bookmark: Bookmark, event: Event): void {
    event.stopPropagation();
    this.snackBar.open('Delete bookmark functionality would show a confirmation', 'Close', { duration: 3000 });
  }
  
  openBookmark(bookmark: Bookmark): void {
    window.open(bookmark.url, '_blank');
    this.logger.debug('Opening bookmark:', bookmark.url);
  }
  
  getCategoryById(id: string): BookmarkCategory | undefined {
    return this.categories().find(category => category.id === id);
  }
  
  getFormattedDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString();
  }
}