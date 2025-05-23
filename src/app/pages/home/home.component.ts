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
import { AgoPipe } from '../../pipes/ago.pipe';
import { NPubPipe } from '../../pipes/npub.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { NewFeedDialogComponent } from './new-feed-dialog/new-feed-dialog.component';
import { RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { LocalStorageService } from '../../services/local-storage.service';
import { LoggerService } from '../../services/logger.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NostrRecord } from '../../interfaces';

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
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatChipsModule,
    MatMenuModule,
    MatTooltipModule,
    DragDropModule,
    AgoPipe,
    NPubPipe,
    TimestampPipe,
    RouterModule,
    MatDialogModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  // Services
  private nostrService = inject(NostrService);
  private notificationService = inject(NotificationService);
  private layoutService = inject(LayoutService);
  private dialog = inject(MatDialog);
  private localStorageService = inject(LocalStorageService);
  private readonly STORAGE_KEY = 'profile-feeds';
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
  });

  // Signals for state management
  columns = signal<NavLink[]>([]);
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

  onColumnDrop(event: CdkDragDrop<NavLink[]>): void {
    // Get the indices
    const previousIndex = event.previousIndex;
    const currentIndex = event.currentIndex;

    if (previousIndex !== currentIndex) {
      // Create a copy of the columns array
      const columnsArray = [...this.columns()];

      // Use moveItemInArray to reorder the array
      moveItemInArray(columnsArray, previousIndex, currentIndex);

      // Update the columns signal with the new order
      this.columns.set(columnsArray);

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

      this.notificationService.notify('Column order changed');
      this.logger.debug('Column order changed', columnsArray);

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
    const dialogRef = this.dialog.open(NewFeedDialogComponent, {
      width: '400px',
      data: {
        icons: ['chat', 'reply_all', 'bookmark', 'image', 'people', 'tag', 'filter_list']
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const newColumn: NavLink = {
          id: `custom-${Date.now()}`,
          path: result.path || `feed-${Date.now()}`,
          label: result.label,
          icon: result.icon,
          filters: result.filters || {}
        };

        this.columns.update(columns => [...columns, newColumn]);

        const newIndex = this.columns().length - 1;

        if (this.isMobileView()) {
          this.visibleColumnIndex.set(newIndex);
        } else {
          // Scroll to the new column after it's rendered
          setTimeout(() => {
            this.scrollToColumn(newIndex);
          }, 100);
        }

        this.columnContentLoaded.update(loaded => ({
          ...loaded,
          [newColumn.id]: false
        }));
      }
    });
  }

  editColumn(index: number): void {
    if (index < 0 || index >= this.columns().length) return;

    const column = this.columns()[index];

    const dialogRef = this.dialog.open(NewFeedDialogComponent, {
      width: '400px',
      data: {
        icons: ['chat', 'reply_all', 'bookmark', 'image', 'people', 'tag', 'filter_list'],
        feed: { ...column }
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const updatedColumns = [...this.columns()];
        updatedColumns[index] = {
          ...column,
          label: result.label,
          icon: result.icon,
          path: result.path || column.path,
          filters: result.filters || column.filters || {}
        };

        this.columns.set(updatedColumns);
      }
    });
  }

  removeColumn(index: number): void {
    if (index < 0 || index >= this.columns().length) return;

    const currentColumns = [...this.columns()];
    currentColumns.splice(index, 1);
    this.columns.set(currentColumns);

    if (this.visibleColumnIndex() >= currentColumns.length) {
      this.visibleColumnIndex.set(Math.max(0, currentColumns.length - 1));
    } else if (this.visibleColumnIndex() > index) {
      this.visibleColumnIndex.update(idx => idx - 1);
    }
  }

  private loadFeedsFromStorage(): void {
    try {
      const storedColumns = this.localStorageService.getObject<NavLink[]>(this.STORAGE_KEY);
      if (storedColumns && storedColumns.length > 0) {
        this.logger.debug('Loaded custom columns from storage', storedColumns);
        this.columns.set(storedColumns);

        const loadedState: Record<string, boolean> = {};
        storedColumns.forEach(column => {
          loadedState[column.id] = false;
        });
        this.columnContentLoaded.set(loadedState);
      } else {
        this.logger.debug('No custom columns found in storage, using defaults');
        this.columns.set(DEFAULT_COLUMNS);

        const loadedState: Record<string, boolean> = {};
        DEFAULT_COLUMNS.forEach(column => {
          loadedState[column.id] = false;
        });
        this.columnContentLoaded.set(loadedState);
      }
    } catch (error) {
      this.logger.error('Error loading columns from storage:', error);
      this.columns.set(DEFAULT_COLUMNS);

      const loadedState: Record<string, boolean> = {};
      DEFAULT_COLUMNS.forEach(column => {
        loadedState[column.id] = false;
      });
      this.columnContentLoaded.set(loadedState);
    }
  }

  private saveFeedsToStorage(columns: NavLink[]): void {
    try {
      this.localStorageService.setObject(this.STORAGE_KEY, columns);
      this.logger.debug('Saved custom columns to storage', columns);
    } catch (error) {
      this.logger.error('Error saving columns to storage:', error);
    }
  }

  ngOnInit(): void {
    this.loadFeedsFromStorage();

    effect(() => {
      const currentColumns = this.columns();
      if (currentColumns.length > 0) {
        this.saveFeedsToStorage(currentColumns);
      }
    });

    this.loadColumnContentIfNeeded(this.visibleColumnIndex());

    if (!this.isMobileView()) {
      this.columns().forEach((_, index) => {
        this.loadColumnContentIfNeeded(index);
      });
    }
  }

  // Add utility to ensure column headers match column widths
  ngAfterViewInit(): void {
    // Allow the DOM to render first
    setTimeout(() => {
      this.syncColumnHeaderWidths();
    });

    // Also sync widths when the window resizes
    effect(() => {
      const width = this.screenWidth();
      this.syncColumnHeaderWidths();
    });

    // Setup scroll tracking
    if (this.columnsWrapper) {
      const wrapper = this.columnsWrapper.nativeElement;

      const updateScrollPosition = () => {
        this.scrollPosition.set(wrapper.scrollLeft);
        this.maxScroll.set(wrapper.scrollWidth - wrapper.clientWidth);
      };

      // Initial update
      setTimeout(updateScrollPosition, 100);

      // Listen for scroll events
      wrapper.addEventListener('scroll', updateScrollPosition);

      // Update on resize
      const resizeObserver = new ResizeObserver(() => {
        updateScrollPosition();
      });

      resizeObserver.observe(wrapper);

      // Cleanup
      effect(() => {
        return () => {
          wrapper.removeEventListener('scroll', updateScrollPosition);
          resizeObserver.disconnect();
        };
      });
    }

    // Fix for CDK drag issues by applying appropriate CSS
    setTimeout(() => {
      // Make sure we have the proper CDK drag styles
      const style = document.createElement('style');
      style.innerHTML = `
        .cdk-drag-preview.column-unit {
          transform: none !important;
        }
        .columns-wrapper .column-unit.cdk-drag-placeholder {
          visibility: visible !important;
        }
      `;
      document.head.appendChild(style);
    }, 0);
  }

  // Function to synchronize column header widths with column content
  private syncColumnHeaderWidths(): void {
    if (this.isMobileView()) return;

    // We'll use a small timeout to ensure DOM is fully rendered
    setTimeout(() => {
      const columnHeaders = document.querySelectorAll('.column-header:not(.add-column)');
      const columns = document.querySelectorAll('.column');

      // Reset any previously set widths
      columnHeaders.forEach(header => {
        (header as HTMLElement).style.width = '';
        (header as HTMLElement).style.minWidth = '';
      });

      columns.forEach(column => {
        (column as HTMLElement).style.width = '';
        (column as HTMLElement).style.minWidth = '';
      });

      // Let them naturally layout first
      requestAnimationFrame(() => {
        // Get the column widths
        const columnWidths = Array.from(columns).map(col =>
          (col as HTMLElement).getBoundingClientRect().width
        );

        // Apply column widths to headers
        columnHeaders.forEach((header, index) => {
          if (index < columnWidths.length) {
            (header as HTMLElement).style.width = `${columnWidths[index]}px`;
            (header as HTMLElement).style.minWidth = `${columnWidths[index]}px`;
          }
        });
      });
    }, 100);
  }
}
