import { ChangeDetectionStrategy, Component, inject, input, signal, effect, computed, untracked } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { LayoutService } from '../../services/layout.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { UserDataService } from '../../services/user-data.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { LoggerService } from '../../services/logger.service';
import { TimestampPipe } from '../../pipes/timestamp.pipe';

@Component({
  selector: 'app-live-event-embed',
  imports: [
    UpperCasePipe,
    MatIconModule,
    MatButtonModule,
    UserProfileComponent,
    TimestampPipe,
  ],
  templateUrl: './live-event-embed.component.html',
  styleUrl: './live-event-embed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveEventEmbedComponent {
  // Required inputs for event identification (same pattern as ArticleComponent)
  identifier = input.required<string>();
  pubkey = input.required<string>();
  kind = input.required<number>();

  // Optional inputs
  relayHints = input<string[] | undefined>(undefined);
  clickable = input<boolean>(true);

  // Services
  private data = inject(DataService);
  private layout = inject(LayoutService);
  private userDataService = inject(UserDataService);
  private utilities = inject(UtilitiesService);
  private accountState = inject(AccountStateService);
  private relayPool = inject(RelayPoolService);
  private router = inject(Router);
  private logger = inject(LoggerService);

  // State
  record = signal<NostrRecord | null>(null);
  loading = signal<boolean>(false);
  thumbnailError = signal(false);

  constructor() {
    let lastLoadKey = '';

    effect(() => {
      const pubkey = this.pubkey();
      const identifier = this.identifier();
      const kind = this.kind();

      if (pubkey && identifier && kind) {
        const currentLoadKey = `${pubkey}:${kind}:${identifier}`;

        if (currentLoadKey !== lastLoadKey) {
          lastLoadKey = currentLoadKey;

          untracked(() => {
            this.loadEvent();
          });
        }
      }
    });
  }

  // Computed properties
  event = computed(() => this.record()?.event);

  title = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    const titleTag = ev.tags.find((tag: string[]) => tag[0] === 'title');
    const fullTitle = titleTag?.[1] || 'Untitled Live Event';
    return fullTitle.length > 100 ? fullTitle.substring(0, 100) + '...' : fullTitle;
  });

  summary = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    const summaryTag = ev.tags.find((tag: string[]) => tag[0] === 'summary');
    const fullSummary = summaryTag?.[1] || '';
    return fullSummary.length > 150 ? fullSummary.substring(0, 150) + '...' : fullSummary;
  });

  status = computed(() => {
    const ev = this.event();
    if (!ev) return 'planned';
    const statusTag = ev.tags.find((tag: string[]) => tag[0] === 'status');
    return statusTag?.[1] || 'planned';
  });

  thumbnail = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    const thumbTag = ev.tags.find((tag: string[]) => tag[0] === 'thumb');
    const imageTag = ev.tags.find((tag: string[]) => tag[0] === 'image');
    return thumbTag?.[1] || imageTag?.[1] || '';
  });

  starts = computed(() => {
    const ev = this.event();
    if (!ev) return null;
    const startsTag = ev.tags.find((tag: string[]) => tag[0] === 'starts');
    return startsTag?.[1] ? parseInt(startsTag[1], 10) : null;
  });

  statusIcon = computed(() => {
    switch (this.status()) {
      case 'live': return 'sensors';
      case 'planned': return 'schedule';
      case 'ended': return 'stop_circle';
      default: return 'sensors';
    }
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

  private async loadEvent(): Promise<void> {
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
            '#d': [this.identifier()],
          };
          const relayEvent = await this.relayPool.get(validRelayHints, filter, 10000);
          if (relayEvent) {
            event = this.data.toRecord(relayEvent);
          }
        } catch {
          this.logger.debug(`Relay hints fetch failed for live event ${this.identifier()}, trying regular fetch`);
        }
      }

      // If relay hints didn't work, fall back to discovered relays
      if (!event) {
        const isNotCurrentUser = !this.accountState.isCurrentUser(this.pubkey());

        if (isNotCurrentUser) {
          event = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
            this.pubkey(),
            this.kind(),
            this.identifier(),
            { save: false, cache: false }
          );
        } else {
          event = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
            this.pubkey(),
            this.kind(),
            this.identifier(),
            { save: false, cache: false }
          );
        }
      }

      this.record.set(event);
    } catch (error) {
      this.logger.error('Error loading live event:', error);
      this.record.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  openStream(event?: Event): void {
    if (!this.clickable()) return;
    event?.stopPropagation();

    const naddr = nip19.naddrEncode({
      identifier: this.identifier(),
      pubkey: this.pubkey(),
      kind: this.kind(),
    });

    this.router.navigate(['/stream', naddr]);
  }

  onThumbnailError(): void {
    this.thumbnailError.set(true);
  }
}
