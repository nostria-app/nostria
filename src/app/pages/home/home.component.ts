import { Component, ViewChild, ElementRef, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NostrService } from '../../services/nostr.service';
import { NotificationService } from '../../services/notification.service';
import { LayoutService } from '../../services/layout.service';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { NewFeedDialogComponent } from './new-feed-dialog/new-feed-dialog.component';
import { NewColumnDialogComponent } from './new-column-dialog/new-column-dialog.component';
import { RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog.component';
import { LocalStorageService } from '../../services/local-storage.service';
import { LoggerService } from '../../services/logger.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FeedService, FeedConfig } from '../../services/feed.service';
import { FeedsCollectionService, FeedDefinition, ColumnDefinition } from '../../services/feeds-collection.service';
import { NostrRecord } from '../../interfaces';
import { Event } from 'nostr-tools';
import { decode } from 'blurhash';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';

interface NavLink {
  id: string;
  path: string;
  label: string;
  icon: string;
  filters?: Record<string, any>;
}

const DEFAULT_COLUMNS: NavLink[] = [
  { id: 'notes', path: 'notes', label: 'Notes', icon: 'chat' },
  // { id: 'replies', path: 'replies', label: 'Replies', icon: 'reply_all' },
  // { id: 'reads', path: 'reads', label: 'Reads', icon: 'bookmark' },
  // { id: 'media', path: 'media', label: 'Media', icon: 'image' }
];

@Component({
  selector: 'app-home',
  standalone: true,  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatChipsModule,
    MatMenuModule,
    MatTooltipModule,
    DragDropModule,
    RouterModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {  // Services
  private nostrService = inject(NostrService);
  private notificationService = inject(NotificationService);
  private layoutService = inject(LayoutService);
  private dialog = inject(MatDialog);
  feedService = inject(FeedService);
  feedsCollectionService = inject(FeedsCollectionService);
  private logger = inject(LoggerService);

  // UI State Signals
  activeSection = signal<'discover' | 'following' | 'media'>('discover');
  isLoading = signal(false);
  showAdvancedFilters = signal(false);
  selectedTags = signal<string[]>([]);
  screenWidth = signal(window.innerWidth);
  columnLayout = computed(() => {
    const width = this.screenWidth();
    if (width >= 1600) {
      return 'three-columns-layout';
    } else if (width >= 1024) {
      return 'two-columns-layout';
    } else {
      return 'one-column-layout';
    }
  });

  isMobileView = computed(() => {
    const isMobile = this.screenWidth() < 1024;
    return isMobile;
  });

  // Content Signals
  trendingEvents = signal<NostrRecord[]>([]);
  followingEvents = signal<NostrRecord[]>([]);
  mediaEvents = signal<NostrRecord[]>([]);
  availableTags = signal<string[]>(['nostr', 'bitcoin', 'programming', 'art', 'music', 'photography', 'news', 'sports']);

  // Computed Signals for Filtered Content
  filteredTrending = computed(() => {
    const tags = this.selectedTags();
    if (tags.length === 0) {
      return this.trendingEvents();
    } else {
      return this.trendingEvents().filter(event =>
        event.event.tags.some(tag => tag[0] === 't' && tags.includes(tag[1]))
      );
    }
  });

  filteredFollowing = computed(() => {
    const tags = this.selectedTags();
    if (tags.length === 0) {
      return this.followingEvents();
    } else {
      return this.followingEvents().filter(event =>
        event.event.tags.some(tag => tag[0] === 't' && tags.includes(tag[1]))
      );
    }
  });

  filteredMedia = computed(() => {
    const tags = this.selectedTags();
    if (tags.length === 0) {
      return this.mediaEvents();
    } else {
      return this.mediaEvents().filter(event =>
        event.event.tags.some(tag => tag[0] === 't' && tags.includes(tag[1]))
      );
    }
  });  // Replace getEventsForColumn method with computed signal that uses feedService's reactive data
  columnEvents = computed(() => {
    const eventsMap = new Map<string, Event[]>();
    // Access the feedDataMap from feedService which is properly reactive
    const feedDataMap = this.feedService.feedDataMap();
    feedDataMap.forEach((eventsSignal, feedId) => {
      eventsMap.set(feedId, eventsSignal());
    });
    return eventsMap;
  });

  // Remove the old getEventsForColumn method
  // getEventsForColumn(columnId: string): Event[] {
  //   console.log(`Fetching events for column: ${columnId}`);
  //   console.log('Available feeds:', this.feedService.data.keys());
  //   return this.feedService.data.get(columnId)?.events() || [];
  // }
  // Replace the old columns signal with columns from active feed
  feeds = computed(() => this.feedsCollectionService.feeds());
  activeFeed = computed(() => this.feedsCollectionService.activeFeed());
  columns = computed<ColumnDefinition[]>(() => this.feedsCollectionService.getActiveColumns());

  // Update columns computed to map from feeds
  // columns = computed(() => {
  //   return this.feeds().map(feed => ({
  //     id: feed.id,
  //     path: feed.path || feed.id,
  //     label: feed.label,
  //     icon: feed.icon,
  //     filters: feed.filters
  //   } as NavLink));
  // });

  // Signals for state management
  visibleColumnIndex = signal(0);
  columnContentLoaded = signal<Record<string, boolean>>({});

  // Reference to columns wrapper for scrolling
  @ViewChild('columnsWrapper') columnsWrapper!: ElementRef<HTMLDivElement>;

  // Signals to track scroll position
  private scrollPosition = signal(0);
  private maxScroll = signal(0);

  // Computed signals for scroll indicators
  canScrollLeft = computed(() => this.scrollPosition() > 0);
  canScrollRight = computed(() => {
    const maxScroll = this.maxScroll();
    return maxScroll > 0 && this.scrollPosition() < maxScroll;
  });

  constructor() {
    // Initialize data loading
    this.loadTrendingContent();

    // Set up responsive layout
    effect(() => {
      const handleResize = () => {
        this.screenWidth.set(window.innerWidth);
      };

      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    });

    // Automatic refresh effect
    effect(() => {
      const interval = setInterval(() => {
        this.loadTrendingContent(true);
      }, 60000); // Refresh every minute

      return () => {
        clearInterval(interval);
      };
    });
  }

  setActiveSection(section: 'discover' | 'following' | 'media'): void {
    this.activeSection.set(section);

    // Load section data if needed
    switch (section) {
      case 'following':
        if (this.followingEvents().length === 0) {
          this.loadFollowingContent();
        }
        break;
      case 'media':
        if (this.mediaEvents().length === 0) {
          this.loadMediaContent();
        }
        break;
    }
  }

  async loadTrendingContent(silent = false): Promise<void> {
    if (!silent) {
      this.isLoading.set(true);
    }

    try {
      const events = await this.fetchTrendingEvents();
      this.trendingEvents.set(events);
      if (!silent) {
        this.notificationService.notify('Trending content updated');
      }
    } catch (error) {
      console.error('Failed to load trending content:', error);
      if (!silent) {
        this.notificationService.notify('Failed to load trending content', 'error');
      }
    } finally {
      if (!silent) {
        this.isLoading.set(false);
      }
    }
  }

  async loadFollowingContent(): Promise<void> {
    this.isLoading.set(true);

    try {
      const events = await this.fetchFollowingEvents();
      this.followingEvents.set(events);
    } catch (error) {
      console.error('Failed to load following content:', error);
      this.notificationService.notify('Failed to load following content', 'error');
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadMediaContent(): Promise<void> {
    this.isLoading.set(true);

    try {
      const events = await this.fetchMediaEvents();
      this.mediaEvents.set(events);
    } catch (error) {
      console.error('Failed to load media content:', error);
      this.notificationService.notify('Failed to load media content', 'error');
    } finally {
      this.isLoading.set(false);
    }
  }

  async fetchTrendingEvents(): Promise<NostrRecord[]> {
    // Example implementation - would be replaced with actual fetch from nostrService
    const response = await fetch('/api/trending');
    if (!response.ok) {
      throw new Error('Failed to fetch trending events');
    }

    return await response.json() as NostrRecord[];
  }

  async fetchFollowingEvents(): Promise<NostrRecord[]> {
    // Example implementation - would be replaced with actual fetch from nostrService
    const response = await fetch('/api/following');
    if (!response.ok) {
      throw new Error('Failed to fetch following events');
    }

    return await response.json() as NostrRecord[];
  }

  async fetchMediaEvents(): Promise<NostrRecord[]> {
    // Example implementation - would be replaced with actual fetch from nostrService
    const response = await fetch('/api/media');
    if (!response.ok) {
      throw new Error('Failed to fetch media events');
    }

    return await response.json() as NostrRecord[];
  }

  toggleAdvancedFilters(): void {
    this.showAdvancedFilters.update(value => !value);
  }

  toggleTagFilter(tag: string): void {
    this.selectedTags.update(tags => {
      if (tags.includes(tag)) {
        return tags.filter(t => t !== tag);
      } else {
        return [...tags, tag];
      }
    });
  }

  refreshContent(): void {
    switch (this.activeSection()) {
      case 'discover':
        this.loadTrendingContent();
        break;
      case 'following':
        this.loadFollowingContent();
        break;
      case 'media':
        this.loadMediaContent();
        break;
    }
  }

  shareContent(event: NostrRecord): void {
    // Implement share functionality
    this.notificationService.notify('Content shared');
  }

  bookmarkContent(event: NostrRecord): void {
    // Implement bookmark functionality 
    this.notificationService.notify('Content bookmarked');
  }

  selectColumn(index: number): void {
    console.log(`Selecting column ${index}`);
    this.visibleColumnIndex.set(index);
    this.loadColumnContentIfNeeded(index);
  }

  loadColumnContentIfNeeded(index: number): void {
    const selectedColumn = this.columns()[index];
    if (!selectedColumn) return;

    const columnId = selectedColumn.id;

    if (!this.columnContentLoaded()[columnId]) {
      this.isLoading.set(true);

      // Simulate loading content for this specific column
      setTimeout(() => {
        this.columnContentLoaded.update(loaded => ({
          ...loaded,
          [columnId]: true
        }));
        this.isLoading.set(false);
      }, 1000);
    }
  }

  handleColumnKeydown(event: KeyboardEvent, index: number): void {
    const columnCount = this.columns().length;

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.selectColumn(index > 0 ? index - 1 : columnCount - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.selectColumn(index < columnCount - 1 ? index + 1 : 0);
        break;
      case 'Home':
        event.preventDefault();
        this.selectColumn(0);
        break;
      case 'End':
        event.preventDefault();
        this.selectColumn(columnCount - 1);
        break;
    }
  }

  onColumnDrop(event: CdkDragDrop<ColumnDefinition[]>): void {
    const previousIndex = event.previousIndex;
    const currentIndex = event.currentIndex;

    if (previousIndex !== currentIndex) {
      const feedIds = this.feeds().map(feed => feed.id);
      moveItemInArray(feedIds, previousIndex, currentIndex);

      // Update feed order using FeedService
      this.feedService.reorderFeeds(feedIds);

      // Update the visible column index if in mobile view
      if (this.isMobileView()) {
        if (this.visibleColumnIndex() === previousIndex) {
          // If the currently visible column was moved, update the index
          this.visibleColumnIndex.set(currentIndex);
        } else if (
          previousIndex < this.visibleColumnIndex() &&
          currentIndex >= this.visibleColumnIndex()
        ) {
          // If a column was moved from before the visible one to after it, shift visibility back
          this.visibleColumnIndex.update(idx => idx - 1);
        } else if (
          previousIndex > this.visibleColumnIndex() &&
          currentIndex <= this.visibleColumnIndex()
        ) {
          // If a column was moved from after the visible one to before it, shift visibility forward
          this.visibleColumnIndex.update(idx => idx + 1);
        }
      }

      this.notificationService.notify('Feed order changed');
      this.logger.debug('Feed order changed', feedIds);

      // Let's scroll to ensure the dropped column is visible
      if (!this.isMobileView()) {
        setTimeout(() => {
          this.scrollToColumn(currentIndex);
        }, 50);
      }
    }
  }

  scrollLeft(): void {
    if (!this.columnsWrapper) return;

    const wrapper = this.columnsWrapper.nativeElement;
    const newPosition = Math.max(0, this.scrollPosition() - 750); // Scroll approximately one column

    wrapper.scrollTo({
      left: newPosition,
      behavior: 'smooth'
    });
  }

  scrollRight(): void {
    if (!this.columnsWrapper) return;

    const wrapper = this.columnsWrapper.nativeElement;
    const newPosition = Math.min(
      this.maxScroll(),
      this.scrollPosition() + 750  // Scroll approximately one column
    );

    wrapper.scrollTo({
      left: newPosition,
      behavior: 'smooth'
    });
  }

  scrollToColumn(index: number): void {
    if (this.isMobileView() || !this.columnsWrapper) return;

    const wrapper = this.columnsWrapper.nativeElement;
    const columnElements = wrapper.querySelectorAll<HTMLElement>('.column-unit');

    if (index >= 0 && index < columnElements.length) {
      const columnElement = columnElements[index];
      const columnLeft = columnElement.offsetLeft;
      const columnWidth = columnElement.offsetWidth;
      const wrapperWidth = wrapper.offsetWidth;
      const currentScroll = wrapper.scrollLeft;

      // Check if column is not fully visible
      if (columnLeft < currentScroll) {
        // Column is to the left of the viewport
        wrapper.scrollTo({
          left: columnLeft - 12, // Account for padding
          behavior: 'smooth'
        });
      } else if (columnLeft + columnWidth > currentScroll + wrapperWidth) {
        // Column is to the right of the viewport
        wrapper.scrollTo({
          left: columnLeft + columnWidth - wrapperWidth + 12, // Account for padding
          behavior: 'smooth'
        });
      }
    }
  }
  addNewColumn(): void {
    const activeFeed = this.activeFeed();
    if (!activeFeed) {
      this.notificationService.notify('Please select a feed first');
      return;
    }

    const dialogRef = this.dialog.open(NewColumnDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      maxHeight: '90vh',
      data: {
        icons: ['chat', 'reply_all', 'bookmark', 'image', 'people', 'tag', 'filter_list', 'article', 'video_library', 'music_note', 'photo', 'explore', 'trending_up', 'group', 'public']
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && activeFeed) {
        // Add the new column to the current feed
        const updatedFeed = {
          ...activeFeed,
          columns: [...activeFeed.columns, result],
          updatedAt: Date.now()
        };

        this.feedsCollectionService.updateFeed(activeFeed.id, updatedFeed);

        const newColumnIndex = updatedFeed.columns.length - 1;

        if (this.isMobileView()) {
          this.visibleColumnIndex.set(newColumnIndex);
        } else {
          setTimeout(() => {
            this.scrollToColumn(newColumnIndex);
          }, 100);
        }

        this.columnContentLoaded.update(loaded => ({
          ...loaded,
          [result.id]: false
        }));

        this.notificationService.notify(`Column "${result.label}" added to "${activeFeed.label}"`);
      }
    });
  }
  editColumn(index: number): void {
    const activeFeed = this.activeFeed();
    const columns = this.columns();
    
    if (!activeFeed || index < 0 || index >= columns.length) return;

    const column = columns[index];

    const dialogRef = this.dialog.open(NewColumnDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      maxHeight: '90vh',
      data: {
        column: column,
        icons: ['chat', 'reply_all', 'bookmark', 'image', 'people', 'tag', 'filter_list', 'article', 'video_library', 'music_note', 'photo', 'explore', 'trending_up', 'group', 'public']
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && activeFeed) {
        // Update the specific column in the feed
        const updatedColumns = [...activeFeed.columns];
        updatedColumns[index] = result;
        
        const updatedFeed = {
          ...activeFeed,
          columns: updatedColumns,
          updatedAt: Date.now()
        };

        this.feedsCollectionService.updateFeed(activeFeed.id, updatedFeed);
        this.notificationService.notify(`Column "${result.label}" updated`);
      }
    });
  }
  removeColumn(index: number): void {
    const activeFeed = this.activeFeed();
    const columns = this.columns();
    
    if (!activeFeed || index < 0 || index >= columns.length) return;

    const column = columns[index];
    
    // Prevent removing the last column - feed must have at least one column
    if (columns.length <= 1) {
      this.notificationService.notify('Cannot remove the last column from a feed');
      return;
    }

    // Update the feed by removing the column at the specified index
    const updatedColumns = activeFeed.columns.filter((_, i) => i !== index);
    
    const updatedFeed = {
      ...activeFeed,
      columns: updatedColumns,
      updatedAt: Date.now()
    };

    this.feedsCollectionService.updateFeed(activeFeed.id, updatedFeed);

    // Adjust visible column index if needed for mobile view
    if (this.isMobileView()) {
      if (this.visibleColumnIndex() >= updatedColumns.length) {
        this.visibleColumnIndex.set(Math.max(0, updatedColumns.length - 1));
      } else if (this.visibleColumnIndex() > index) {
        this.visibleColumnIndex.update(idx => idx - 1);
      }
    }

    this.notificationService.notify(`Column "${column.label}" removed`);
  }
  ngOnDestroy() {
    // Cleanup subscriptions if needed
  }
  // Helper methods for content rendering
  getImageUrls(event: any): string[] {
    const imetas = event.tags?.filter((tag: any[]) => tag[0] === 'imeta') || [];
    return imetas
      .map((imeta: string[]) => {
        const urlIndex = imeta.findIndex(item => item.startsWith('url '));
        return urlIndex > 0 ? imeta[urlIndex].substring(4) : null;
      })
      .filter(Boolean);
  }

  getBlurhash(event: any, imageIndex: number = 0): string | null {
    const imetas = event.tags?.filter((tag: any[]) => tag[0] === 'imeta') || [];
    if (imetas.length <= imageIndex) return null;
    
    const imeta = imetas[imageIndex];
    const blurhashIndex = imeta.findIndex((item: string) => item.startsWith('blurhash '));
    return blurhashIndex > 0 ? imeta[blurhashIndex].substring(9) : null;
  }

  generateBlurhashDataUrl(blurhash: string, width: number = 32, height: number = 32): string {
    try {
      const pixels = decode(blurhash, width, height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
      
      return canvas.toDataURL();
    } catch (error) {
      console.warn('Failed to decode blurhash:', error);
      return '';
    }
  }

  getVideoData(event: any): { url: string; thumbnail?: string; duration?: string; blurhash?: string } | null {
    const imetas = event.tags?.filter((tag: any[]) => tag[0] === 'imeta') || [];
    if (imetas.length === 0) return null;

    const firstImeta = imetas[0];
    const urlIndex = firstImeta.findIndex((item: string) => item.startsWith('url '));
    const imageIndex = firstImeta.findIndex((item: string) => item.startsWith('image '));
    const blurhashIndex = firstImeta.findIndex((item: string) => item.startsWith('blurhash '));
    
    const durationTag = event.tags?.find((tag: any[]) => tag[0] === 'duration');
    
    return {
      url: urlIndex > 0 ? firstImeta[urlIndex].substring(4) : '',
      thumbnail: imageIndex > 0 ? firstImeta[imageIndex].substring(6) : undefined,
      duration: durationTag ? durationTag[1] : undefined,
      blurhash: blurhashIndex > 0 ? firstImeta[blurhashIndex].substring(9) : undefined
    };
  }

  getEventTitle(event: any): string {
    const titleTag = event.tags?.find((tag: any[]) => tag[0] === 'title');
    return titleTag ? titleTag[1] : '';
  }

  getEventAlt(event: any): string {
    const altTag = event.tags?.find((tag: any[]) => tag[0] === 'alt');
    return altTag ? altTag[1] : '';
  }

  hasContentWarning(event: any): boolean {
    return event.tags?.some((tag: any[]) => tag[0] === 'content-warning') || false;
  }

  getContentWarning(event: any): string {
    const warningTag = event.tags?.find((tag: any[]) => tag[0] === 'content-warning');
    return warningTag ? warningTag[1] : '';
  }

  formatDuration(seconds: string): string {
    const num = parseInt(seconds);
    const hours = Math.floor(num / 3600);
    const minutes = Math.floor((num % 3600) / 60);
    const secs = num % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
  openImageDialog(imageUrl: string, altText: string): void {
    // TODO: Implement image dialog
    console.log('Opening image dialog for:', imageUrl, altText);
  }
  onImageLoad(event: globalThis.Event): void {
    const img = event.target as HTMLImageElement;
    const container = img.parentElement;
    if (container) {
      const placeholder = container.querySelector('.blurhash-placeholder') as HTMLImageElement;
      if (placeholder) {
        placeholder.style.opacity = '0';
        setTimeout(() => {
          placeholder.style.display = 'none';
        }, 300);
      }
    }
  }

  /**
   * Select a feed
   */
  selectFeed(feedId: string): void {
    this.feedsCollectionService.setActiveFeed(feedId);
  }

  /**
   * Add a new feed
   */  addNewFeed(): void {
    const dialogRef = this.dialog.open(NewFeedDialogComponent, {
      width: '900px',
      maxWidth: '90vw',
      data: {
        icons: ['dynamic_feed', 'bookmark', 'explore', 'trending_up', 'star', 'favorite', 'rss_feed']
      }
    });    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // The dialog returns a FeedConfig, but FeedsCollectionService.addFeed expects FeedDefinition data
        const newFeed = this.feedsCollectionService.addFeed({
          label: result.label,
          icon: result.icon,
          description: result.description,
          columns: result.columns
        });

        // Set as active feed
        this.feedsCollectionService.setActiveFeed(newFeed.id);
      }
    });
  }

  /**
   * Edit the current feed
   */  editCurrentFeed(): void {
    const activeFeed = this.activeFeed();
    if (!activeFeed) return;

    const dialogRef = this.dialog.open(NewFeedDialogComponent, {
      width: '900px',
      maxWidth: '90vw',
      data: {
        icons: ['dynamic_feed', 'bookmark', 'explore', 'trending_up', 'star', 'favorite', 'rss_feed'],
        feed: activeFeed
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && activeFeed) {
        this.feedsCollectionService.updateFeed(activeFeed.id, {
          label: result.label,
          icon: result.icon,
          description: result.description
        });
      }
    });
  }
  /**
   * Delete the current feed
   */
  deleteCurrentFeed(): void {
    const activeFeed = this.activeFeed();
    if (!activeFeed) return;

    // Show confirmation dialog
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Feed',
        message: `Are you sure you want to delete the feed "${activeFeed.label}"?`,
        confirmText: 'Delete Feed',
        cancelText: 'Cancel',
        confirmColor: 'warn'
      } as ConfirmDialogData
    });    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.feedsCollectionService.removeFeed(activeFeed.id);
      }
    });
  }
}
