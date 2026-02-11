import { Component, inject, input, signal, effect, computed, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { nip19 } from 'nostr-tools';
import { NostrRecord, ViewMode } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { LayoutService } from '../../services/layout.service';
import { UtilitiesService } from '../../services/utilities.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { DateToggleComponent } from '../date-toggle/date-toggle.component';
import { AccountStateService } from '../../services/account-state.service';
import { Cache } from '../../services/cache';
import { UserDataService } from '../../services/user-data.service';
import { RelayPoolService } from '../../services/relays/relay-pool';

@Component({
  selector: 'app-article',
  imports: [
    UserProfileComponent,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    DateToggleComponent,
  ],
  templateUrl: './article.component.html',
  styleUrl: './article.component.scss',
})
export class ArticleComponent {
  // Required inputs for article identification
  slug = input.required<string>();
  pubkey = input.required<string>();
  kind = input.required<number>();

  // Optional inputs for display customization
  mode = input<ViewMode>('compact');
  showAuthor = input<boolean>(true);
  showMetadata = input<boolean>(true);
  showActions = input<boolean>(false);
  clickable = input<boolean>(true);
  relayHints = input<string[] | undefined>(undefined);

  // Services
  private data = inject(DataService);
  private layout = inject(LayoutService);
  private userDataService = inject(UserDataService);
  private utilities = inject(UtilitiesService);
  private accountState = inject(AccountStateService);
  private cache = inject(Cache);
  private relayPool = inject(RelayPoolService);
  private router = inject(Router);

  // State
  record = signal<NostrRecord | null>(null);
  loading = signal<boolean>(false);

  constructor() {
    // Track the last loaded combination to prevent unnecessary reloads
    let lastLoadKey = '';

    effect(() => {
      const pubkey = this.pubkey();
      const slug = this.slug();
      const kind = this.kind();

      if (pubkey && slug && kind) {
        const currentLoadKey = `${pubkey}:${kind}:${slug}`;

        // Only load if the combination has actually changed
        if (currentLoadKey !== lastLoadKey) {
          lastLoadKey = currentLoadKey;

          // Use untracked to avoid creating reactive dependencies within the async operation
          untracked(() => {
            this.loadArticle();
          });
        }
      }
    });
  }

  // Computed properties for article metadata
  event = computed(() => this.record()?.event);

  title = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('title', ev.tags)[0] || '';
  });

  image = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('image', ev.tags)[0] || '';
  });

  summary = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('summary', ev.tags)[0] || '';
  });

  hashtags = computed(() => {
    const ev = this.event();
    if (!ev) return [];
    return [...new Set(this.utilities.getTagValues('t', ev.tags))];
  });

  publishedAtTimestamp = computed(() => {
    const ev = this.event();
    if (!ev) return 0;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return parseInt(publishedAtTag);
    }
    return ev.created_at;
  });

  authorPubkey = computed(() => {
    const ev = this.event();
    return ev?.pubkey || '';
  });

  /**
   * Filter out invalid relay hints (localhost, private IPs, etc.)
   */
  private getValidRelayHints(): string[] {
    const hints = this.relayHints();
    if (!hints || hints.length === 0) return [];

    return hints.filter(relay => {
      try {
        const url = new URL(relay);
        // Filter out localhost and private IP addresses
        const hostname = url.hostname.toLowerCase();
        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          hostname.startsWith('172.16.') ||
          hostname.startsWith('172.17.') ||
          hostname.startsWith('172.18.') ||
          hostname.startsWith('172.19.') ||
          hostname.startsWith('172.2') ||
          hostname.startsWith('172.30.') ||
          hostname.startsWith('172.31.')
        ) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    });
  }

  // Load article data
  private async loadArticle(): Promise<void> {
    // Prevent multiple simultaneous loads
    if (this.loading()) {
      return;
    }

    this.loading.set(true);

    try {
      let event: NostrRecord | null = null;

      // First, try relay hints if available and valid
      const validRelayHints = this.getValidRelayHints();
      if (validRelayHints.length > 0) {
        try {
          const filter = {
            authors: [this.pubkey()],
            kinds: [this.kind()],
            '#d': [this.slug()],
          };
          const relayEvent = await this.relayPool.get(validRelayHints, filter, 10000);
          if (relayEvent) {
            event = this.data.toRecord(relayEvent);
          }
        } catch {
          // Relay hints failed, will try regular fetch
          console.debug(`Relay hints fetch failed for article ${this.slug()}, trying regular fetch`);
        }
      }

      // If relay hints didn't work, fall back to discovered relays
      if (!event) {
        const isNotCurrentUser = !this.accountState.isCurrentUser(this.pubkey());

        if (isNotCurrentUser) {
          event = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
            this.pubkey(),
            this.kind(),
            this.slug(),
            { save: false, cache: false }
          );
        } else {
          event = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
            this.pubkey(),
            this.kind(),
            this.slug(),
            { save: false, cache: false }
          );
        }
      }

      this.record.set(event);
    } catch (error) {
      console.error('Error loading article:', error);
      this.record.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  openArticle(): void {
    if (!this.clickable()) return;

    const naddr = nip19.naddrEncode({
      identifier: this.slug(),
      pubkey: this.pubkey(),
      kind: this.kind(),
    });

    this.layout.openArticle(naddr, this.record()?.event);
  }

  openHashtagFeed(hashtag: string, event: MouseEvent): void {
    event.stopPropagation(); // Prevent opening the article when clicking hashtag
    this.router.navigate(['/f'], {
      queryParams: { t: hashtag },
    });
  }
}
