import { Component, inject, signal, Input, OnChanges, SimpleChanges, effect, ChangeDetectionStrategy, computed, untracked } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BookmarkService } from '../../../services/bookmark.service';
import { MatButtonModule } from '@angular/material/button';
import { UtilitiesService } from '../../../services/utilities.service';
import { LayoutService } from '../../../services/layout.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { Event, nip19 } from 'nostr-tools';
import { ReactionButtonComponent } from '../../../components/event/reaction-button/reaction-button.component';
import { ZapButtonComponent } from '../../../components/zap-button/zap-button.component';
import { EventService } from '../../../services/event';
import { SharedRelayService } from '../../../services/relays/shared-relay';
import { ZapService } from '../../../services/zap.service';
import { AccountStateService } from '../../../services/account-state.service';

/** Engagement metrics for an article */
interface ArticleEngagement {
  reactionCount: number;
  commentCount: number;
  zapTotal: number;
  isLoading: boolean;
}

@Component({
  selector: 'app-profile-reads',
  imports: [
    MatIconModule,
    MatCardModule,
    RouterModule,
    MatTooltipModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
    AgoPipe,
    ReactionButtonComponent,
    ZapButtonComponent,
  ],
  templateUrl: './profile-reads.component.html',
  styleUrl: './profile-reads.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileReadsComponent implements OnChanges {
  @Input() isVisible = false;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  profileState = inject(PROFILE_STATE);
  bookmark = inject(BookmarkService);
  utilities = inject(UtilitiesService);
  private layoutService = inject(LayoutService);
  private eventService = inject(EventService);
  private sharedRelay = inject(SharedRelayService);
  private zapService = inject(ZapService);
  private accountState = inject(AccountStateService);

  // Use sorted articles from profile state
  sortedArticles = computed(() => this.profileState.sortedArticles());

  // Store engagement data per article (keyed by event id)
  articleEngagement = signal<Map<string, ArticleEngagement>>(new Map());

  isLoading = signal(true);
  error = signal<string | null>(null);

  // Cooldown to prevent rapid-fire relay loading
  private lastLoadTime = 0;
  private readonly LOAD_COOLDOWN_MS = 2000;

  constructor() {
    // Effect to load initial articles if none are present and profile is loaded
    effect(() => {
      const currentPubkey = this.profileState.pubkey();
      const currentArticles = this.profileState.articles();

      // If we have a pubkey but no articles, and we're not already loading, load some articles
      if (currentPubkey && currentArticles.length === 0 && !this.profileState.isLoadingMoreArticles()) {
        this.logger.debug('No articles found for profile, loading initial articles...');
        this.loadMoreArticles();
      }
    });

    // Initial load of reads
    this.loadReads();

    // Set up continuous scrolling effect
    // Dynamically uses the correct panel's scroll signal based on where profile is rendered
    effect(() => {
      const isInRightPanel = this.profileState.isInRightPanel();
      const isAtBottom = isInRightPanel 
        ? this.layoutService.rightPanelScrolledToBottom() 
        : this.layoutService.leftPanelScrolledToBottom();
      const isReady = isInRightPanel 
        ? this.layoutService.rightPanelScrollReady() 
        : this.layoutService.leftPanelScrollReady();
      
      // Only proceed if scroll monitoring is ready and user has scrolled to bottom
      if (!isReady || !isAtBottom) {
        return;
      }

      // Use untracked to read state without creating dependencies
      untracked(() => {
        if (this.profileState.isLoadingMoreArticles() || !this.profileState.hasMoreArticles()) {
          return;
        }

        // Apply cooldown to prevent rapid-fire loading
        const now = Date.now();
        if (now - this.lastLoadTime < this.LOAD_COOLDOWN_MS) {
          return;
        }

        this.logger.debug('Scrolled to bottom, loading more articles...');
        this.lastLoadTime = now;
        this.loadMoreArticles();
      });
    });

    // Effect to load engagement data when articles change
    effect(() => {
      const articles = this.sortedArticles();
      const currentEngagement = this.articleEngagement();

      // Find articles without engagement data
      const newArticles = articles.filter(a => !currentEngagement.has(a.event.id));

      if (newArticles.length > 0) {
        // Load engagement data for new articles
        this.loadEngagementForArticles(newArticles.map(a => a.event));
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Check if visibility changed to true
    if (
      changes['isVisible'] &&
      changes['isVisible'].currentValue === true &&
      (!changes['isVisible'].firstChange || changes['isVisible'].previousValue === false)
    ) {
      this.logger.debug('Profile reads tab became visible, reloading data');
      this.loadReads();
    }
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  async loadReads(): Promise<void> {
    // Don't load if not visible (unless it's the initial load)
    // if (!this.isVisible && this.reads().length > 0) {
    //   return;
    // }
    // const pubkey = this.getPubkey();
    // if (!pubkey) {
    //   this.error.set('No pubkey provided');
    //   this.isLoading.set(false);
    //   return;
    // }
    // try {
    //   this.isLoading.set(true);
    //   this.error.set(null);
    //   // Mock data for now - would be replaced with actual fetch from NostrService
    //   await new Promise(resolve => setTimeout(resolve, 500));
    //   // Set empty array for now
    //   this.reads.set([]);
    //   this.logger.debug('Loaded reads for pubkey:', pubkey);
    // } catch (err) {
    //   this.logger.error('Error loading reads:', err);
    //   this.error.set('Failed to load reads');
    // } finally {
    //   this.isLoading.set(false);
    // }
  }

  /**
   * Load more articles (older articles)
   */
  async loadMoreArticles(): Promise<void> {
    if (this.profileState.isLoadingMoreArticles() || !this.profileState.hasMoreArticles()) {
      this.logger.debug('Already loading more articles or no more articles available, skipping');
      return;
    }

    this.logger.debug('Loading more articles for profile');

    try {
      const currentArticles = this.profileState.articles();
      const oldestTimestamp =
        currentArticles.length > 0
          ? Math.min(...currentArticles.map(a => a.event.created_at)) - 1
          : undefined;

      this.logger.debug(
        `Current articles count: ${currentArticles.length}, oldest timestamp: ${oldestTimestamp}`
      );

      // Load older articles from the profile state service
      const olderArticles = await this.profileState.loadMoreArticles(oldestTimestamp);

      this.logger.debug(`Loaded ${olderArticles.length} older articles`);

      if (olderArticles.length === 0) {
        this.logger.debug('No more articles available');
      }
    } catch (err) {
      this.logger.error('Failed to load more articles', err);
      this.error.set('Failed to load older articles. Please try again.');
    }
  }

  /**
   * Get the article title from the event tags
   */
  getArticleTitle(event: Event): string {
    return this.utilities.getTagValues('title', event.tags)[0] || '';
  }

  /**
   * Get the article image from the event tags
   */
  getArticleImage(event: Event): string {
    return this.utilities.getTagValues('image', event.tags)[0] || '';
  }

  /**
   * Open the full article page - passes event through router state for instant rendering
   */
  openArticle(event: Event): void {
    const slug = this.utilities.getTagValues('d', event.tags)[0];
    if (slug) {
      const naddr = nip19.naddrEncode({
        identifier: slug,
        pubkey: event.pubkey,
        kind: event.kind,
      });
      this.router.navigate([{ outlets: { right: ['a', naddr] } }], { state: { event } });
    }
  }

  /**
   * Open comments for an article
   */
  openComments(event: Event): void {
    // Navigate to the article page which shows comments
    this.openArticle(event);
  }

  /**
   * Share an article
   */
  shareArticle(event: Event): void {
    const slug = this.utilities.getTagValues('d', event.tags)[0];
    const title = this.getArticleTitle(event);

    if (slug) {
      const naddr = nip19.naddrEncode({
        identifier: slug,
        pubkey: event.pubkey,
        kind: event.kind,
      });
      const url = `${window.location.origin}/a/${naddr}`;

      if (navigator.share) {
        navigator.share({
          title: title || 'Article',
          text: `Check out this article on Nostria`,
          url: url,
        }).catch(err => this.logger.error('Error sharing article:', err));
      } else {
        // Fallback to clipboard - copyToClipboard shows its own snackbar
        this.layoutService.copyToClipboard(url, 'Article link');
      }
    }
  }

  /**
   * Load engagement data (comments count, zaps total) for articles
   */
  async loadEngagementForArticles(events: Event[]): Promise<void> {
    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    // Initialize loading state for each article
    const currentEngagement = new Map(this.articleEngagement());
    for (const event of events) {
      currentEngagement.set(event.id, {
        reactionCount: 0,
        commentCount: 0,
        zapTotal: 0,
        isLoading: true,
      });
    }
    this.articleEngagement.set(currentEngagement);

    // Load engagement for each article in parallel
    const loadPromises = events.map(async (event) => {
      try {
        const [reactionCount, commentCount, zapTotal] = await Promise.all([
          this.loadReactionCount(event, userPubkey),
          this.loadCommentCount(event, userPubkey),
          this.loadZapTotal(event),
        ]);

        // Update engagement data
        const updated = new Map(this.articleEngagement());
        updated.set(event.id, {
          reactionCount,
          commentCount,
          zapTotal,
          isLoading: false,
        });
        this.articleEngagement.set(updated);
      } catch (err) {
        this.logger.error('Failed to load engagement for article:', event.id, err);
        // Set loading to false even on error
        const updated = new Map(this.articleEngagement());
        updated.set(event.id, {
          reactionCount: 0,
          commentCount: 0,
          zapTotal: 0,
          isLoading: false,
        });
        this.articleEngagement.set(updated);
      }
    });

    await Promise.all(loadPromises);
  }

  /**
   * Load reaction count for an addressable event (article)
   */
  private async loadReactionCount(event: Event, userPubkey: string): Promise<number> {
    try {
      const reactions = await this.eventService.loadReactions(event.id, userPubkey);
      return reactions.events.length;
    } catch (err) {
      this.logger.error('Failed to load reactions for article:', err);
      return 0;
    }
  }

  /**
   * Load comment count for an addressable event (article)
   */
  private async loadCommentCount(event: Event, userPubkey: string): Promise<number> {
    try {
      // Get the 'd' tag (identifier) for addressable events
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
      const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;

      // Query for kind 1111 comments using the 'A' tag for addressable events
      const filter = {
        kinds: [1111],
        '#A': [aTagValue],
        limit: 100,
      };

      const comments = await this.sharedRelay.getMany(userPubkey, filter);
      return comments?.length || 0;
    } catch (err) {
      this.logger.error('Failed to load comments for article:', err);
      return 0;
    }
  }

  /**
   * Load total zap amount for an event
   */
  private async loadZapTotal(event: Event): Promise<number> {
    try {
      const zapReceipts = await this.zapService.getZapsForEvent(event.id);
      let total = 0;

      for (const receipt of zapReceipts) {
        const parsed = this.zapService.parseZapReceipt(receipt);
        if (parsed.amount) {
          total += parsed.amount;
        }
      }

      return total;
    } catch (err) {
      this.logger.error('Failed to load zaps for article:', err);
      return 0;
    }
  }

  /**
   * Get engagement data for an article
   */
  getEngagement(eventId: string): ArticleEngagement | undefined {
    return this.articleEngagement().get(eventId);
  }

  /**
   * Format zap amount with K/M suffix for display
   */
  formatZapAmount(amount: number): string {
    if (amount >= 1000000) {
      return (amount / 1000000).toFixed(1) + 'M';
    }
    if (amount >= 1000) {
      return (amount / 1000).toFixed(1) + 'k';
    }
    return amount.toString();
  }
}
