import { Component, computed, effect, inject, signal } from '@angular/core';
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
import { NostrEvent } from '../../interfaces';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { NewFeedDialogComponent } from './new-feed-dialog/new-feed-dialog.component';
import { RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { LocalStorageService } from '../../services/local-storage.service';
import { LoggerService } from '../../services/logger.service';

interface NavLink {
  id: string;
  path: string;
  label: string;
  icon: string;
  filters?: Record<string, any>;
}

const DEFAULT_TABS: NavLink[] = [
  { id: 'notes', path: 'notes', label: 'Notes', icon: 'chat' },
  { id: 'replies', path: 'replies', label: 'Replies', icon: 'reply_all' },
  { id: 'reads', path: 'reads', label: 'Reads', icon: 'bookmark' },
  { id: 'media', path: 'media', label: 'Media', icon: 'image' }
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
    MatDialogModule
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
      return 'three-columns';
    } else if (width >= 1200) {
      return 'two-columns';
    } else {
      return 'one-column';
    }
  });

  // Content Signals
  trendingEvents = signal<NostrEvent[]>([]);
  followingEvents = signal<NostrEvent[]>([]);
  mediaEvents = signal<NostrEvent[]>([]);
  availableTags = signal<string[]>(['nostr', 'bitcoin', 'programming', 'art', 'music', 'photography', 'news', 'sports']);

  // Computed Signals for Filtered Content
  filteredTrending = computed(() => {
    const tags = this.selectedTags();
    if (tags.length === 0) {
      return this.trendingEvents();
    } else {
      return this.trendingEvents().filter(event =>
        event.tags.some(tag => tag[0] === 't' && tags.includes(tag[1]))
      );
    }
  });

  filteredFollowing = computed(() => {
    const tags = this.selectedTags();
    if (tags.length === 0) {
      return this.followingEvents();
    } else {
      return this.followingEvents().filter(event =>
        event.tags.some(tag => tag[0] === 't' && tags.includes(tag[1]))
      );
    }
  });

  filteredMedia = computed(() => {
    const tags = this.selectedTags();
    if (tags.length === 0) {
      return this.mediaEvents();
    } else {
      return this.mediaEvents().filter(event =>
        event.tags.some(tag => tag[0] === 't' && tags.includes(tag[1]))
      );
    }
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

  // Handle tab selection
  selectTab(index: number): void {
    this.selectedTabIndex.set(index);
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

  async fetchTrendingEvents(): Promise<NostrEvent[]> {
    // Example implementation - would be replaced with actual fetch from nostrService
    const response = await fetch('/api/trending');
    if (!response.ok) {
      throw new Error('Failed to fetch trending events');
    }

    return await response.json() as NostrEvent[];
  }

  async fetchFollowingEvents(): Promise<NostrEvent[]> {
    // Example implementation - would be replaced with actual fetch from nostrService
    const response = await fetch('/api/following');
    if (!response.ok) {
      throw new Error('Failed to fetch following events');
    }

    return await response.json() as NostrEvent[];
  }

  async fetchMediaEvents(): Promise<NostrEvent[]> {
    // Example implementation - would be replaced with actual fetch from nostrService
    const response = await fetch('/api/media');
    if (!response.ok) {
      throw new Error('Failed to fetch media events');
    }

    return await response.json() as NostrEvent[];
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

  shareContent(event: NostrEvent): void {
    // Implement share functionality
    this.notificationService.notify('Content shared');
  }

  bookmarkContent(event: NostrEvent): void {
    // Implement bookmark functionality 
    this.notificationService.notify('Content bookmarked');
  }

  // New methods for tab management
  onTabDrop(event: CdkDragDrop<string[]>): void {
    // This method would handle reordering of tabs
    // We'd need to reorder the sections in our application state
    this.notificationService.notify('Tab order changed');
    // In a real implementation, this would update the tab order in a persistent way
  }

  editSection(sectionType: 'discover' | 'following' | 'media'): void {
    // This would open a dialog or navigate to a configuration page for the specific section
    this.notificationService.notify(`Editing ${sectionType} section`);
  }

  addNewSection(): void {
    // This would open a dialog to create a new section/tab
    this.notificationService.notify('Adding new section');
  }

  // Add a new feed tab
  addNewFeed(): void {
    const dialogRef = this.dialog.open(NewFeedDialogComponent, {
      width: '400px',
      data: {
        icons: ['chat', 'reply_all', 'bookmark', 'image', 'people', 'tag', 'filter_list']
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const newFeed: NavLink = {
          id: `custom-${Date.now()}`,
          path: result.path || `feed-${Date.now()}`,
          label: result.label,
          icon: result.icon,
          filters: result.filters || {}
        };

        this.navLinks.update(links => [...links, newFeed]);
        // Switch to the new tab
        this.selectedTabIndex.set(this.navLinks().length - 1);
      }
    });
  }

  ngOnInit(): void {
    this.loadFeedsFromStorage();

    // Save feeds whenever they change
    effect(() => {
      const currentFeeds = this.navLinks();
      if (currentFeeds.length > 0) {
        this.saveFeedsToStorage(currentFeeds);
      }
    });
  }

  // Signals for state management
  navLinks = signal<NavLink[]>([]);
  selectedTabIndex = signal(0);

  // Edit an existing feed
  editFeed(index: number): void {
    if (index < 0 || index >= this.navLinks().length) return;

    const feed = this.navLinks()[index];

    const dialogRef = this.dialog.open(NewFeedDialogComponent, {
      width: '400px',
      data: {
        icons: ['chat', 'reply_all', 'bookmark', 'image', 'people', 'tag', 'filter_list'],
        feed: { ...feed }  // Pass a copy of the feed for editing
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const updatedFeeds = [...this.navLinks()];
        updatedFeeds[index] = {
          ...feed,
          label: result.label,
          icon: result.icon,
          path: result.path || feed.path,
          filters: result.filters || feed.filters || {}
        };

        this.navLinks.set(updatedFeeds);
      }
    });
  }

  // Remove a feed tab
  removeFeed(index: number): void {
    if (index < 0 || index >= this.navLinks().length) return;

    const currentLinks = [...this.navLinks()];
    currentLinks.splice(index, 1);
    this.navLinks.set(currentLinks);

    // Update selected tab index if needed
    if (this.selectedTabIndex() >= currentLinks.length) {
      this.selectedTabIndex.set(Math.max(0, currentLinks.length - 1));
    } else if (this.selectedTabIndex() > index) {
      this.selectedTabIndex.update(idx => idx - 1);
    }
  }

  // Load feeds from local storage
  private loadFeedsFromStorage(): void {
    try {
      const storedFeeds = this.localStorageService.getObject<NavLink[]>(this.STORAGE_KEY);
      if (storedFeeds && storedFeeds.length > 0) {
        this.logger.debug('Loaded custom feeds from storage', storedFeeds);
        this.navLinks.set(storedFeeds);
      } else {
        this.logger.debug('No custom feeds found in storage, using defaults');
        this.navLinks.set(DEFAULT_TABS);
      }
    } catch (error) {
      this.logger.error('Error loading feeds from storage:', error);
      this.navLinks.set(DEFAULT_TABS);
    }
  }

  // Save feeds to local storage
  private saveFeedsToStorage(feeds: NavLink[]): void {
    try {
      this.localStorageService.setObject(this.STORAGE_KEY, feeds);
      this.logger.debug('Saved custom feeds to storage', feeds);
    } catch (error) {
      this.logger.error('Error saving feeds to storage:', error);
    }
  }
}
