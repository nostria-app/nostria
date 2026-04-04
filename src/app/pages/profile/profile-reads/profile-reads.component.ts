import { Component, inject, signal, input, effect, ChangeDetectionStrategy, computed, untracked } from '@angular/core';

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
import { UserRelaysService } from '../../../services/relays/user-relays';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../../components/share-article-dialog/share-article-dialog.component';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { PinnedService } from '../../../services/pinned.service';
import { NostrRecord } from '../../../interfaces';
import { DatabaseService } from '../../../services/database.service';
import { AccountStateService } from '../../../services/account-state.service';

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
  ],
  templateUrl: './profile-reads.component.html',
  styleUrl: './profile-reads.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileReadsComponent {
  private readonly INITIAL_RENDER_COUNT = 12;
  private readonly RENDER_BATCH_SIZE = 12;

  isVisible = input(false);

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);
  profileState = inject(PROFILE_STATE);
  bookmark = inject(BookmarkService);
  utilities = inject(UtilitiesService);
  private layoutService = inject(LayoutService);
  private userRelaysService = inject(UserRelaysService);
  private customDialog = inject(CustomDialogService);
  private database = inject(DatabaseService);
  pinned = inject(PinnedService);
  private ownProfileCleanupDone = signal<string | null>(null);

  // Use sorted articles from profile state
  sortedArticles = computed(() => this.profileState.sortedArticles());
  renderCount = signal(this.INITIAL_RENDER_COUNT);
  visibleArticles = computed(() => this.sortedArticles().slice(0, this.renderCount()));

  pinnedArticles = signal<NostrRecord[]>([]);

  isLoading = signal(true);
  error = signal<string | null>(null);

  // Cooldown to prevent rapid-fire relay loading
  private lastLoadTime = 0;
  private readonly LOAD_COOLDOWN_MS = 2000;

  constructor() {
    // Effect to load pinned articles when profile changes
    effect(async () => {
      const currentPubkey = this.profileState.pubkey();

      if (currentPubkey) {
        await this.loadPinnedArticles(currentPubkey);
      } else {
        this.pinnedArticles.set([]);
      }
    });

    // Effect to reload pinned articles when the pinned service updates
    effect(async () => {
      const pinnedArticlesEvent = this.pinned.pinnedArticlesEvent();
      const currentPubkey = this.profileState.pubkey();

      if (currentPubkey && pinnedArticlesEvent && pinnedArticlesEvent.pubkey === currentPubkey) {
        this.logger.info('Pinned articles event changed, reloading pinned articles');
        setTimeout(async () => {
          await this.loadPinnedArticles(currentPubkey);
        }, 100);
      }
    });

    // Effect to load initial articles if none are present and profile is loaded
    effect(() => {
      const currentPubkey = this.profileState.pubkey();
      const currentArticles = this.profileState.articles();

      this.renderCount.set(this.INITIAL_RENDER_COUNT);

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
      const isAtTop = isInRightPanel
        ? this.layoutService.rightPanelScrolledToTop()
        : this.layoutService.leftPanelScrolledToTop();
      const isReady = isInRightPanel
        ? this.layoutService.rightPanelScrollReady()
        : this.layoutService.leftPanelScrollReady();

      // Only proceed if scroll monitoring is ready, user reached bottom, and has moved away from top
      if (!isReady || !isAtBottom || isAtTop) {
        return;
      }

      // Use untracked to read state without creating dependencies
      untracked(() => {
        if (this.profileState.isLoadingMoreArticles() || !this.profileState.hasMoreArticles()) {
          // Even when no more relay data is available, continue expanding render window
          if (!this.profileState.hasMoreArticles()) {
            this.expandRenderedWindow();
          }
          return;
        }

        // Apply cooldown to prevent rapid-fire loading
        const now = Date.now();
        if (now - this.lastLoadTime < this.LOAD_COOLDOWN_MS) {
          return;
        }

        // First reveal already-loaded articles from memory before fetching more
        if (this.expandRenderedWindow()) {
          this.lastLoadTime = now;
          return;
        }

        this.logger.debug('Scrolled to bottom, loading more articles...');
        this.lastLoadTime = now;
        this.loadMoreArticles();
      });
    });

    // Effect to reload reads when visibility changes to true
    effect(() => {
      const visible = this.isVisible();
      if (visible) {
        untracked(() => {
          this.logger.debug('Profile reads tab became visible, reloading data');
          this.loadReads();
        });
      }
    });

    effect(() => {
      const visible = this.isVisible();
      const profilePubkey = this.profileState.pubkey();
      const currentUserPubkey = this.accountState.pubkey();
      const articles = this.profileState.articles();

      if (!visible || !profilePubkey || typeof currentUserPubkey !== 'string' || profilePubkey !== currentUserPubkey) {
        return;
      }

      if (this.ownProfileCleanupDone() === profilePubkey || articles.length < 2) {
        return;
      }

      untracked(() => {
        void this.cleanupDuplicateOwnArticles(profilePubkey, articles);
      });
    });

  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  async loadReads(): Promise<void> {
  }

  private async cleanupDuplicateOwnArticles(pubkey: string, articles: NostrRecord[]): Promise<void> {
    const groups = new Map<string, NostrRecord[]>();

    for (const article of articles) {
      const dTag = this.utilities.getTagValues('d', article.event.tags)[0] || '';
      if (!dTag) {
        continue;
      }

      const key = `${article.event.pubkey}:${dTag}`;
      const existing = groups.get(key) ?? [];
      existing.push(article);
      groups.set(key, existing);
    }

    const duplicateIdsToDelete: string[] = [];
    const dedupedArticles = [...articles];

    for (const groupedArticles of groups.values()) {
      if (groupedArticles.length < 2) {
        continue;
      }

      const sorted = [...groupedArticles].sort((a, b) => {
        if (b.event.created_at !== a.event.created_at) {
          return b.event.created_at - a.event.created_at;
        }

        return b.event.id.localeCompare(a.event.id);
      });

      const keep = sorted[0];
      const stale = sorted.slice(1);

      for (const article of stale) {
        duplicateIdsToDelete.push(article.event.id);
        const index = dedupedArticles.findIndex(candidate => candidate.event.id === article.event.id);
        if (index >= 0) {
          dedupedArticles.splice(index, 1);
        }
      }

      this.logger.info(
        `[ProfileReads] Keeping latest article ${keep.event.id} for d-tag ${this.utilities.getTagValues('d', keep.event.tags)[0]}`
      );
    }

    this.ownProfileCleanupDone.set(pubkey);

    if (duplicateIdsToDelete.length === 0) {
      return;
    }

    await this.database.deleteEvents(duplicateIdsToDelete);
    this.profileState.articles.set(dedupedArticles);
    this.logger.info(`[ProfileReads] Removed ${duplicateIdsToDelete.length} duplicate article(s) from own profile`);
  }

  /**
   * Load pinned articles for the current profile.
   * Matches pinned article coordinates against loaded articles.
   */
  async loadPinnedArticles(pubkey: string): Promise<void> {
    try {
      const pinnedCoordinates = await this.pinned.getPinnedArticlesForUser(pubkey);
      this.logger.info(`Found ${pinnedCoordinates.length} pinned articles for ${pubkey}`, pinnedCoordinates);

      if (pinnedCoordinates.length === 0) {
        this.pinnedArticles.set([]);
        return;
      }

      // Match pinned coordinates against loaded articles
      const allArticles = this.profileState.articles();
      const matched = this.matchPinnedArticles(pinnedCoordinates, allArticles);
      this.pinnedArticles.set(matched);
      this.logger.debug(`Matched ${matched.length} pinned articles from ${allArticles.length} loaded articles`);
    } catch (err) {
      this.logger.error('Failed to load pinned articles', err);
    }
  }

  /**
   * Match pinned article coordinates against a list of article records.
   * Returns records in the order of the pinned coordinates.
   */
  private matchPinnedArticles(coordinates: string[], articles: NostrRecord[]): NostrRecord[] {
    return coordinates
      .map(coord => {
        // coord format: "30023:pubkey:d-tag"
        const parts = coord.split(':');
        if (parts.length < 3) return undefined;
        const kind = parseInt(parts[0], 10);
        const pubkey = parts[1];
        const dTag = parts.slice(2).join(':'); // d-tag may contain colons

        return articles.find(a => {
          if (a.event.kind !== kind || a.event.pubkey !== pubkey) return false;
          const articleDTag = this.utilities.getTagValues('d', a.event.tags)[0] || '';
          return articleDTag === dTag;
        });
      })
      .filter((r): r is NostrRecord => r !== undefined);
  }

  /**
   * Get the article coordinate (kind:pubkey:d-tag) for an event
   */
  getArticleCoordinate(event: Event): string {
    const dTag = this.utilities.getTagValues('d', event.tags)[0] || '';
    return `${event.kind}:${event.pubkey}:${dTag}`;
  }

  /**
   * Check if an article is pinned
   */
  isArticlePinned(event: Event): boolean {
    const coordinate = this.getArticleCoordinate(event);
    return this.pinnedArticles().some(r => this.getArticleCoordinate(r.event) === coordinate);
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

      // Make newly fetched items visible in controlled batches
      if (olderArticles.length > 0) {
        this.expandRenderedWindow();
      }

      this.logger.debug(`Loaded ${olderArticles.length} older articles`);

      if (olderArticles.length === 0) {
        this.logger.debug('No more articles available');
      }
    } catch (err) {
      this.logger.error('Failed to load more articles', err);
      this.error.set('Failed to load older articles. Please try again.');
    }
  }

  private expandRenderedWindow(): boolean {
    const total = this.sortedArticles().length;
    const current = this.renderCount();

    if (current >= total) {
      return false;
    }

    this.renderCount.set(Math.min(current + this.RENDER_BATCH_SIZE, total));
    return true;
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
   * Get article summary from summary tag, fallback to content excerpt
   */
  getArticleSummary(event: Event): string {
    const summary = this.utilities.getTagValues('summary', event.tags)[0] || '';
    if (summary.trim().length > 0) {
      return summary;
    }

    const plainContent = event.content
      .replace(/[#*_`>\[\]()-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return plainContent.slice(0, 180);
  }

  /**
   * Estimate reading time based on content length
   */
  getReadTime(event: Event): string {
    const words = event.content.split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.ceil(words / 220));
    return `${minutes} min read`;
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
      this.layoutService.openArticle(naddr, event);
    }
  }

  /**
   * Share an article
   */
  async shareArticle(event: Event): Promise<void> {
    const slug = this.utilities.getTagValues('d', event.tags)[0];
    const title = this.getArticleTitle(event);

    if (slug) {
      const authorRelays = await this.userRelaysService.getUserRelaysForPublishing(event.pubkey);
      const relayHints = this.utilities.getShareRelayHints(authorRelays);
      const naddr = nip19.naddrEncode({
        identifier: slug,
        pubkey: event.pubkey,
        kind: event.kind,
        relays: relayHints,
      });
      const encodedId = this.utilities.encodeEventForUrl(event, relayHints.length > 0 ? relayHints : undefined);
      const url = `${window.location.origin}/a/${naddr}`;

      const dialogData: ShareArticleDialogData = {
        title: title || 'Nostr Event',
        summary: this.getArticleSummary(event) || undefined,
        image: this.getArticleImage(event) || undefined,
        url,
        eventId: event.id,
        pubkey: event.pubkey,
        identifier: slug,
        kind: event.kind,
        encodedId,
        event,
        naddr,
      };

      this.customDialog.open(ShareArticleDialogComponent, {
        title: '',
        showCloseButton: false,
        panelClass: 'share-sheet-dialog',
        data: dialogData,
        width: '450px',
        maxWidth: '95vw',
      });
    }
  }

}
