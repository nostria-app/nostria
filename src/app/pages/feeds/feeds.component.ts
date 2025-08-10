import {
  Component,
  ViewChild,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
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
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { NewFeedDialogComponent } from './new-feed-dialog/new-feed-dialog.component';
import { NewColumnDialogComponent } from './new-column-dialog/new-column-dialog.component';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../components/confirm-dialog/confirm-dialog.component';
import { ImageDialogComponent } from '../../components/image-dialog/image-dialog.component';
import { LocalStorageService } from '../../services/local-storage.service';
import { LoggerService } from '../../services/logger.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FeedService, FeedConfig } from '../../services/feed.service';
import {
  FeedsCollectionService,
  FeedDefinition,
  ColumnDefinition,
} from '../../services/feeds-collection.service';
import { MediaItem, NostrRecord } from '../../interfaces';
import { Event } from 'nostr-tools';
import { decode } from 'blurhash';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { UrlUpdateService } from '../../services/url-update.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { MatDividerModule } from '@angular/material/divider';
import { ContentComponent } from '../../components/content/content.component';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApplicationService } from '../../services/application.service';
import { RepostService } from '../../services/repost.service';
import { Link } from '../../components/link/link';
import { Introduction } from '../../components/introduction/introduction';
import {
  FollowsetComponent,
  Interest,
  SuggestedProfile,
} from '../../components/followset/followset.component';
import { AccountStateService } from '../../services/account-state.service';
import { Followset } from '../../services/followset';

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
  selector: 'app-feeds',
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
    RouterModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
    MatDividerModule,
    ContentComponent,
    Link,
    Introduction,
    FollowsetComponent,
  ],
  templateUrl: './feeds.component.html',
  styleUrl: './feeds.component.scss',
})
export class FeedsComponent implements OnInit, OnDestroy {
  // Services
  private nostrService = inject(NostrService);
  private notificationService = inject(NotificationService);
  private layoutService = inject(LayoutService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  feedService = inject(FeedService);
  feedsCollectionService = inject(FeedsCollectionService);
  private logger = inject(LoggerService);
  private url = inject(UrlUpdateService);
  private cdr = inject(ChangeDetectorRef);
  private mediaPlayerService = inject(MediaPlayerService);
  private repostService = inject(RepostService);
  private snackBar = inject(MatSnackBar);
  protected app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private followsetService = inject(Followset);

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

  // Check if user has an empty following list
  hasEmptyFollowingList = computed(() => {
    return this.accountState.followingList().length === 0;
  });

  // Followset data for new users
  selectedInterests = signal<string[]>([]);
  followingProfiles = signal<string[]>([]);
  detectedRegion = signal('');

  // Available interests - will be populated from starter packs
  availableInterests = signal<Interest[]>([]);

  // Suggested profiles - will be populated dynamically from starter packs
  suggestedProfiles = signal<SuggestedProfile[]>([]);

  isMobileView = computed(() => {
    const isMobile = this.screenWidth() < 1024;
    return isMobile;
  });

  feedIcon = computed(() => {
    const activeFeed = this.activeFeed();
    return activeFeed ? activeFeed.icon : '';
  });

  feedLabel = computed(() => {
    const activeFeed = this.activeFeed();
    return activeFeed ? activeFeed.label : '';
  });

  // Content Signals
  trendingEvents = signal<NostrRecord[]>([]);
  followingEvents = signal<NostrRecord[]>([]);
  mediaEvents = signal<NostrRecord[]>([]);
  availableTags = signal<string[]>([
    'nostr',
    'bitcoin',
    'programming',
    'art',
    'music',
    'photography',
    'news',
    'sports',
  ]);

  // Video expansion state management
  videoExpandedStates = signal<Record<string, boolean>>({});

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
  }); // Drag state to prevent unnecessary re-renders during column reordering
  private isDragging = signal(false);

  // Cache to store events during drag operations
  private _eventCache = new Map<string, Event[]>();

  // Computed signal for column events that respects drag state
  columnEvents = computed(() => {
    const columns = this.columns();
    const isDragging = this.isDragging();
    const eventsMap = new Map<string, Event[]>();

    // Get reactive feed data map from service
    const feedDataMap = this.feedService.feedDataReactive();

    columns.forEach(column => {
      if (isDragging) {
        // During drag operations, use cached events to prevent DOM updates
        eventsMap.set(column.id, this._eventCache.get(column.id) || []);
      } else {
        // Normal operation: get fresh events from reactive service
        const columnData = feedDataMap.get(column.id);
        const events = columnData?.events() || [];

        // Update cache for potential drag operations
        this._eventCache.set(column.id, events);
        eventsMap.set(column.id, events);
      }
    });

    return eventsMap;
  });

  // Helper method to get events for a specific column from the computed signal
  getEventsForColumn(columnId: string): Event[] {
    return this.columnEvents().get(columnId) || [];
  }

  // Remove the old getEventsForColumn method
  // getEventsForColumn(columnId: string): Event[] {
  //   console.log(`Fetching events for column: ${columnId}`);
  //   console.log('Available feeds:', this.feedService.data.keys());
  //   return this.feedService.data.get(columnId)?.events() || [];
  // }  // Replace the old columns signal with columns from active feed
  feeds = computed(() => this.feedsCollectionService.feeds());
  activeFeed = computed(() => this.feedsCollectionService.activeFeed());
  columns = computed(() => this.feedsCollectionService.getActiveColumns());

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

  // Computed signal to track which columns are paused (no active subscription)
  pausedColumns = computed(() => {
    const columns = this.columns();
    const feedDataMap = this.feedService.feedDataReactive(); // Use reactive signal instead of regular Map
    const pausedSet = new Set<string>();

    columns.forEach(column => {
      const columnData = feedDataMap.get(column.id);
      if (columnData && !columnData.subscription) {
        pausedSet.add(column.id);
      }
    });

    return pausedSet;
  });

  // Helper method to check if a specific column is paused
  isColumnPaused(columnId: string): boolean {
    return this.pausedColumns().has(columnId);
  }

  // Helper method to get pause status for debugging
  getColumnStatus(columnId: string): string {
    const feedDataMap = this.feedService.feedDataReactive();
    const columnData = feedDataMap.get(columnId);
    if (!columnData) return 'not found';
    return columnData.subscription ? 'active' : 'paused';
  }
  constructor() {
    // Initialize data loading
    // this.loadTrendingContent();

    // Handle route parameters for feed navigation
    effect(() => {
      this.route.params.subscribe(params => {
        const pathParam = params['path'];
        if (pathParam) {
          // Find feed by path
          const feeds = this.feedsCollectionService.feeds();
          const targetFeed = feeds.find(feed => feed.path === pathParam);

          if (targetFeed) {
            this.feedsCollectionService.setActiveFeed(targetFeed.id);
          } else {
            // If no feed with this path is found, redirect to default feed
            console.warn(`No feed found with path: ${pathParam}`);
            this.router.navigate(['/f'], { replaceUrl: true });
          }
        }
      });
    });

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
    // effect(() => {
    //   const interval = setInterval(() => {
    //     this.loadTrendingContent(true);
    //   }, 60000); // Refresh every minute

    //   return () => {
    //     clearInterval(interval);
    //   };
    // });
  }

  // setActiveSection(section: 'discover' | 'following' | 'media'): void {
  //   this.activeSection.set(section);

  //   // Load section data if needed
  //   switch (section) {
  //     case 'following':
  //       if (this.followingEvents().length === 0) {
  //         this.loadFollowingContent();
  //       }
  //       break;
  //     case 'media':
  //       if (this.mediaEvents().length === 0) {
  //         this.loadMediaContent();
  //       }
  //       break;
  //   }
  // }

  // async loadTrendingContent(silent = false): Promise<void> {
  //   if (!silent) {
  //     this.isLoading.set(true);
  //   }

  //   try {
  //     const events = await this.fetchTrendingEvents();
  //     this.trendingEvents.set(events);
  //     if (!silent) {
  //       this.notificationService.notify('Trending content updated');
  //     }
  //   } catch (error) {
  //     console.error('Failed to load trending content:', error);
  //     if (!silent) {
  //       this.notificationService.notify('Failed to load trending content', 'error');
  //     }
  //   } finally {
  //     if (!silent) {
  //       this.isLoading.set(false);
  //     }
  //   }
  // }

  // async loadFollowingContent(): Promise<void> {
  //   this.isLoading.set(true);

  //   try {
  //     const events = await this.fetchFollowingEvents();
  //     this.followingEvents.set(events);
  //   } catch (error) {
  //     console.error('Failed to load following content:', error);
  //     this.notificationService.notify('Failed to load following content', 'error');
  //   } finally {
  //     this.isLoading.set(false);
  //   }
  // }

  // async loadMediaContent(): Promise<void> {
  //   this.isLoading.set(true);

  //   try {
  //     const events = await this.fetchMediaEvents();
  //     this.mediaEvents.set(events);
  //   } catch (error) {
  //     console.error('Failed to load media content:', error);
  //     this.notificationService.notify('Failed to load media content', 'error');
  //   } finally {
  //     this.isLoading.set(false);
  //   }
  // }

  // async fetchTrendingEvents(): Promise<NostrRecord[]> {
  //   // Example implementation - would be replaced with actual fetch from nostrService
  //   const response = await fetch('/api/trending');
  //   if (!response.ok) {
  //     throw new Error('Failed to fetch trending events');
  //   }

  //   return await response.json() as NostrRecord[];
  // }

  // async fetchFollowingEvents(): Promise<NostrRecord[]> {
  //   // Example implementation - would be replaced with actual fetch from nostrService
  //   const response = await fetch('/api/following');
  //   if (!response.ok) {
  //     throw new Error('Failed to fetch following events');
  //   }

  //   return await response.json() as NostrRecord[];
  // }

  // async fetchMediaEvents(): Promise<NostrRecord[]> {
  //   // Example implementation - would be replaced with actual fetch from nostrService
  //   const response = await fetch('/api/media');
  //   if (!response.ok) {
  //     throw new Error('Failed to fetch media events');
  //   }

  //   return await response.json() as NostrRecord[];
  // }

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

  // refreshContent(): void {
  //   switch (this.activeSection()) {
  //     case 'discover':
  //       this.loadTrendingContent();
  //       break;
  //     case 'following':
  //       this.loadFollowingContent();
  //       break;
  //     case 'media':
  //       this.loadMediaContent();
  //       break;
  //   }
  // }

  shareContent(event: NostrRecord): void {
    // Implement share functionality
    this.notificationService.notify('Content shared');
  }

  bookmarkContent(event: NostrRecord): void {
    // Implement bookmark functionality
    this.notificationService.notify('Content bookmarked');
  }

  // Method called when user completes followset onboarding
  async onFollowsetComplete(): Promise<void> {
    try {
      const selectedInterests = this.selectedInterests();
      const followingProfiles = this.followingProfiles();

      this.logger.debug('Followset onboarding completed', {
        selectedInterests,
        followingProfiles,
      });

      // Get all pubkeys from selected starter packs
      const starterPackPubkeys =
        this.followsetService.getPubkeysFromInterests(selectedInterests);

      // Follow all selected profiles from the followset
      for (const pubkey of followingProfiles) {
        await this.accountState.follow(pubkey);
      }

      // Also follow some users from the selected starter packs (limit to avoid spam)
      const additionalFollows = starterPackPubkeys
        .filter(pubkey => !followingProfiles.includes(pubkey))
        .slice(0, 10); // Limit to 10 additional follows

      for (const pubkey of additionalFollows) {
        await this.accountState.follow(pubkey);
      }

      this.notificationService.notify(
        `Welcome! Following ${followingProfiles.length + additionalFollows.length} accounts.`
      );

      // Reset followset state
      this.selectedInterests.set([]);
      this.followingProfiles.set([]);
      this.suggestedProfiles.set([]);
    } catch (error) {
      this.logger.error('Failed to complete followset onboarding:', error);
      this.notificationService.notify(
        'Error completing setup. Please try again.'
      );
    }
  }

  // Followset interaction methods
  async toggleInterest(interestId: string): Promise<void> {
    this.selectedInterests.update(interests => {
      if (interests.includes(interestId)) {
        return interests.filter(id => id !== interestId);
      } else {
        return [...interests, interestId];
      }
    });

    // Fetch suggested profiles based on selected interests
    await this.updateSuggestedProfiles();
  }

  /**
   * Update suggested profiles based on selected interests
   */
  private async updateSuggestedProfiles(): Promise<void> {
    try {
      const selectedInterests = this.selectedInterests();
      if (selectedInterests.length === 0) {
        this.suggestedProfiles.set([]);
        return;
      }

      const starterPacks = this.followsetService.starterPacks();
      const profiles =
        await this.followsetService.convertStarterPacksToProfiles(
          starterPacks,
          selectedInterests
        );

      this.suggestedProfiles.set(profiles);
      this.logger.debug(
        `Updated suggested profiles: ${profiles.length} profiles`
      );
    } catch (error) {
      this.logger.error('Failed to update suggested profiles:', error);
    }
  }

  toggleFollow(profileId: string): void {
    this.followingProfiles.update(profiles => {
      if (profiles.includes(profileId)) {
        return profiles.filter(id => id !== profileId);
      } else {
        // Add to local state and also to account following
        this.accountState.follow(profileId);
        return [...profiles, profileId];
      }
    });
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
          [columnId]: true,
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

    console.log('🔄 Column drop event:', { previousIndex, currentIndex });

    if (previousIndex !== currentIndex) {
      const activeFeed = this.activeFeed();
      if (!activeFeed) {
        return;
      }

      // Get the current columns and reorder them
      const columns = [...activeFeed.columns];
      moveItemInArray(columns, previousIndex, currentIndex);

      console.log(
        '📋 Columns reordered:',
        columns.map(col => `${col.label} (${col.id})`)
      );

      // Update the actual feed data using the optimized method
      console.log('⚡ Using optimized updateColumnOrder method');
      this.feedsCollectionService.updateColumnOrder(activeFeed.id, columns);

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
      this.logger.debug(
        'Column order changed',
        columns.map(col => col.id)
      );

      // Let's scroll to ensure the dropped column is visible
      if (!this.isMobileView()) {
        setTimeout(() => {
          this.scrollToColumn(currentIndex);
        }, 50);
      }
    }

    // Change detection will be reattached in onDragEnded()
  }
  // Drag event handlers to manage state with CHANGE DETECTION CONTROL
  onDragStarted(): void {
    console.log('🚀 Drag started - DETACHING CHANGE DETECTION');
    this.isDragging.set(true);

    // **RADICAL APPROACH**: Detach change detection completely during drag
    this.cdr.detach();

    // Pre-cache all column events to prevent DOM updates during drag
    const columns = this.columns();
    const feedDataMap = this.feedService.feedDataReactive();
    columns.forEach(column => {
      const columnData = feedDataMap.get(column.id);
      const events = columnData?.events() || [];
      this._eventCache.set(column.id, events);
    });
  }

  onDragEnded(): void {
    console.log('🏁 Drag ended - REATTACHING CHANGE DETECTION');

    // **RADICAL APPROACH**: Reattach change detection and force update
    this.cdr.reattach();
    this.cdr.detectChanges();

    // Clear drag state
    this.isDragging.set(false);
  }

  scrollLeft(): void {
    if (!this.columnsWrapper) return;

    const wrapper = this.columnsWrapper.nativeElement;
    const newPosition = Math.max(0, this.scrollPosition() - 750); // Scroll approximately one column

    wrapper.scrollTo({
      left: newPosition,
      behavior: 'smooth',
    });
  }

  scrollRight(): void {
    if (!this.columnsWrapper) return;

    const wrapper = this.columnsWrapper.nativeElement;
    const newPosition = Math.min(
      this.maxScroll(),
      this.scrollPosition() + 750 // Scroll approximately one column
    );

    wrapper.scrollTo({
      left: newPosition,
      behavior: 'smooth',
    });
  }
  scrollToColumn(index: number): void {
    if (this.isMobileView() || !this.columnsWrapper) return;

    const wrapper = this.columnsWrapper.nativeElement;
    const columnElements =
      wrapper.querySelectorAll<HTMLElement>('.column-unit');

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
          behavior: 'smooth',
        });
      } else if (columnLeft + columnWidth > currentScroll + wrapperWidth) {
        // Column is to the right of the viewport
        wrapper.scrollTo({
          left: columnLeft + columnWidth - wrapperWidth + 12, // Account for padding
          behavior: 'smooth',
        });
      }
    }
  }
  addNewColumn(): void {
    const activeFeed = this.activeFeed();
    if (!activeFeed) {
      this.notificationService.notify('Please add a feed first');
      return;
    }

    const dialogRef = this.dialog.open(NewColumnDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      data: {
        icons: [
          'chat',
          'reply_all',
          'bookmark',
          'image',
          'people',
          'tag',
          'filter_list',
          'article',
          'video_library',
          'music_note',
          'photo',
          'explore',
          'trending_up',
          'group',
          'public',
        ],
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && activeFeed) {
        // Add the new column to the current feed
        const updatedFeed = {
          ...activeFeed,
          columns: [...activeFeed.columns, result],
          updatedAt: Date.now(),
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
          [result.id]: false,
        }));

        this.notificationService.notify(
          `Column "${result.label}" added to "${activeFeed.label}"`
        );
      }
    });
  }
  editColumn(index: number): void {
    const activeFeed = this.activeFeed();
    const columns = this.columns();

    if (!activeFeed || index < 0 || index >= columns.length) return;

    const column = columns[index];

    const dialogRef = this.dialog.open(NewColumnDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      data: {
        column: column,
        icons: [
          'chat',
          'reply_all',
          'bookmark',
          'image',
          'people',
          'tag',
          'filter_list',
          'article',
          'video_library',
          'music_note',
          'photo',
          'explore',
          'trending_up',
          'group',
          'public',
        ],
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && activeFeed) {
        // Update the specific column in the feed
        const updatedColumns = [...activeFeed.columns];
        updatedColumns[index] = result;

        const updatedFeed = {
          ...activeFeed,
          columns: updatedColumns,
          updatedAt: Date.now(),
        };

        this.feedsCollectionService.updateFeed(activeFeed.id, updatedFeed);
        this.notificationService.notify(`Column "${result.label}" updated`);
      }
    });
  }
  removeColumn(index: number): void {
    const activeFeed = this.activeFeed();
    const columns = this.columns();

    if (!activeFeed) return;

    const column = columns[index];

    // Update the feed by removing the column at the specified index
    const updatedColumns = activeFeed.columns.filter((_, i) => i !== index);

    const updatedFeed = {
      ...activeFeed,
      columns: updatedColumns,
      updatedAt: Date.now(),
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

  refreshColumn(column: ColumnDefinition): void {
    console.log('🔄 Refreshing column:', column.label, `(${column.id})`);
    this.feedsCollectionService.refreshColumn(column.id);
    this.notificationService.notify(`Column "${column.label}" refreshed`);
  }
  pauseColumn(column: ColumnDefinition): void {
    console.log('⏸️ Pausing column:', column.label, `(${column.id})`);
    console.log(
      '📊 Column status before pause:',
      this.getColumnStatus(column.id)
    );
    this.feedsCollectionService.pauseColumn(column.id);
    this.notificationService.notify(`Column "${column.label}" paused`);
    console.log(
      '📊 Column status after pause:',
      this.getColumnStatus(column.id)
    );
  }
  continueColumn(column: ColumnDefinition): void {
    console.log('▶️ Continue column:', column.label, `(${column.id})`);
    console.log(
      '📊 Column status before continue:',
      this.getColumnStatus(column.id)
    );
    this.feedsCollectionService.continueColumn(column.id);
    this.notificationService.notify(`Column "${column.label}" continued`);
    console.log(
      '📊 Column status after continue:',
      this.getColumnStatus(column.id)
    );
  }

  // Video expansion state management methods
  expandVideo(videoKey: string): void {
    this.videoExpandedStates.update(states => ({
      ...states,
      [videoKey]: true,
    }));
  }

  collapseVideo(videoKey: string): void {
    this.videoExpandedStates.update(states => ({
      ...states,
      [videoKey]: false,
    }));
  }

  ngOnInit() {
    this.logger.debug('FeedsComponent initializing...');
    // Re-establish subscriptions when component loads
    this.feedService.subscribe();

    // Initialize followset data for new users
    this.initializeFollowsetData();
  }

  /**
   * Initialize followset data by fetching starter packs from Nostr
   */
  private async initializeFollowsetData(): Promise<void> {
    try {
      // Only fetch if user has empty following list
      if (this.hasEmptyFollowingList()) {
        this.logger.debug(
          'User has empty following list, fetching starter packs...'
        );

        // Fetch starter packs from the followset service
        const starterPacks = await this.followsetService.fetchStarterPacks();

        if (starterPacks.length > 0) {
          // Convert starter packs to interests
          const interests =
            this.followsetService.convertStarterPacksToInterests(starterPacks);
          this.availableInterests.set(interests);

          this.logger.debug(
            `Loaded ${interests.length} interests from starter packs`
          );
        } else {
          this.logger.warn('No starter packs found, using default interests');
        }
      }
    } catch (error) {
      this.logger.error('Failed to initialize followset data:', error);
      // Keep default interests if starter pack fetching fails
    }
  }

  ngOnDestroy() {
    this.logger.debug('Cleaning up resources...');
    this.feedService.unsubscribe();
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

  getBlurhash(event: any, imageIndex = 0): string | null {
    const imetas = event.tags?.filter((tag: any[]) => tag[0] === 'imeta') || [];
    if (imetas.length <= imageIndex) return null;

    const imeta = imetas[imageIndex];
    const blurhashIndex = imeta.findIndex((item: string) =>
      item.startsWith('blurhash ')
    );
    return blurhashIndex > 0 ? imeta[blurhashIndex].substring(9) : null;
  }

  generateBlurhashDataUrl(blurhash: string, width = 32, height = 32): string {
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
  getVideoData(event: any): {
    url: string;
    thumbnail?: string;
    duration?: string;
    blurhash?: string;
  } | null {
    const imetas = event.tags?.filter((tag: any[]) => tag[0] === 'imeta') || [];
    if (imetas.length === 0) return null;

    const firstImeta = imetas[0];
    const urlIndex = firstImeta.findIndex((item: string) =>
      item.startsWith('url ')
    );
    const imageIndex = firstImeta.findIndex((item: string) =>
      item.startsWith('image ')
    );
    const blurhashIndex = firstImeta.findIndex((item: string) =>
      item.startsWith('blurhash ')
    );

    const durationTag = event.tags?.find((tag: any[]) => tag[0] === 'duration');

    const videoUrl = urlIndex > 0 ? firstImeta[urlIndex].substring(4) : '';
    const existingThumbnail =
      imageIndex > 0 ? firstImeta[imageIndex].substring(6) : undefined;
    const existingBlurhash =
      blurhashIndex > 0 ? firstImeta[blurhashIndex].substring(9) : undefined;

    // Generate thumbnail using web service if no existing thumbnail or blurhash
    let generatedThumbnail: string | undefined = existingThumbnail;
    if (!existingThumbnail && !existingBlurhash && videoUrl) {
      generatedThumbnail = `https://video-thumb.apps2.slidestr.net/${videoUrl}`;
    }

    return {
      url: videoUrl,
      thumbnail: generatedThumbnail,
      duration: durationTag ? durationTag[1] : undefined,
      blurhash: existingBlurhash,
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

  /**
   * Remove hashtags from content since they're already displayed as chips
   */
  removeHashtagsFromContent(content: string): string {
    if (!content) return '';

    // Remove hashtags using regex - matches #word patterns
    return content
      .replace(/#[a-zA-Z0-9_]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  hasContentWarning(event: any): boolean {
    return (
      event.tags?.some((tag: any[]) => tag[0] === 'content-warning') || false
    );
  }

  getContentWarning(event: any): string {
    const warningTag = event.tags?.find(
      (tag: any[]) => tag[0] === 'content-warning'
    );
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
    this.dialog.open(ImageDialogComponent, {
      data: { imageUrl },
      maxWidth: '95vw',
      maxHeight: '95vh',
      width: '100%',
      height: '100%',
      panelClass: 'image-dialog',
    });
  }
  onImageLoad(event: globalThis.Event): void {
    const img = event.target as HTMLImageElement;
    const container = img.parentElement;
    if (container) {
      const placeholder = container.querySelector(
        '.blurhash-placeholder'
      ) as HTMLImageElement;
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
    const feeds = this.feedsCollectionService.feeds();
    const selectedFeed = feeds.find(feed => feed.id === feedId);

    // Set the active feed
    this.feedsCollectionService.setActiveFeed(feedId);
    // Navigate to the appropriate URL
    if (selectedFeed?.path) {
      this.router.navigate(['/f', selectedFeed.path]);
    } else {
      // For feeds without a path, navigate to the base feeds route
      this.router.navigate(['/f']);
    }
  }

  /**
   * Add a new feed
   */ addNewFeed(): void {
    const dialogRef = this.dialog.open(NewFeedDialogComponent, {
      width: '900px',
      maxWidth: '90vw',
      data: {
        icons: [
          'dynamic_feed',
          'bookmark',
          'explore',
          'trending_up',
          'star',
          'favorite',
          'rss_feed',
        ],
      },
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // The dialog returns a FeedConfig, but FeedsCollectionService.addFeed expects FeedDefinition data
        const newFeed = this.feedsCollectionService.addFeed({
          label: result.label,
          icon: result.icon,
          description: result.description,
          columns: result.columns,
          path: result.path,
        });

        if (newFeed.path) {
          this.url.updatePathSilently(['/f', newFeed.path]);
        }

        // Set as active feed
        this.feedsCollectionService.setActiveFeed(newFeed.id);
      }
    });
  }

  /**
   * Edit the current feed
   */ editCurrentFeed(): void {
    const activeFeed = this.activeFeed();
    if (!activeFeed) return;

    const dialogRef = this.dialog.open(NewFeedDialogComponent, {
      width: '900px',
      maxWidth: '90vw',
      data: {
        icons: [
          'dynamic_feed',
          'bookmark',
          'explore',
          'trending_up',
          'star',
          'favorite',
          'rss_feed',
        ],
        feed: activeFeed,
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && activeFeed) {
        this.feedsCollectionService.updateFeed(activeFeed.id, {
          label: result.label,
          icon: result.icon,
          description: result.description,
          path: result.path,
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
        confirmColor: 'warn',
      } as ConfirmDialogData,
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.feedsCollectionService.removeFeed(activeFeed.id);
      }
    });
  }

  /**
   * Get M3U playlist data from event
   */
  getPlaylistData(event: any): {
    title?: string;
    alt?: string;
    tracks: { url: string; title?: string; artist?: string }[];
    url?: string;
    totalDuration?: string;
  } | null {
    // Get M3U content from event content or URL tag
    const urlTag = event.tags?.find((tag: any[]) => tag[0] === 'u');
    const playlistUrl = urlTag ? urlTag[1] : null;
    const m3uContent = event.content || '';

    if (!m3uContent && !playlistUrl) return null;

    const title = this.getEventTitle(event) || 'M3U Playlist';
    const alt = this.getEventAlt(event);

    let tracks: { url: string; title?: string; artist?: string }[] = [];
    let totalDuration = 0;

    if (m3uContent) {
      tracks = this.parseM3UContent(m3uContent);

      // Calculate total duration if available
      tracks.forEach(track => {
        if (track.url) {
          // Try to extract duration from M3U metadata if available
          const durationMatch = m3uContent.match(/#EXTINF:(\d+)/);
          if (durationMatch) {
            totalDuration += parseInt(durationMatch[1]);
          }
        }
      });
    }

    return {
      title,
      alt,
      tracks,
      url: playlistUrl,
      totalDuration:
        totalDuration > 0
          ? this.formatDuration(totalDuration.toString())
          : undefined,
    };
  }

  /**
   * Parse M3U content and extract tracks
   */
  private parseM3UContent(
    content: string
  ): { url: string; title?: string; artist?: string }[] {
    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line);
    const tracks: { url: string; title?: string; artist?: string }[] = [];

    let currentTrack: { url?: string; title?: string; artist?: string } = {};

    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        // Parse track info: #EXTINF:duration,artist - title
        const match = line.match(/#EXTINF:[^,]*,(.+)/);
        if (match) {
          const trackInfo = match[1];
          if (trackInfo.includes(' - ')) {
            const [artist, title] = trackInfo.split(' - ', 2);
            currentTrack.artist = artist.trim();
            currentTrack.title = title.trim();
          } else {
            currentTrack.title = trackInfo.trim();
          }
        }
      } else if (
        line.startsWith('http') ||
        line.startsWith('https') ||
        line.endsWith('.mp3') ||
        line.endsWith('.m4a') ||
        line.endsWith('.wav') ||
        line.endsWith('.flac')
      ) {
        // This is a track URL
        currentTrack.url = line;

        if (currentTrack.url) {
          tracks.push({
            url: currentTrack.url,
            title:
              currentTrack.title ||
              this.extractFilenameFromUrl(currentTrack.url),
            artist: currentTrack.artist,
          });
        }

        // Reset for next track
        currentTrack = {};
      } else if (!line.startsWith('#')) {
        // Non-comment line that might be a relative URL or filename
        currentTrack.url = line;

        if (currentTrack.url) {
          tracks.push({
            url: currentTrack.url,
            title:
              currentTrack.title ||
              this.extractFilenameFromUrl(currentTrack.url),
            artist: currentTrack.artist,
          });
        }

        currentTrack = {};
      }
    }

    return tracks;
  }

  /**
   * Extract filename from URL for track title
   */
  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || url;
      return filename.replace(/\.[^/.]+$/, ''); // Remove file extension
    } catch {
      // If URL parsing fails, just use the last part after '/'
      const parts = url.split('/');
      const filename = parts[parts.length - 1] || url;
      return filename.replace(/\.[^/.]+$/, '');
    }
  }

  /**
   * Play entire M3U playlist
   */
  playPlaylist(playlistData: {
    title?: string;
    tracks: { url: string; title?: string; artist?: string }[];
  }): void {
    console.log('Playing M3U playlist:', playlistData);

    if (!playlistData.tracks || playlistData.tracks.length === 0) return;

    // Clear current media queue and add all tracks
    this.mediaPlayerService.media.set([]);
    playlistData.tracks.forEach((track, index) => {
      let type: 'Music' | 'Podcast' | 'YouTube' | 'Video' = 'Video';

      // Extra if the track.url is YouTube, video or music.
      if (track.url.includes('youtube.com') || track.url.includes('youtu.be')) {
        type = 'YouTube';
      }
      const mediaItem: MediaItem = {
        title: track.title || `Track ${index + 1}`,
        artist: track.artist || 'Unknown Artist',
        source: track.url,
        artwork: '', // Could be enhanced to extract album art
        type,
      };

      this.mediaPlayerService.enque(mediaItem);
    });

    // Start playing the first track
    this.mediaPlayerService.start();
  }

  /**
   * Add playlist to queue
   */
  addPlaylistToQueue(playlistData: {
    title?: string;
    tracks: { url: string; title?: string; artist?: string }[];
  }): void {
    if (!playlistData.tracks || playlistData.tracks.length === 0) return;
    playlistData.tracks.forEach((track, index) => {
      const mediaItem: MediaItem = {
        title: track.title || `Track ${index + 1}`,
        artist: track.artist || 'Unknown Artist',
        source: track.url,
        artwork: '',
        type: 'Video',
      };
      this.mediaPlayerService.enque(mediaItem);
    });
  }

  async repostNote(event: Event): Promise<void> {
    const published = await this.repostService.repostNote(event);
    if (published) {
      this.snackBar.open('Note reposted successfully!', 'Dismiss', {
        duration: 3000,
      });
    }
  }
}
