import { Component, inject, OnInit, signal, computed, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, takeUntil } from 'rxjs';
import { Event, Filter } from 'nostr-tools';
import {
  DiscoveryService,
  CategoryConfig,
  CONTENT_CATEGORIES,
  MEDIA_CATEGORIES,
  DiscoveryCategory,
  PubkeyRef,
} from '../../../services/discovery.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { ArticleComponent } from '../../../components/article/article.component';
import { EventComponent } from '../../../components/event/event.component';
import { LiveEventComponent } from '../../../components/event-types/live-event.component';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';

/** Curated article item with parsed addressable ID and relay hints */
interface CuratedArticle {
  id: string;
  pubkey: string;
  slug: string;
  kind: number;
  relayHints?: string[];
  createdAt: number;
}

/** Generic curated item for creators, events, videos */
interface CuratedItem {
  id: string;
  pubkey: string;
  relay?: string;
  title?: string;
  image?: string;
  kind: number;
  createdAt: number;
}

@Component({
  selector: 'app-discover-category',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
    ArticleComponent,
    EventComponent,
    LiveEventComponent,
  ],
  templateUrl: './discover-category.component.html',
  styleUrl: './discover-category.component.scss',
})
export class DiscoverCategoryComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private discoveryService = inject(DiscoveryService);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private destroy$ = new Subject<void>();
  private streamsSubscription: { close: () => void } | null = null;

  // Route params
  readonly categoryType = signal<'content' | 'media'>('content');
  readonly categoryId = signal<DiscoveryCategory | null>(null);

  // Category config
  readonly category = computed<CategoryConfig | null>(() => {
    const id = this.categoryId();
    const type = this.categoryType();
    if (!id) return null;

    const categories = type === 'content' ? CONTENT_CATEGORIES : MEDIA_CATEGORIES;
    return categories.find((c) => c.id === id) || null;
  });

  // Loading state
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // Curated content - all categories can have any content type
  readonly creators = signal<CuratedItem[]>([]);
  readonly articles = signal<CuratedArticle[]>([]);
  readonly events = signal<CuratedItem[]>([]);
  readonly newsEvents = signal<Event[]>([]); // Full events for news category
  readonly videos = signal<CuratedItem[]>([]);
  readonly pictures = signal<CuratedItem[]>([]);
  readonly liveStreams = signal<Event[]>([]);
  readonly streamsLoading = signal(false);

  // Check if this is the live streams category
  readonly isLiveCategory = computed(() => this.categoryId() === 'live');

  // Check if this is the news category
  readonly isNewsCategory = computed(() => this.categoryId() === 'news');

  // Special section titles based on category
  readonly specialSectionTitle = computed(() => {
    const cat = this.category();
    if (!cat) return 'Featured';

    switch (cat.id) {
      case 'news':
        return 'News Sources';
      case 'finance':
        return 'Angor Hubs';
      case 'live':
        return 'Streamers';
      case 'podcasts':
        return 'Shows';
      case 'music':
        return 'Artists';
      case 'photography':
        return 'Photographers';
      case 'gaming':
        return 'Gamers';
      default:
        return 'Featured Creators';
    }
  });

  ngOnInit(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const category = params['category'] as DiscoveryCategory;

      // Determine type from URL path
      const url = this.router.url;
      const type = url.includes('/discover/media/') ? 'media' : 'content';

      this.categoryType.set(type);
      this.categoryId.set(category);

      this.loadCategoryContent();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.streamsSubscription) {
      this.streamsSubscription.close();
    }
  }

  private async loadCategoryContent(): Promise<void> {
    const cat = this.category();
    if (!cat) {
      this.error.set('Category not found');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      // Load curated creators first (needed for all categories)
      const creatorsData = await this.discoveryService.loadCuratedCreators(cat.id);
      this.creators.set(creatorsData);

      // Special handling for "news" category - fetch recent content from creators
      if (cat.id === 'news') {
        // Pass pubkey refs with relay hints for news content
        const pubkeyRefs: PubkeyRef[] = creatorsData.map(c => ({
          pubkey: c.pubkey,
          relay: c.relay,
        }));
        await this.loadNewsContent(pubkeyRefs);
      } else {
        // Load all curated content types for other categories
        const [articlesData, eventsData, videosData, picturesData] = await Promise.all([
          this.discoveryService.loadCuratedArticles(cat.id),
          this.discoveryService.loadCuratedEvents(cat.id),
          this.discoveryService.loadCuratedVideos(cat.id),
          this.discoveryService.loadCuratedPictures(cat.id),
        ]);

        // Parse and deduplicate articles
        this.articles.set(this.parseAndDeduplicateArticles(articlesData));
        this.events.set(eventsData);
        this.videos.set(videosData);
        this.pictures.set(picturesData);
      }

      // Load live streams for the 'live' category
      if (cat.id === 'live') {
        this.loadLiveStreams();
      }
    } catch (err) {
      console.error('Error loading category content:', err);
      this.error.set('Failed to load content. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Load news content by fetching recent articles and events from curated creators.
   * Gets 2 articles and 2 events from each featured creator.
   */
  private async loadNewsContent(pubkeyRefs: PubkeyRef[]): Promise<void> {
    if (pubkeyRefs.length === 0) return;

    const [articlesData, eventsData] = await Promise.all([
      this.discoveryService.loadRecentArticlesFromAuthors(pubkeyRefs, 2),
      this.discoveryService.loadRecentEventsFromAuthors(pubkeyRefs, 2),
    ]);

    // Convert to CuratedArticle format
    const articles: CuratedArticle[] = articlesData.map(item => ({
      id: item.id,
      pubkey: item.pubkey,
      slug: item.slug,
      kind: item.kind,
      createdAt: item.createdAt,
    }));

    this.articles.set(articles);
    // Store full events for news category so they can be passed directly to components
    this.newsEvents.set(eventsData);
    this.events.set([]); // Clear the regular events signal for news

    // Clear other content types for news
    this.videos.set([]);
    this.pictures.set([]);
  }

  /**
   * Load current live streams (limited to 3 for preview)
   */
  private loadLiveStreams(): void {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
      console.warn('No relays available for loading streams');
      return;
    }

    this.streamsLoading.set(true);
    const eventMap = new Map<string, Event>();

    const filter: Filter = {
      kinds: [30311],
      limit: 50,
    };

    // Set a timeout to stop loading
    const loadingTimeout = setTimeout(() => {
      if (this.streamsLoading()) {
        this.streamsLoading.set(false);
        this.updateLiveStreams(eventMap);
      }
    }, 5000);

    this.streamsSubscription = this.pool.subscribe(
      relayUrls,
      filter,
      (event: Event) => {
        // Use d-tag + pubkey as unique identifier for replaceable events
        const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
        const uniqueId = `${event.pubkey}:${dTag}`;

        // Check if we already have this event and if the new one is newer
        const existing = eventMap.get(uniqueId);
        if (existing && existing.created_at >= event.created_at) {
          return;
        }

        eventMap.set(uniqueId, event);

        // Update streams list
        this.updateLiveStreams(eventMap);

        if (this.streamsLoading()) {
          clearTimeout(loadingTimeout);
          this.streamsLoading.set(false);
        }
      }
    );
  }

  /**
   * Filter and update live streams (only currently live, limited to 4)
   */
  private updateLiveStreams(eventMap: Map<string, Event>): void {
    const live: Event[] = [];

    for (const event of eventMap.values()) {
      const statusTag = event.tags.find((tag: string[]) => tag[0] === 'status');
      const status = statusTag?.[1] || 'planned';

      if (status === 'live') {
        live.push(event);
      }
    }

    // Sort by created_at descending and limit to 3
    live.sort((a, b) => b.created_at - a.created_at);
    this.liveStreams.set(live.slice(0, 3));
  }

  viewAllStreams(): void {
    this.router.navigate(['/streams']);
  }

  goBack(): void {
    const type = this.categoryType();
    this.router.navigate(['/discover'], {
      queryParams: type === 'media' ? { tab: 'media' } : undefined,
    });
  }

  viewCreator(pubkey: string): void {
    this.router.navigate(['/p', pubkey]);
  }

  viewEvent(item: CuratedItem): void {
    // Navigate to event view
    this.router.navigate(['/e', item.id]);
  }

  viewVideo(item: CuratedItem): void {
    // Navigate to video view
    this.router.navigate(['/v', item.id]);
  }

  viewPicture(item: CuratedItem): void {
    // Navigate to picture/event view
    this.router.navigate(['/e', item.id]);
  }

  /**
   * Parse addressable IDs (kind:pubkey:slug) into CuratedArticle items and deduplicate.
   */
  private parseAndDeduplicateArticles(items: { id: string; pubkey: string; relay?: string; kind: number; createdAt: number }[]): CuratedArticle[] {
    const seen = new Set<string>();
    const result: CuratedArticle[] = [];

    for (const item of items) {
      // Skip duplicates
      if (seen.has(item.id)) continue;
      seen.add(item.id);

      // Parse addressable ID: kind:pubkey:slug
      const parts = item.id.split(':');
      if (parts.length >= 3) {
        const kind = parseInt(parts[0], 10);
        const pubkey = parts[1];
        const slug = parts.slice(2).join(':'); // d-tag may contain colons

        result.push({
          id: item.id,
          pubkey,
          slug,
          kind: isNaN(kind) ? item.kind : kind,
          relayHints: item.relay ? [item.relay] : undefined,
          createdAt: item.createdAt,
        });
      }
    }

    return result;
  }
}
