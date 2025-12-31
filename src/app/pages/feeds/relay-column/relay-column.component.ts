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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EventComponent } from '../../../components/event/event.component';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { LoggerService } from '../../../services/logger.service';
import { RelaysService, Nip11RelayInfo } from '../../../services/relays/relays';
import { Router, ActivatedRoute } from '@angular/router';
import { SimplePool, Filter } from 'nostr-tools';
import { Event } from 'nostr-tools';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';

const PAGE_SIZE = 10;

const DEFAULT_RELAYS: string[] = [
  'trending.relays.land',
  'nostrelites.org',
  'wot.nostr.net',
  'wotr.relatr.xyz',
  'primus.nostr1.com',
  'nostr.land',
  'nos.lol',
  'nostr.wine',
  'news.utxo.one',
  '140.f7z.io',
  'pyramid.fiatjaf.com',
  'relay.damus.io',
  'relay.primal.net',
  'nostr21.com',
];

@Component({
  selector: 'app-relay-column',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
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
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private clipboard = inject(Clipboard);

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

  // Saved relay list
  savedRelays = signal<string[]>([]);

  // Events from the relay
  private allEvents = signal<Event[]>([]);
  private displayCount = signal(PAGE_SIZE);

  // Pool and subscription management
  private pool: SimplePool | null = null;
  private abortController: AbortController | null = null;
  private intersectionObserver?: IntersectionObserver;

  // Computed signals
  displayedEvents = computed(() => this.allEvents().slice(0, this.displayCount()));
  hasEvents = computed(() => this.displayedEvents().length > 0);
  hasMore = computed(() => this.displayCount() < this.allEvents().length);

  // Full WebSocket URL
  relayUrl = computed(() => {
    const domain = this.relayDomain();
    if (!domain) return '';
    if (domain.startsWith('wss://') || domain.startsWith('ws://')) {
      return domain;
    }
    return `wss://${domain}`;
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
    const info = this.relayInfo();
    if (info?.name) {
      return info.name;
    }
    return this.relayDomain() || 'Unknown Relay';
  });

  // Check if contact is a URL
  contactUrl = computed(() => {
    const contact = this.relayInfo()?.contact;
    if (!contact) return null;
    // Check if it looks like a URL
    if (contact.startsWith('http://') || contact.startsWith('https://')) {
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

    // Load saved relays when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.loadSavedRelays(pubkey);
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
    this.pool?.close([this.relayUrl()]);
    this.pool = null;
  }

  private loadSavedRelays(pubkey: string): void {
    try {
      const stored = this.accountLocalState.getPublicRelayFeeds(pubkey);
      if (stored && stored.length > 0) {
        this.savedRelays.set(stored);
      } else {
        // Initialize with defaults
        this.savedRelays.set([...DEFAULT_RELAYS]);
        this.saveSavedRelays();
      }
    } catch (error) {
      this.logger.error('Error loading saved relays:', error);
      this.savedRelays.set([...DEFAULT_RELAYS]);
    }
  }

  private saveSavedRelays(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      this.accountLocalState.setPublicRelayFeeds(pubkey, this.savedRelays());
    } catch (error) {
      this.logger.error('Error saving relays:', error);
    }
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
    const url = this.relayUrl();
    if (!url) return;

    // Cleanup previous subscription
    this.cleanup();

    this.isLoading.set(true);
    this.error.set(null);
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

      // Query the relay
      const sub = this.pool.subscribeMany([url], filter, {
        onevent: (event: Event) => {
          events.push(event);
          // Sort by created_at descending and update
          events.sort((a, b) => b.created_at - a.created_at);
          this.allEvents.set([...events]);
        },
        oneose: () => {
          this.logger.debug(`Got ${events.length} events from ${url}`);
          this.isLoading.set(false);
          this.isRefreshing.set(false);
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
