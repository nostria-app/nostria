import { Component, inject, signal, computed, OnDestroy, OnInit, effect } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { RouterLink } from '@angular/router';
import { Event, Filter, kinds, nip19 } from 'nostr-tools';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { ReportingService } from '../../services/reporting.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { LayoutService } from '../../services/layout.service';
import { DatabaseService } from '../../services/database.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { UserRelayService } from '../../services/relays/user-relay';
import { UserRelaysService } from '../../services/relays/user-relays';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { ArticleEventComponent } from '../../components/event-types/article-event.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import { ArticlesSettingsDialogComponent } from './articles-settings-dialog/articles-settings-dialog.component';

const PAGE_SIZE = 30;
const RELAY_SET_KIND = 30002;
const ARTICLES_RELAY_SET_D_TAG = 'articles';
const RELAY_QUERY_TIMEOUT_MS = 3000;
const BATCH_DELAY_MS = 100;

@Component({
  selector: 'app-articles-discover',
imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatTooltipModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatDividerModule,
    RouterLink,
    ArticleEventComponent,
    UserProfileComponent,
    AgoPipe,
    ArticlesSettingsDialogComponent,
  ],
  templateUrl: './articles.component.html',
  styleUrls: ['./articles.component.scss'],
})
export class ArticlesDiscoverComponent implements OnInit, OnDestroy {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private layout = inject(LayoutService);
  private database = inject(DatabaseService);
  private accountRelay = inject(AccountRelayService);
  private userRelay = inject(UserRelayService);
  private userRelays = inject(UserRelaysService);
  private accountLocalState = inject(AccountLocalStateService);

  allArticles = signal<Event[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  
  // Filter signals for which articles to show
  showFollowing = signal(true);
  showPublic = signal(false);

  // Computed feed source based on what's enabled (for toggle UI)
  feedSource = computed(() => {
    if (this.showFollowing()) return 'following';
    return 'public';
  });

  // Pagination state
  followingDisplayCount = signal(PAGE_SIZE);
  publicDisplayCount = signal(PAGE_SIZE);

  private followingSubscription: { close: () => void } | null = null;
  private publicSubscription: { close: () => void } | null = null;
  private eventMap = new Map<string, Event>();
  private wasScrolledToBottom = false;
  
  // Cooldown to prevent rapid-fire loading
  private lastLoadTime = 0;
  private readonly LOAD_COOLDOWN_MS = 2000;

  // Articles relay set state
  articlesRelaySet = signal<Event | null>(null);
  articlesRelays = signal<string[]>([]);

  // Settings dialog visibility
  showSettingsDialog = signal(false);

  // Following pubkeys for filtering
  private followingPubkeys = computed(() => {
    return this.accountState.followingList() || [];
  });

  private currentPubkey = computed(() => this.accountState.pubkey());

  // All filtered articles sorted by date
  private allFollowingArticles = computed(() => {
    const following = this.followingPubkeys();
    if (following.length === 0) return [];

    return this.allArticles()
      .filter(article => following.includes(article.pubkey))
      .sort((a, b) => b.created_at - a.created_at);
  });

  private allPublicArticles = computed(() => {
    return this.allArticles()
      .filter(article => {
        // Don't include articles already in following
        const following = this.followingPubkeys();
        return !following.includes(article.pubkey);
      })
      .sort((a, b) => b.created_at - a.created_at);
  });

  // Paginated articles for display
  followingArticles = computed(() => {
    return this.allFollowingArticles().slice(0, this.followingDisplayCount());
  });

  publicArticles = computed(() => {
    return this.allPublicArticles().slice(0, this.publicDisplayCount());
  });

  currentArticles = computed(() => {
    const showFollowing = this.showFollowing();
    const showPublic = this.showPublic();
    
    // Combine articles based on what's enabled
    const articles: Event[] = [];
    
    if (showFollowing) {
      articles.push(...this.followingArticles());
    }
    
    if (showPublic) {
      articles.push(...this.publicArticles());
    }
    
    // Sort combined articles by date (newest first)
    return articles.sort((a, b) => b.created_at - a.created_at);
  });

  // Check if there are more articles to load
  hasMoreFollowing = computed(() => {
    return this.allFollowingArticles().length > this.followingDisplayCount();
  });

  hasMorePublic = computed(() => {
    return this.allPublicArticles().length > this.publicDisplayCount();
  });

  hasMore = computed(() => {
    const showFollowing = this.showFollowing();
    const showPublic = this.showPublic();
    
    // Has more if either enabled source has more
    if (showFollowing && this.hasMoreFollowing()) return true;
    if (showPublic && this.hasMorePublic()) return true;
    return false;
  });

  // Total counts
  followingCount = computed(() => this.allFollowingArticles().length);
  publicCount = computed(() => this.allPublicArticles().length);

  hasArticles = computed(() => {
    return this.allArticles().length > 0;
  });

  isAuthenticated = computed(() => this.app.authenticated());

  constructor() {
    // Load persisted filter settings from local state
    effect(() => {
      const pubkey = this.currentPubkey();
      if (pubkey) {
        const savedShowFollowing = this.accountLocalState.getArticlesShowFollowing(pubkey);
        const savedShowPublic = this.accountLocalState.getArticlesShowPublic(pubkey);
        this.showFollowing.set(savedShowFollowing);
        this.showPublic.set(savedShowPublic);
      }
    }, { allowSignalWrites: true });

    // Load cached articles from database first
    this.loadCachedArticles();

    // Start subscriptions based on filter settings
    effect(() => {
      const showFollowing = this.showFollowing();
      const showPublic = this.showPublic();
      
      if (showFollowing) {
        this.startFollowingSubscription();
      }
      
      if (showPublic && !this.publicSubscription) {
        this.startPublicSubscription();
      }
    });

    // Effect to handle scroll events from layout service when user scrolls to bottom
    // Uses leftPanelScrolledToBottom since articles render in the left panel
    effect(() => {
      const isAtBottom = this.layout.leftPanelScrolledToBottom();
      const isReady = this.layout.leftPanelScrollReady();

      // Detect transition from not-at-bottom to at-bottom
      const justScrolledToBottom = isReady && isAtBottom && !this.wasScrolledToBottom;

      // Update the previous state
      this.wasScrolledToBottom = isAtBottom;

      // Only proceed if we just scrolled to bottom
      if (!justScrolledToBottom) {
        return;
      }

      // Check other conditions
      if (this.loadingMore() || !this.hasMore()) {
        return;
      }

      // Apply cooldown to prevent rapid-fire loading
      const now = Date.now();
      if (now - this.lastLoadTime < this.LOAD_COOLDOWN_MS) {
        return;
      }
      this.lastLoadTime = now;

      this.loadMore();
    });
  }

  ngOnInit(): void {
    // No panel actions setup needed - header is rendered directly in template
  }

  ngOnDestroy(): void {
    if (this.followingSubscription) {
      this.followingSubscription.close();
    }
    if (this.publicSubscription) {
      this.publicSubscription.close();
    }
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;

    this.loadingMore.set(true);

    setTimeout(() => {
      // Load more for whichever sources are enabled and have more
      if (this.showFollowing() && this.hasMoreFollowing()) {
        this.followingDisplayCount.update(count => count + PAGE_SIZE);
      }
      if (this.showPublic() && this.hasMorePublic()) {
        this.publicDisplayCount.update(count => count + PAGE_SIZE);
      }
      this.loadingMore.set(false);
    }, 100);
  }

  toggleShowFollowing(): void {
    const newValue = !this.showFollowing();
    this.showFollowing.set(newValue);

    // Persist the setting
    const pubkey = this.currentPubkey();
    if (pubkey) {
      this.accountLocalState.setArticlesShowFollowing(pubkey, newValue);
    }

    // Start subscription if enabling and not already subscribed
    if (newValue && !this.followingSubscription) {
      this.startFollowingSubscription();
    }
  }

  toggleShowPublic(): void {
    const newValue = !this.showPublic();
    this.showPublic.set(newValue);

    // Persist the setting
    const pubkey = this.currentPubkey();
    if (pubkey) {
      this.accountLocalState.setArticlesShowPublic(pubkey, newValue);
    }

    // Start subscription if enabling and not already subscribed
    if (newValue && !this.publicSubscription) {
      this.startPublicSubscription();
    }
  }

  /**
   * Handle feed source toggle change from UI
   */
  onSourceChange(source: string): void {
    if (source === 'following') {
      this.showFollowing.set(true);
      this.showPublic.set(false);
    } else {
      this.showFollowing.set(false);
      this.showPublic.set(true);
    }

    // Persist the settings
    const pubkey = this.currentPubkey();
    if (pubkey) {
      this.accountLocalState.setArticlesShowFollowing(pubkey, this.showFollowing());
      this.accountLocalState.setArticlesShowPublic(pubkey, this.showPublic());
    }

    // Start appropriate subscription if not already running
    if (source === 'following' && !this.followingSubscription) {
      this.startFollowingSubscription();
    } else if (source === 'public' && !this.publicSubscription) {
      this.startPublicSubscription();
    }
  }

  /**
   * Prevent menu from closing when clicking on toggle
   */
  preventMenuClose(event: MouseEvent): void {
    event.stopPropagation();
  }

  openArticle(event: Event): void {
    // Get the article identifier (d tag)
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';

    // Create naddr for the article
    const naddr = nip19.naddrEncode({
      identifier: dTag,
      kind: event.kind,
      pubkey: event.pubkey,
    });

    // Navigate to the article page using layout service
    this.layout.openArticle(naddr, event);
  }

  openSettings(): void {
    this.showSettingsDialog.set(true);
  }

  async onSettingsDialogClosed(result: { saved: boolean } | null): Promise<void> {
    this.showSettingsDialog.set(false);
    if (result?.saved) {
      // Reload articles relay set and restart subscriptions
      await this.loadArticlesRelaySet();
      this.refresh();
    }
  }

  /**
   * Load cached articles from the database
   */
  private async loadCachedArticles(): Promise<void> {
    try {
      const pubkey = this.currentPubkey();
      if (!pubkey) {
        this.loading.set(false);
        return;
      }

      const following = this.followingPubkeys();
      if (following.length === 0) {
        this.loading.set(false);
        return;
      }

      // Load articles from database for following users
      const cachedArticles = await this.database.getEventsByPubkeyAndKind(
        following,
        kinds.LongFormArticle
      );

      if (cachedArticles.length > 0) {
        console.log('[Articles] Loaded', cachedArticles.length, 'cached articles from database');

        // Update event map with cached articles
        cachedArticles.forEach(article => {
          const dTag = article.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
          const uniqueId = `${article.pubkey}:${dTag}`;

          // Skip if blocked
          if (this.reporting.isUserBlocked(article.pubkey) || this.reporting.isContentBlocked(article)) {
            return;
          }

          this.eventMap.set(uniqueId, article);
        });

        this.updateArticlesList();
      }
    } catch (error) {
      console.error('[Articles] Error loading cached articles:', error);
    }
  }

  /**
   * Pre-load the user's articles relay set (kind 30002 with d tag "articles")
   * First checks the local database, then fetches from relays and persists
   */
  private async loadArticlesRelaySet(): Promise<void> {
    const pubkey = this.currentPubkey();
    if (!pubkey) return;

    try {
      // First, try to load from local database for immediate use
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        pubkey,
        RELAY_SET_KIND,
        ARTICLES_RELAY_SET_D_TAG
      );

      if (cachedEvent) {
        console.log('[Articles] Loaded relay set from database:', cachedEvent);
        this.articlesRelaySet.set(cachedEvent);
        const relays = cachedEvent.tags
          .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
          .map((tag: string[]) => tag[1]);
        this.articlesRelays.set(relays);
      }

      // Then fetch from relays to get the latest version
      const accountRelays = this.accountRelay.getRelayUrls();
      const relayUrls = this.relaysService.getOptimalRelays(accountRelays);
      if (relayUrls.length === 0) return;

      const filter: Filter = {
        kinds: [RELAY_SET_KIND],
        authors: [pubkey],
        '#d': [ARTICLES_RELAY_SET_D_TAG],
        limit: 1,
      };

      let foundEvent: Event | null = null;

      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 3000);
        const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
          if (!foundEvent || event.created_at > foundEvent.created_at) {
            foundEvent = event;
          }
        });

        setTimeout(() => {
          sub.close();
          clearTimeout(timeout);
          resolve();
        }, 2000);
      });

      if (foundEvent) {
        const event = foundEvent as Event;
        // Only update if newer than cached
        if (!cachedEvent || event.created_at > cachedEvent.created_at) {
          console.log('[Articles] Found newer relay set from relays, updating...');
          this.articlesRelaySet.set(event);
          const relays = event.tags
            .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
            .map((tag: string[]) => tag[1]);
          this.articlesRelays.set(relays);

          // Persist to database
          const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
          await this.database.saveEvent({ ...event, dTag });
          console.log('[Articles] Saved relay set to database');
        }
      }
    } catch (error) {
      console.error('[Articles] Error loading articles relay set:', error);
    }
  }

  /**
   * Start subscription for articles from following users
   * Uses individual relay lists for each followed user
   */
  private async startFollowingSubscription(): Promise<void> {
    // Close existing subscription
    if (this.followingSubscription) {
      this.followingSubscription.close();
      this.followingSubscription = null;
    }

    // Load articles relay set first
    await this.loadArticlesRelaySet();

    const following = this.followingPubkeys();
    if (following.length === 0) {
      console.log('[Articles] No following list available');
      this.loading.set(false);
      return;
    }

    console.log('[Articles] Starting subscription for', following.length, 'following users');

    // Get account relays
    const accountRelays = this.accountRelay.getRelayUrls();

    // Combine with articles-specific relays from the user's relay set
    const customArticlesRelays = this.articlesRelays();
    const baseRelays = [...new Set([...accountRelays, ...customArticlesRelays])];

    console.log('[Articles] Account relays:', accountRelays);
    console.log('[Articles] Custom articles relays:', customArticlesRelays);
    console.log('[Articles] Base relays:', baseRelays);

    if (baseRelays.length === 0) {
      console.warn('[Articles] No relays available for loading articles');
      this.loading.set(false);
      return;
    }

    // Query articles from following users
    const filter: Filter = {
      kinds: [kinds.LongFormArticle], // kind 30023
      authors: following,
      limit: 100,
    };

    // Set a timeout to stop loading even if no events arrive
    const loadingTimeout = setTimeout(() => {
      if (this.loading()) {
        console.log('[Articles] No events received within timeout, stopping loading state');
        this.loading.set(false);
      }
    }, 5000);

    this.followingSubscription = this.pool.subscribe(
      baseRelays,
      filter,
      (event: Event) => {
        this.handleArticleEvent(event);

        // Mark as loaded once we start receiving events
        if (this.loading()) {
          clearTimeout(loadingTimeout);
          this.loading.set(false);
        }
      }
    );

    // Also query individual relay lists for each user in batches
    this.queryIndividualRelays(following);
  }

  /**
   * Query individual relay lists for each followed user
   * This ensures we get articles even if they're not on our main relays
   */
  private async queryIndividualRelays(pubkeys: string[]): Promise<void> {
    const BATCH_SIZE = 10;

    for (let i = 0; i < pubkeys.length; i += BATCH_SIZE) {
      const batch = pubkeys.slice(i, i + BATCH_SIZE);

      // Get relay lists for this batch of users
      const relayPromises = batch.map(async (pubkey) => {
        const relays = await this.userRelays.getUserRelays(pubkey);
        return { pubkey, relays };
      });

      const relayResults = await Promise.all(relayPromises);

      // Query each user's relays for their articles
      for (const { pubkey, relays } of relayResults) {
        if (relays.length === 0) continue;

        const filter: Filter = {
          kinds: [kinds.LongFormArticle],
          authors: [pubkey],
          limit: 20,
        };

        // Don't wait for these subscriptions, just let them populate in the background
        const sub = this.pool.subscribe(relays, filter, (event: Event) => {
          this.handleArticleEvent(event);
        });

        // Close after timeout
        setTimeout(() => sub.close(), RELAY_QUERY_TIMEOUT_MS);
      }

      // Small delay between batches to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  /**
   * Start subscription for public articles
   * Only called when user switches to public view
   */
  private startPublicSubscription(): void {
    // Close existing public subscription
    if (this.publicSubscription) {
      this.publicSubscription.close();
      this.publicSubscription = null;
    }

    // Get account relays
    const accountRelays = this.accountRelay.getRelayUrls();

    // Combine with articles-specific relays
    const customArticlesRelays = this.articlesRelays();
    const allRelayUrls = [...new Set([...accountRelays, ...customArticlesRelays])];

    console.log('[Articles] Starting public subscription with relays:', allRelayUrls);

    if (allRelayUrls.length === 0) {
      console.warn('[Articles] No relays available for loading public articles');
      return;
    }

    const filter: Filter = {
      kinds: [kinds.LongFormArticle],
      limit: 100,
    };

    this.publicSubscription = this.pool.subscribe(
      allRelayUrls,
      filter,
      (event: Event) => {
        this.handleArticleEvent(event);
      }
    );
  }

  /**
   * Handle incoming article event
   */
  private handleArticleEvent(event: Event): void {
    // Use d-tag + pubkey as unique identifier for replaceable events
    const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
    const uniqueId = `${event.pubkey}:${dTag}`;

    // Check if we already have this event and if the new one is newer
    const existing = this.eventMap.get(uniqueId);
    if (existing && existing.created_at >= event.created_at) {
      return;
    }

    // Skip articles from muted/blocked users
    if (this.reporting.isUserBlocked(event.pubkey)) {
      return;
    }

    // Skip articles that are blocked by content
    if (this.reporting.isContentBlocked(event)) {
      return;
    }

    // Store the latest version
    this.eventMap.set(uniqueId, event);

    // Update articles list
    this.updateArticlesList();

    // Save to database for caching in the background
    const dTagValue = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
    // Fire and forget - don't block the UI thread
    this.database.saveEvent({ ...event, dTag: dTagValue }).catch(error => {
      console.error('[Articles] Error saving article to database:', error);
    });
  }

  private updateArticlesList(): void {
    const articles = Array.from(this.eventMap.values());
    this.allArticles.set(articles);
  }

  refresh(): void {
    this.eventMap.clear();
    this.allArticles.set([]);
    this.loading.set(true);
    this.followingDisplayCount.set(PAGE_SIZE);
    this.publicDisplayCount.set(PAGE_SIZE);

    if (this.followingSubscription) {
      this.followingSubscription.close();
      this.followingSubscription = null;
    }

    if (this.publicSubscription) {
      this.publicSubscription.close();
      this.publicSubscription = null;
    }

    // Start subscriptions based on what's enabled
    if (this.showFollowing()) {
      this.startFollowingSubscription();
    }
    if (this.showPublic()) {
      this.startPublicSubscription();
    }
    
    // If nothing is enabled, stop loading
    if (!this.showFollowing() && !this.showPublic()) {
      this.loading.set(false);
    }
  }
}
