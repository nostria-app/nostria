import { Clipboard } from '@angular/cdk/clipboard';
import {
  Component,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  OnDestroy,
  ElementRef,
  ViewChild,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EventComponent } from '../../../components/event/event.component';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { LoggerService } from '../../../services/logger.service';
import { RelaysService, Nip11RelayInfo } from '../../../services/relays/relays';
import { RelayAuthService } from '../../../services/relays/relay-auth.service';
import { Router, ActivatedRoute } from '@angular/router';
import { SimplePool, Filter } from 'nostr-tools';
import { Event } from 'nostr-tools';
import { AccountStateService } from '../../../services/account-state.service';
import { RelayFeedsService } from '../../../services/relay-feeds.service';
import { RepostService } from '../../../services/repost.service';

const PAGE_SIZE = 10;

@Component({
  selector: 'app-relay-column',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    EventComponent,
    UserProfileComponent,
  ],
  templateUrl: './relay-column.component.html',
  styleUrl: './relay-column.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelayColumnComponent implements OnDestroy {
  private logger = inject(LoggerService);
  private relaysService = inject(RelaysService);
  private relayAuthService = inject(RelayAuthService);
  private accountState = inject(AccountStateService);
  private relayFeedsService = inject(RelayFeedsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private clipboard = inject(Clipboard);
  private repostService = inject(RepostService);

  // Input for the relay URL (without wss://)
  relayDomain = input<string>('');

  private loadMoreTriggerElement?: HTMLDivElement;

  @ViewChild('loadMoreTrigger')
  set loadMoreTrigger(element: ElementRef<HTMLDivElement> | undefined) {
    if (element?.nativeElement) {
      this.loadMoreTriggerElement = element.nativeElement;
      this.observeLoadMoreTrigger();
    }
  }

  // State
  isLoading = signal(false);
  isRefreshing = signal(false);
  isLoadingMore = signal(false);
  error = signal<string | null>(null);
  relayInfo = signal<Nip11RelayInfo | null>(null);
  isLoadingInfo = signal(false);
  isExpanded = signal(false);
  showReplies = signal(false);
  showReposts = signal(true);

  // Authentication state
  authRequired = signal(false);
  authError = signal<string | null>(null);
  isAuthenticating = signal(false);

  // Saved relay list
  savedRelays = signal<string[]>([]);

  // Events from the relay
  private allEvents = signal<Event[]>([]);
  private displayCount = signal(PAGE_SIZE);

  // Pool and subscription management
  private pool: SimplePool | null = null;
  private abortController: AbortController | null = null;
  private intersectionObserver?: IntersectionObserver;

  // Filter events based on showReplies and showReposts settings
  private filteredEvents = computed(() => {
    const events = this.allEvents();
    const showReplies = this.showReplies();
    const showReposts = this.showReposts();

    return events.filter(event => {
      // Check if it's a repost (kind 6 or kind 16)
      const isRepost = this.repostService.isRepostEvent(event);

      // If it's a repost, filter based on showReposts setting
      if (isRepost) {
        return showReposts;
      }

      // For non-repost events, filter based on showReplies setting
      if (!showReplies) {
        const hasReplyTag = event.tags.some(tag => tag[0] === 'e');
        return !hasReplyTag;
      }

      return true;
    });
  });

  // Computed signals
  displayedEvents = computed(() => this.filteredEvents().slice(0, this.displayCount()));
  hasEvents = computed(() => this.displayedEvents().length > 0);
  hasMore = computed(() => this.displayCount() < this.filteredEvents().length);

  // Parse potentially comma-separated relay domains
  relayDomains = computed(() => {
    const domain = this.relayDomain();
    if (!domain) return [];
    return domain.split(',').map(d => d.trim()).filter(d => d.length > 0);
  });

  // Full WebSocket URLs (array for multiple relays)
  relayUrls = computed(() => {
    const domains = this.relayDomains();
    return domains.map(domain => {
      if (domain.startsWith('wss://') || domain.startsWith('ws://')) {
        return domain;
      }
      return `wss://${domain}`;
    });
  });

  // Full WebSocket URL (for backwards compatibility - uses first relay)
  relayUrl = computed(() => {
    const urls = this.relayUrls();
    return urls.length > 0 ? urls[0] : '';
  });

  // Icon URL - try NIP-11 icon, then banner, then favicon
  iconUrl = computed(() => {
    const info = this.relayInfo();
    // First try the icon field
    if (info?.icon) {
      return info.icon;
    }
    // Some relays use banner as icon
    if (info?.banner) {
      return info.banner;
    }
    // Fallback to favicon
    const domain = this.relayDomain();
    if (domain) {
      return `https://${domain}/favicon.ico`;
    }
    return null;
  });

  // Display name
  displayName = computed(() => {
    const domains = this.relayDomains();
    if (domains.length > 1) {
      return `${domains.length} relays`;
    }
    const info = this.relayInfo();
    if (info?.name) {
      return info.name;
    }
    return domains.length > 0 ? domains[0] : 'Unknown Relay';
  });

  // Check if contact is a URL or mailto
  contactUrl = computed(() => {
    const contact = this.relayInfo()?.contact;
    if (!contact) return null;
    // Check if it looks like a URL or mailto
    if (contact.startsWith('http://') || contact.startsWith('https://') || contact.startsWith('mailto:')) {
      return contact;
    }
    return null;
  });

  // Parse software URL from git+ prefix or plain URL
  softwareUrl = computed(() => {
    const software = this.relayInfo()?.software;
    if (!software) return null;
    // Handle git+https://... format
    if (software.startsWith('git+')) {
      const url = software.slice(4).split(' ')[0]; // Remove 'git+' and any version suffix
      return url.replace(/\.git$/, ''); // Remove .git suffix if present
    }
    // Check if it's a plain URL
    if (software.startsWith('http://') || software.startsWith('https://')) {
      return software.split(' ')[0]; // Remove any version suffix
    }
    return null;
  });

  // Display software name (without git+ prefix)
  softwareDisplay = computed(() => {
    const software = this.relayInfo()?.software;
    if (!software) return null;
    // Handle git+https://... format - extract repo name
    if (software.startsWith('git+')) {
      const url = software.slice(4);
      // Extract just the repo name from the URL
      const match = url.match(/github\.com\/([^\/]+\/[^\/\.]+)/);
      if (match) {
        return match[1];
      }
    }
    return software;
  });

  constructor() {
    // React to relay domain changes
    effect(() => {
      const domain = this.relayDomain();
      if (domain) {
        this.fetchRelayInfo();
        this.fetchEvents();
      }
    });

    // Load saved relays and showReplies/showReposts settings when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.loadSavedRelays(pubkey);
        this.loadShowReplies(pubkey);
        this.loadShowReposts(pubkey);
      }
    });

    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    this.cleanup();
    this.intersectionObserver?.disconnect();
  }

  private cleanup(): void {
    this.abortController?.abort();
    const urls = this.relayUrls();
    if (urls.length > 0) {
      this.pool?.close(urls);
    }
    this.pool = null;
  }

  private async loadSavedRelays(pubkey: string): Promise<void> {
    try {
      // Load from kind 10012 event via RelayFeedsService
      const relays = await this.relayFeedsService.getRelayFeeds(pubkey);
      this.savedRelays.set(relays);
    } catch (error) {
      this.logger.error('Error loading saved relays:', error);
      // Fallback to defaults via service
      const defaults = this.relayFeedsService.getDefaultRelays();
      this.savedRelays.set(defaults);
    }
  }

  private async saveSavedRelays(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      // Save to kind 10012 event via RelayFeedsService
      await this.relayFeedsService.saveRelayFeeds(this.savedRelays());
    } catch (error) {
      this.logger.error('Error saving relays:', error);
    }
  }

  private loadShowReplies(pubkey: string): void {
    try {
      const key = `relay-column-show-replies-${pubkey}`;
      const stored = localStorage.getItem(key);
      this.showReplies.set(stored === 'true');
    } catch (error) {
      this.logger.error('Error loading showReplies setting:', error);
      this.showReplies.set(false);
    }
  }

  private saveShowReplies(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      const key = `relay-column-show-replies-${pubkey}`;
      localStorage.setItem(key, String(this.showReplies()));
    } catch (error) {
      this.logger.error('Error saving showReplies setting:', error);
    }
  }

  private loadShowReposts(pubkey: string): void {
    try {
      const key = `relay-column-show-reposts-${pubkey}`;
      const stored = localStorage.getItem(key);
      this.showReposts.set(stored !== 'false');
    } catch (error) {
      this.logger.error('Error loading showReposts setting:', error);
      this.showReposts.set(true);
    }
  }

  private saveShowReposts(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      const key = `relay-column-show-reposts-${pubkey}`;
      localStorage.setItem(key, String(this.showReposts()));
    } catch (error) {
      this.logger.error('Error saving showReposts setting:', error);
    }
  }

  toggleShowReplies(): void {
    this.showReplies.update(v => !v);
    this.saveShowReplies();
  }

  toggleShowReposts(): void {
    this.showReposts.update(v => !v);
    this.saveShowReposts();
  }

  toggleExpanded(): void {
    this.isExpanded.update(v => !v);
  }

  // State for copy feedback
  copiedUrl = signal(false);

  copyRelayUrl(): void {
    const url = this.relayUrl();
    if (url) {
      this.clipboard.copy(url);
      this.copiedUrl.set(true);
      setTimeout(() => this.copiedUrl.set(false), 2000);
    }
  }

  addRelay(domain: string): void {
    const normalizedDomain = domain.replace(/^wss?:\/\//, '').replace(/\/$/, '');
    if (!this.savedRelays().includes(normalizedDomain)) {
      this.savedRelays.update(relays => [...relays, normalizedDomain]);
      this.saveSavedRelays();
    }
  }

  removeRelay(domain: string): void {
    this.savedRelays.update(relays => relays.filter(r => r !== domain));
    this.saveSavedRelays();
  }

  isRelayInList(domain: string): boolean {
    return this.savedRelays().includes(domain);
  }

  private setupIntersectionObserver(): void {
    const options: IntersectionObserverInit = {
      root: null,
      rootMargin: '200px',
      threshold: 0.01,
    };

    this.intersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && this.hasMore()) {
          this.loadMore();
        }
      });
    }, options);
  }

  private observeLoadMoreTrigger(): void {
    if (this.intersectionObserver && this.loadMoreTriggerElement) {
      this.intersectionObserver.observe(this.loadMoreTriggerElement);
    }
  }

  async fetchRelayInfo(): Promise<void> {
    const url = this.relayUrl();
    if (!url) return;

    this.isLoadingInfo.set(true);
    try {
      const info = await this.relaysService.fetchNip11Info(url);
      this.relayInfo.set(info);
    } catch (error) {
      this.logger.error('Error fetching relay info:', error);
    } finally {
      this.isLoadingInfo.set(false);
    }
  }

  async fetchEvents(): Promise<void> {
    const urls = this.relayUrls();
    if (urls.length === 0) return;

    // Cleanup previous subscription
    this.cleanup();

    this.isLoading.set(true);
    this.error.set(null);
    this.authRequired.set(false);
    this.authError.set(null);
    this.displayCount.set(PAGE_SIZE);
    this.allEvents.set([]);

    this.abortController = new AbortController();

    try {
      this.pool = new SimplePool();

      const filter: Filter = {
        kinds: [1], // Text notes
        limit: 100,
      };

      const events: Event[] = [];

      // Get auth callback for NIP-42 authentication
      const authCallback = this.relayAuthService.getAuthCallback();

      // Query the relay(s) with auth support
      const sub = this.pool.subscribeMany(urls, filter, {
        onauth: authCallback,
        onevent: (event: Event) => {
          events.push(event);
          // Sort by created_at descending and update
          events.sort((a, b) => b.created_at - a.created_at);
          this.allEvents.set([...events]);
        },
        oneose: () => {
          this.logger.debug(`Got ${events.length} events from ${urls.length} relay(s)`);
          this.isLoading.set(false);
          this.isRefreshing.set(false);
        },
        onclose: (reasons: string[]) => {
          // Reasons is an array of close reasons from all relays
          for (const reason of reasons) {
            this.logger.debug(`Subscription closed: ${reason}`);

            // Check for auth-required or restricted messages
            if (reason.includes('auth-required:') || reason.includes('restricted:')) {
              this.logger.info(`Relay requires authentication: ${reason}`);
              this.authRequired.set(true);
              this.authError.set(reason);
              this.isLoading.set(false);
              this.isRefreshing.set(false);
              break;
            }
          }
        },
      });

      // Set timeout to close subscription
      setTimeout(() => {
        sub.close();
      }, 15000);
    } catch (error) {
      this.logger.error('Error fetching events from relay:', error);
      this.error.set('Failed to load events from relay');
      this.isLoading.set(false);
      this.isRefreshing.set(false);
    }
  }

  /**
   * Attempt to authenticate with the relay and retry fetching events.
   * This is called when user clicks "Authenticate" button after auth-required error.
   */
  async authenticateAndRetry(): Promise<void> {
    const url = this.relayUrl();
    if (!url) return;

    // Check if we can sign (have a signer available)
    if (!this.relayAuthService.canSign()) {
      this.authError.set('No signer available. Please sign in with a wallet or extension.');
      return;
    }

    this.isAuthenticating.set(true);
    this.authError.set(null);

    try {
      // Reset any previous auth failure for this relay so we can retry
      await this.relayAuthService.resetAuthFailure(url);

      // Clear the authRequired state and retry fetching
      this.authRequired.set(false);

      // Retry fetching events - the onauth callback will handle the actual authentication
      await this.fetchEvents();
    } catch (error) {
      this.logger.error('Error during authentication:', error);
      this.authError.set(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      this.isAuthenticating.set(false);
    }
  }

  loadMore(): void {
    if (!this.hasMore()) return;
    this.displayCount.update(count => count + PAGE_SIZE);
  }

  refresh(): void {
    this.isRefreshing.set(true);
    this.fetchEvents();
  }

  handleIconError(event: globalThis.Event): void {
    // Hide broken icon
    const target = event.target as HTMLImageElement;
    if (target) {
      target.style.display = 'none';
    }
  }
}
