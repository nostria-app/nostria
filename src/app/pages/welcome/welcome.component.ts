import { Component, inject, signal, effect, computed, ViewChild, ElementRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterModule } from '@angular/router';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { RelayService } from '../../services/relay.service';
import { LayoutService } from '../../services/layout.service';
import { StorageService } from '../../services/storage.service';
import { ApplicationStateService } from '../../services/application-state.service';
import { LoadingOverlayComponent } from '../../components/loading-overlay/loading-overlay.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { AgoPipe } from '../../pipes/ago.pipe';

interface ContentItem {
  id: string;
  type: 'post' | 'article' | 'podcast' | 'photo' | 'video';
  content: string;
  title?: string;
  author: {
    pubkey: string;
    name?: string;
    picture?: string;
  };
  timestamp: number;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  likes: number;
  replies: number;
  repost: number;
  tags: string[];
}

interface Feed {
  id: string;
  name: string;
  icon: string;
  type: 'following' | 'global' | 'trending' | 'customize';
  items: ContentItem[];
  isLoading: boolean;
  error?: string;
}

interface Feature {
  title: string;
  description: string;
  icon: string;
  imageSrc?: string;
}

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatTabsModule,
    MatChipsModule,
    MatMenuModule,
    MatSlideToggleModule,
    RouterModule,
    MatDividerModule,
    MatTooltipModule,
    LoadingOverlayComponent,
    UserProfileComponent,
    AgoPipe
  ],
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss'
})
export class WelcomeComponent implements OnInit {
  private nostr = inject(NostrService);
  private logger = inject(LoggerService);
  private relayService = inject(RelayService);
  private layoutService = inject(LayoutService);
  private storage = inject(StorageService);
  private appState = inject(ApplicationStateService);
  
  // View state signals
  activeTab = signal<string>('discover');
  multiColumnEnabled = signal<boolean>(true);
  columnsCount = signal<number>(2);
  isWideScreen = signal<boolean>(false);
  isLoading = signal<boolean>(true);
  
  // Content signals
  feeds = signal<Feed[]>([]);
  selectedTags = signal<string[]>([]);
  popularTags = signal<string[]>([
    'nostr', 'bitcoin', 'technology', 'art', 'music', 
    'photography', 'news', 'science', 'gaming', 'sports'
  ]);
  
  // Features for the welcome section
  features = signal<Feature[]>([
    {
      title: 'Decentralized Communication',
      description: 'Connect directly with others without intermediaries using the Nostr protocol',
      icon: 'share'
    },
    {
      title: 'Content Discovery',
      description: 'Find interesting posts, articles, podcasts and media from the Nostr ecosystem',
      icon: 'explore'
    },
    {
      title: 'Multiple Columns',
      description: 'Customize your view with multiple feeds side by side on larger screens',
      icon: 'view_column'
    },
    {
      title: 'Media Integration',
      description: 'Seamlessly view images, videos, and listen to podcasts directly in your feed',
      icon: 'perm_media'
    },
    {
      title: 'Private Messaging',
      description: 'Send encrypted messages to other Nostr users with end-to-end encryption',
      icon: 'lock'
    },
    {
      title: 'Self Sovereignty',
      description: 'You own your data and control your online presence with your private keys',
      icon: 'key'
    }
  ]);
  
  // Computed feed items filtered by selected tags
  filteredFeeds = computed(() => {
    const tags = this.selectedTags();
    const feedsList = this.feeds();
    
    if (tags.length === 0) return feedsList;
    
    return feedsList.map(feed => {
      return {
        ...feed,
        items: feed.items.filter(item => {
          return item.tags.some(tag => tags.includes(tag));
        })
      };
    });
  });

  // Screen width computation for responsive layout
  @ViewChild('feedContainer') feedContainer!: ElementRef;
  
  constructor() {
    // Check if we're on a wide screen to adjust layout
    effect(() => {
      this.isWideScreen.set(this.layoutService.isWideScreen());
      this.adjustColumnsCount();
    });
  }
  
  ngOnInit(): void {
    // Initialize the application
    this.initializeFeeds();
    this.loadContentData();
    
    // Set up resize observer for responsive columns
    setTimeout(() => this.setupResizeObserver(), 100);
  }
  
  setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    
    const container = this.feedContainer?.nativeElement;
    if (!container) return;
    
    const resizeObserver = new ResizeObserver(() => {
      this.adjustColumnsCount();
    });
    
    resizeObserver.observe(container);
  }
  
  adjustColumnsCount(): void {
    // Only adjust if multi-column mode is enabled
    if (!this.multiColumnEnabled()) return;
    
    // Get container width or use window width as fallback
    const container = this.feedContainer?.nativeElement;
    const width = container ? container.offsetWidth : window.innerWidth;
    
    // Adjust columns based on width
    if (width < 768) {
      this.columnsCount.set(1);
    } else if (width < 1200) {
      this.columnsCount.set(2);
    } else if (width < 1600) {
      this.columnsCount.set(3);
    } else {
      this.columnsCount.set(4);
    }
  }
  
  initializeFeeds(): void {
    this.feeds.set([
      {
        id: 'following',
        name: 'Following',
        icon: 'people',
        type: 'following',
        items: [],
        isLoading: true
      },
      {
        id: 'global',
        name: 'Discover',
        icon: 'explore',
        type: 'global',
        items: [],
        isLoading: true
      },
      {
        id: 'trending',
        name: 'Trending',
        icon: 'trending_up',
        type: 'trending',
        items: [],
        isLoading: true
      },
      {
        id: 'articles',
        name: 'Articles',
        icon: 'article',
        type: 'customize',
        items: [],
        isLoading: true
      },
      {
        id: 'podcasts',
        name: 'Podcasts',
        icon: 'podcasts',
        type: 'customize',
        items: [],
        isLoading: true
      },
      {
        id: 'media',
        name: 'Media',
        icon: 'perm_media',
        type: 'customize',
        items: [],
        isLoading: true
      }
    ]);
  }
  
  async loadContentData(): Promise<void> {
    this.isLoading.set(true);
    
    try {
      // Simulate API delays for different feeds
      const delays = [1000, 1500, 2000, 2500, 1800, 2200];
      
      // Update feeds with mock data for now
      const feedsData = this.feeds().map(async (feed, index) => {
        await new Promise(resolve => setTimeout(resolve, delays[index % delays.length]));
        return {
          ...feed,
          items: this.generateMockItems(feed.type, feed.id, 10 + Math.floor(Math.random() * 15)),
          isLoading: false
        };
      });
      
      const updatedFeeds = await Promise.all(feedsData);
      this.feeds.set(updatedFeeds);
    } catch (error) {
      this.logger.error('Error loading feed data', error);
    } finally {
      this.isLoading.set(false);
    }
  }
  
  generateMockItems(feedType: string, feedId: string, count: number): ContentItem[] {
    const types: ('post' | 'article' | 'podcast' | 'photo' | 'video')[] = ['post', 'article', 'podcast', 'photo', 'video'];
    let preferredType: 'post' | 'article' | 'podcast' | 'photo' | 'video' = 'post';
    
    // Favor specific content types based on feed type
    switch (feedType) {
      case 'customize':
        if (feedId === 'articles') preferredType = 'article';
        else if (feedId === 'podcasts') preferredType = 'podcast';
        else if (feedId === 'media') preferredType = Math.random() > 0.5 ? 'photo' : 'video';
        break;
    }
    
    return Array.from({ length: count }).map((_, i) => {
      // Determine content type with bias toward the preferred type
      const typeRandom = Math.random();
      const type = typeRandom < 0.7 ? preferredType : types[Math.floor(Math.random() * types.length)];
      
      // Generate random tags with higher probability of including popular ones
      const tagsCount = 1 + Math.floor(Math.random() * 4);
      const tags: string[] = [];
      const popularTagsArr = this.popularTags()f;
      
      for (let j = 0; j < tagsCount; j++) {
        if (Math.random() < 0.7 && popularTagsArr.length > 0) {
          const randomIndex = Math.floor(Math.random() * popularTagsArr.length);
          if (!tags.includes(popularTagsArr[randomIndex])) {
            tags.push(popularTagsArr[randomIndex]);
          }
        } else {
          const randomTag = `tag${Math.floor(Math.random() * 20)}`;
          if (!tags.includes(randomTag)) {
            tags.push(randomTag);
          }
        }
      }
      
      return {
        id: `item-${feedType}-${i}`,
        type,
        content: `This is a mock ${type} content item #${i + 1} for the ${feedType} feed. This would contain the actual content of the post, article, or description of media.`,
        title: type !== 'post' ? `Sample ${type.charAt(0).toUpperCase() + type.slice(1)} Title #${i + 1}` : undefined,
        author: {
          pubkey: `pubkey-${i % 5}`,
          name: `User ${i % 5}`,
          picture: `https://picsum.photos/seed/author${i % 5}/40/40`
        },
        timestamp: Date.now() - Math.random() * 86400000 * 10, // Random time in last 10 days
        imageUrl: (type === 'photo' || type === 'article' || Math.random() > 0.5) ? 
          `https://picsum.photos/seed/${feedType}${i}/400/225` : undefined,
        videoUrl: type === 'video' ? `https://example.com/videos/sample${i}.mp4` : undefined,
        audioUrl: type === 'podcast' ? `https://example.com/podcasts/episode${i}.mp3` : undefined,
        likes: Math.floor(Math.random() * 100),
        replies: Math.floor(Math.random() * 30),
        repost: Math.floor(Math.random() * 20),
        tags
      };
    });
  }
  
  setActiveTab(tab: string): void {
    this.activeTab.set(tab);
  }
  
  toggleTag(tag: string): void {
    this.selectedTags.update(tags => {
      return tags.includes(tag) 
        ? tags.filter(t => t !== tag) 
        : [...tags, tag];
    });
  }
  
  toggleMultiColumn(): void {
    this.multiColumnEnabled.update(value => !value);
    // Always update columns count when toggling
    this.adjustColumnsCount();
  }
  
  refreshFeeds(): void {
    // Reset loading states
    this.feeds.update(feeds => {
      return feeds.map(feed => ({...feed, isLoading: true}));
    });
    
    // Reload data
    this.loadContentData();
  }
  
  trackByFeedId(index: number, feed: Feed): string {
    return feed.id;
  }
  
  trackByItemId(index: number, item: ContentItem): string {
    return item.id;
  }
  
  getItemCardClass(item: ContentItem): string {
    switch(item.type) {
      case 'photo': return 'photo-card';
      case 'video': return 'video-card';
      case 'article': return 'article-card';
      case 'podcast': return 'podcast-card';
      default: return 'post-card';
    }
  }
  
  // Helper method to get visible feeds based on active tab
  getVisibleFeeds(): Feed[] {
    const tab = this.activeTab();
    const filteredFeeds = this.filteredFeeds();
    
    if (tab === 'discover') {
      return filteredFeeds;
    }
    
    return filteredFeeds.filter(feed => feed.id === tab);
  }
  
  // Helper method to create feed arrays for multi-column layout
  getFeedColumns(): Feed[][] {
    const feeds = this.getVisibleFeeds();
    const columns = this.columnsCount();
    
    if (columns === 1 || !this.multiColumnEnabled()) {
      return [feeds];
    }
    
    // Distribute feeds across columns
    const result: Feed[][] = Array.from({ length: columns }, () => []);
    
    feeds.forEach((feed, index) => {
      result[index % columns].push(feed);
    });
    
    return result;
  }
  
  // Get the grid column span for feed items
  getItemColSpan(item: ContentItem): number {
    // If it's a photo or video with an image, it might look better spanning multiple columns
    if ((item.type === 'photo' || item.type === 'video') && item.imageUrl) {
      return Math.random() > 0.7 ? 2 : 1; // 30% chance of spanning 2 columns
    }
    return 1;
  }
}