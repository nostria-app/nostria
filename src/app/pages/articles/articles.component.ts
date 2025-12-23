import { Component, inject, signal, computed, OnDestroy, HostListener } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { Event, Filter, kinds } from 'nostr-tools';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { ReportingService } from '../../services/reporting.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { ArticleEventComponent } from '../../components/event-types/article-event.component';

const PAGE_SIZE = 30;

@Component({
  selector: 'app-articles-discover',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    MatCardModule,
    ArticleEventComponent,
  ],
  templateUrl: './articles.component.html',
  styleUrls: ['./articles.component.scss'],
})
export class ArticlesDiscoverComponent implements OnDestroy {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);

  allArticles = signal<Event[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  feedSource = signal<'following' | 'public'>('public');

  // Pagination state
  followingDisplayCount = signal(PAGE_SIZE);
  publicDisplayCount = signal(PAGE_SIZE);

  private subscription: { close: () => void } | null = null;
  private eventMap = new Map<string, Event>();

  // Following pubkeys for filtering
  private followingPubkeys = computed(() => {
    return this.accountState.followingList() || [];
  });

  // All filtered articles sorted by date
  private allFollowingArticles = computed(() => {
    const following = this.followingPubkeys();
    if (following.length === 0) return [];

    return this.allArticles()
      .filter(article => following.includes(article.pubkey))
      .sort((a, b) => b.created_at - a.created_at);
  });

  private allPublicArticles = computed(() => {
    return this.allArticles().sort((a, b) => b.created_at - a.created_at);
  });

  // Paginated articles for display
  followingArticles = computed(() => {
    return this.allFollowingArticles().slice(0, this.followingDisplayCount());
  });

  publicArticles = computed(() => {
    return this.allPublicArticles().slice(0, this.publicDisplayCount());
  });

  currentArticles = computed(() => {
    const source = this.feedSource();
    if (source === 'following') return this.followingArticles();
    return this.publicArticles();
  });

  // Check if there are more articles to load
  hasMoreFollowing = computed(() => {
    return this.allFollowingArticles().length > this.followingDisplayCount();
  });

  hasMorePublic = computed(() => {
    return this.allPublicArticles().length > this.publicDisplayCount();
  });

  hasMore = computed(() => {
    const source = this.feedSource();
    if (source === 'following') return this.hasMoreFollowing();
    return this.hasMorePublic();
  });

  // Total counts
  followingCount = computed(() => this.allFollowingArticles().length);
  publicCount = computed(() => this.allPublicArticles().length);

  hasArticles = computed(() => {
    return this.allArticles().length > 0;
  });

  isAuthenticated = computed(() => this.app.authenticated());

  constructor() {
    this.startSubscription();
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.close();
    }
  }

  @HostListener('window:scroll')
  onScroll(): void {
    if (this.loadingMore() || !this.hasMore()) return;

    const scrollPosition = window.innerHeight + window.scrollY;
    const documentHeight = document.documentElement.scrollHeight;
    const threshold = 200;

    if (scrollPosition >= documentHeight - threshold) {
      this.loadMore();
    }
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;

    this.loadingMore.set(true);

    setTimeout(() => {
      const source = this.feedSource();
      if (source === 'following') {
        this.followingDisplayCount.update(count => count + PAGE_SIZE);
      } else {
        this.publicDisplayCount.update(count => count + PAGE_SIZE);
      }
      this.loadingMore.set(false);
    }, 100);
  }

  onSourceChange(source: 'following' | 'public'): void {
    this.feedSource.set(source);
  }

  private startSubscription(): void {
    const relayUrls = this.relaysService.getOptimalRelays(
      this.utilities.preferredRelays
    );

    if (relayUrls.length === 0) {
      console.warn('No relays available for loading articles');
      this.loading.set(false);
      return;
    }

    const filter: Filter = {
      kinds: [kinds.LongFormArticle], // kind 30023
      limit: 100,
    };

    // Set a timeout to stop loading even if no events arrive
    const loadingTimeout = setTimeout(() => {
      if (this.loading()) {
        console.log('[Articles] No events received within timeout, stopping loading state');
        this.loading.set(false);
      }
    }, 5000);

    this.subscription = this.pool.subscribe(
      relayUrls,
      filter,
      (event: Event) => {
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

        // Mark as loaded once we start receiving events
        if (this.loading()) {
          clearTimeout(loadingTimeout);
          this.loading.set(false);
        }
      }
    );
  }

  private updateArticlesList(): void {
    const articles = Array.from(this.eventMap.values());
    this.allArticles.set(articles);
  }

  refresh(): void {
    this.eventMap.clear();
    this.loading.set(true);
    this.followingDisplayCount.set(PAGE_SIZE);
    this.publicDisplayCount.set(PAGE_SIZE);

    if (this.subscription) {
      this.subscription.close();
    }

    this.startSubscription();
  }
}
