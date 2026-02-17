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
  profileState = inject(PROFILE_STATE);
  bookmark = inject(BookmarkService);
  utilities = inject(UtilitiesService);
  private layoutService = inject(LayoutService);
  private userRelaysService = inject(UserRelaysService);
  private customDialog = inject(CustomDialogService);

  // Use sorted articles from profile state
  sortedArticles = computed(() => this.profileState.sortedArticles());
  renderCount = signal(this.INITIAL_RENDER_COUNT);
  visibleArticles = computed(() => this.sortedArticles().slice(0, this.renderCount()));

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
      await this.userRelaysService.ensureRelaysForPubkey(event.pubkey);
      const authorRelays = this.userRelaysService.getRelaysForPubkey(event.pubkey);
      const relayHint = authorRelays[0];
      const relayHints = this.utilities.normalizeRelayUrls(relayHint ? [relayHint] : []);
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
