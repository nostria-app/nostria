import {
  Component,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { animate, style, transition, trigger } from '@angular/animations';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';
import { ApplicationService } from '../../../services/application.service';
import { DatabaseService } from '../../../services/database.service';
import type { TrustMetrics } from '../../../services/database.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DiscoveryRelayService } from '../../../services/relays/discovery-relay';
import { Metrics } from '../../../services/metrics';
import { UserMetric } from '../../../interfaces/metrics';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { TimestampPipe } from '../../../pipes/timestamp.pipe';
import { nip19, kinds } from 'nostr-tools';

interface RelayListInfo {
  hasRelayList: boolean;
  relayCount: number;
  updatedAt: number | null;
}

interface ContactListRelayInfo {
  hasRelaysInContacts: boolean;
  relayCount: number;
  updatedAt: number | null;
}

interface ProfileListItem {
  id: string;
  npub: string;
  name: string;
  picture: string | null;
}

interface MiniProfile {
  name: string;
  picture: string | null;
}

type InfoValue = boolean | number | string | null | undefined;

interface DiscoveryInfo {
  [key: string]: InfoValue;
  hasRelayList?: boolean;
  hasFollowingList?: boolean;
  hasFollowingListRelays?: boolean;
  foundOnDiscoveryRelays?: boolean;
  foundOnAccountRelays?: boolean;
  foundMetadataOnUserRelays?: boolean;
  foundMetadataOnAccountRelays?: boolean;
  foundZeroRelaysOnAccountRelays?: boolean;
  hasEmptyFollowingList?: boolean;
  relayCount?: number;
  followingCount?: number;
  updated?: number;
}

interface TrustDisplayItem {
  key: string;
  label: string;
  icon: string;
  value: string;
  highlight: boolean;
}

@Component({
  selector: 'app-following',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    ScrollingModule,
    AgoPipe,
    TimestampPipe,
  ],
  templateUrl: './details.component.html',
  styleUrl: './details.component.scss',
  animations: [
    trigger('slideInOut', [
      transition(':enter', [
        style({ transform: 'translateY(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateY(0)', opacity: 1 })),
      ]),
      transition(':leave', [
        animate('300ms ease-in', style({ transform: 'translateY(100%)', opacity: 0 })),
      ]),
    ]),
    trigger('profileShrink', [
      transition(':enter', [
        style({ transform: 'scale(1.3)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'scale(1)', opacity: 1 })),
      ]),
    ]),
  ],
})
export class DetailsComponent implements OnInit {
  private router = inject(Router);
  private accountRelay = inject(AccountRelayService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  app = inject(ApplicationService);
  database = inject(DatabaseService);
  private metricsService = inject(Metrics);
  private utilities = inject(UtilitiesService);

  @ViewChild('followingContainer') followingContainerRef!: ElementRef;

  isLoading = signal(true);
  error = signal<string | null>(null);
  followingList = signal<ProfileListItem[]>([]);
  mutualConnectionsList = signal<ProfileListItem[]>([]);
  selectedTabIndex = signal(0);
  npub = computed(() => {
    return (
      this.route.snapshot.paramMap.get('id') ||
      this.route.snapshot.parent?.paramMap.get('id') ||
      ''
    );
  });
  pubkeyHex = computed(() => {
    const id = this.npub();
    if (!id) return '';

    if (id.startsWith('npub')) {
      return this.utilities.getPubkeyFromNpub(id);
    }

    if (id.startsWith('nprofile')) {
      try {
        const decoded = nip19.decode(id);
        if (decoded.type === 'nprofile') {
          const data = decoded.data as { pubkey: string };
          return data.pubkey;
        }
      } catch (e) {
        this.logger.warn('Failed to decode nprofile:', e);
      }
    }

    return id;
  });
  userProfile = signal<MiniProfile | null>(null);

  // Item size for virtual scrolling (approx. height of each item in pixels)
  readonly itemSize = 72;

  // Buffer size determines how many items to render outside viewport
  readonly minBufferPx = 200;
  readonly maxBufferPx = 400;

  info = signal<DiscoveryInfo | null>(null);
  metrics = signal<UserMetric | null>(null);
  trustMetrics = signal<TrustMetrics | null>(null);
  profileUpdatedAt = signal<number | null>(null);
  relayListInfo = signal<RelayListInfo | null>(null);
  contactListRelayInfo = signal<ContactListRelayInfo | null>(null);

  trustDisplayItems = computed((): TrustDisplayItem[] => {
    const metrics = this.trustMetrics();
    if (!metrics) return [];

    const iconMap: Partial<Record<keyof TrustMetrics, string>> = {
      rank: 'verified',
      followers: 'people',
      hops: 'alt_route',
      personalizedGrapeRank_influence: 'insights',
      personalizedGrapeRank_average: 'query_stats',
      personalizedGrapeRank_confidence: 'shield',
      personalizedGrapeRank_input: 'input',
      personalizedPageRank: 'psychology',
      verifiedFollowerCount: 'group',
      verifiedMuterCount: 'volume_off',
      verifiedReporterCount: 'report',
    };

    const labelMap: Partial<Record<keyof TrustMetrics, string>> = {
      rank: 'Rank',
      followers: 'Followers',
      hops: 'Hops',
      postCount: 'Posts',
      replyCount: 'Replies',
      reactionsCount: 'Reactions',
      zapAmtRecd: 'Zap amount received',
      zapAmtSent: 'Zap amount sent',
      zapCntRecd: 'Zap count received',
      zapCntSent: 'Zap count sent',
      firstCreatedAt: 'First seen',
      lastUpdated: 'Last updated',
      personalizedGrapeRank_influence: 'GrapeRank influence',
      personalizedGrapeRank_average: 'GrapeRank average',
      personalizedGrapeRank_confidence: 'GrapeRank confidence',
      personalizedGrapeRank_input: 'GrapeRank input',
      personalizedPageRank: 'Personalized PageRank',
      verifiedFollowerCount: 'Verified followers',
      verifiedMuterCount: 'Verified muters',
      verifiedReporterCount: 'Verified reporters',
    };

    const formatNumber = (value: number): string => {
      if (Number.isInteger(value)) return `${value}`;
      return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    };

    const entries = (Object.entries(metrics) as [keyof TrustMetrics, unknown][])
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => [k, v as number] as const);

    const sortOrder: (keyof TrustMetrics)[] = [
      'rank',
      'followers',
      'verifiedFollowerCount',
      'hops',
      'personalizedGrapeRank_influence',
      'personalizedGrapeRank_average',
      'personalizedGrapeRank_confidence',
      'personalizedGrapeRank_input',
      'personalizedPageRank',
      'verifiedMuterCount',
      'verifiedReporterCount',
    ];

    const orderIndex = new Map<keyof TrustMetrics, number>(sortOrder.map((k, i) => [k, i]));

    entries.sort(([a], [b]) => (orderIndex.get(a) ?? 999) - (orderIndex.get(b) ?? 999));

    const result: TrustDisplayItem[] = [];

    result.push(
      ...entries.map(([key, value]) => {
        const label = labelMap[key] ?? key;
        const icon = iconMap[key] ?? 'insights';
        const highlight = key === 'rank';
        const displayValue = value === undefined ? '' : formatNumber(value);
        return { key: String(key), label, icon, value: displayValue, highlight };
      })
    );

    if (metrics.authorPubkey) {
      let providerValue = metrics.authorPubkey;
      try {
        providerValue = providerValue.startsWith('npub')
          ? providerValue
          : this.utilities.getNpubFromPubkey(providerValue);
      } catch {
        // Keep raw value if conversion fails
      }

      result.push({
        key: 'authorPubkey',
        label: 'Provider',
        icon: 'person',
        value: providerValue,
        highlight: false,
      });
    }

    return result;
  });

  infoAsJson = computed(() => {
    const infoData = this.info();
    if (!infoData) return '';
    return JSON.stringify(infoData, null, 2);
  });

  constructor() {
    // effect(async () => {
    //   const list = this.profileState.followingList();
    //   if (list && list.length > 0) {
    //     await this.loadFollowingList(list);
    //   }
    // });

    effect(async () => {
      if (this.app.authenticated()) {
        // TODO: make sure that the "npub" is hex.
        const info = await this.database.getInfo(this.pubkeyHex(), 'user');
        this.info.set(info as unknown as DiscoveryInfo);

        // Load metrics for this user
        const userMetrics = await this.metricsService.getUserMetric(this.pubkeyHex());
        this.metrics.set(userMetrics);
      }
    });

    effect(async () => {
      const pubkey = this.pubkeyHex();
      if (!pubkey) {
        this.trustMetrics.set(null);
        return;
      }

      const trust = await this.database.getTrustMetrics(pubkey);
      if (!trust) {
        this.trustMetrics.set(null);
        return;
      }

      // If older cached records are missing the provider pubkey, try to infer it
      // from locally stored kind 30382 events (no relay fetch).
      if (!trust.authorPubkey) {
        try {
          const events = await this.database.getEventsByKind(30382);
          const matching = events
            .filter(e => e.tags?.some(tag => tag[0] === 'd' && tag[1] === pubkey))
            .sort((a, b) => b.created_at - a.created_at);

          const providerPubkey = matching[0]?.pubkey;
          if (providerPubkey) {
            const enriched: TrustMetrics = { ...trust, authorPubkey: providerPubkey };
            this.trustMetrics.set(enriched);

            const existingRecord = await this.database.getInfo(pubkey, 'trust');
            if (existingRecord) {
              const data = { ...existingRecord };
              delete data['compositeKey'];
              delete data['key'];
              delete data['type'];
              delete data['updated'];
              await this.database.saveInfo(pubkey, 'trust', { ...data, authorPubkey: providerPubkey });
            }

            return;
          }
        } catch (e) {
          this.logger.debug('Unable to infer trust provider pubkey from local events', e);
        }
      }

      this.trustMetrics.set(trust);
    });

    effect(async () => {
      const pubkey = this.pubkeyHex();
      if (!pubkey) {
        this.profileUpdatedAt.set(null);
        return;
      }

      const metadataEvent = await this.database.getEventByPubkeyAndKind(pubkey, 0);
      this.profileUpdatedAt.set(metadataEvent?.created_at ?? null);
    });

    // Load relay list (kind 10002) and contact list relay (kind 3) info
    effect(async () => {
      const pubkey = this.pubkeyHex();
      if (!pubkey) {
        this.relayListInfo.set(null);
        this.contactListRelayInfo.set(null);
        return;
      }

      // Check for relay list (kind 10002)
      const relayListEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.RelayList);
      if (relayListEvent) {
        const relayUrls = this.utilities.getRelayUrls(relayListEvent);
        this.relayListInfo.set({
          hasRelayList: true,
          relayCount: relayUrls.length,
          updatedAt: relayListEvent.created_at,
        });
      } else {
        this.relayListInfo.set({
          hasRelayList: false,
          relayCount: 0,
          updatedAt: null,
        });
      }

      // Check for relays in contact list (kind 3)
      const contactsEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
      if (contactsEvent) {
        const relayUrls = this.utilities.getRelayUrlsFromFollowing(contactsEvent);
        this.contactListRelayInfo.set({
          hasRelaysInContacts: relayUrls.length > 0,
          relayCount: relayUrls.length,
          updatedAt: contactsEvent.created_at,
        });
      } else {
        this.contactListRelayInfo.set({
          hasRelaysInContacts: false,
          relayCount: 0,
          updatedAt: null,
        });
      }
    });
  }

  ngOnInit(): void {
    // Call loadMutualConnections to populate mutual connections list
    this.loadMutualConnections();
  }

  async broadcastProfile() {
    const event = await this.database.getEventByPubkeyAndKind(this.pubkeyHex(), 0);

    if (event) {
      this.logger.debug('Broadcasting metadata event:', event);
      // this.logger.debug('Relay URLs:', this.profileState.relay?.relayUrls);
      // await this.relay.publish(event, this.profileState.relay?.relayUrls);
      await this.accountRelay.publish(event);
    }
  }

  async broadcastRelayList() {
    const event = await this.database.getEventByPubkeyAndKind(this.pubkeyHex(), kinds.RelayList);

    if (event) {
      this.logger.debug('Broadcasting Relay List event:', event);
      this.logger.debug('Relay URLs:', this.discoveryRelay.getRelayUrls());
      await this.discoveryRelay.publish(event);
    }
  }

  /**
   * Scroll the component into view
   */
  // scrollToTop(): void {
  //   this.layoutService.scrollToElement('.following-header');
  //   this.logger.debug('Scrolled following container into view');
  // }

  async loadUserProfile(): Promise<void> {
    try {
      setTimeout(() => {
        this.userProfile.set({
          name: 'Example User',
          picture: 'https://example.com/avatar.jpg',
        });
      }, 300);
    } catch {
      this.error.set('Failed to load profile');
    }
  }

  async loadFollowingList(pubkeys: string[]): Promise<void> {
    try {
      this.isLoading.set(true);

      if (!pubkeys || pubkeys.length === 0) {
        this.followingList.set([]);
        this.isLoading.set(false);
        return;
      }

      const followingProfiles = pubkeys.map((pubkey, index) => ({
        id: pubkey,
        npub: pubkey,
        name: `User ${index + 1}`,
        picture: null,
      }));

      this.followingList.set(followingProfiles);
      this.isLoading.set(false);
    } catch (err) {
      this.error.set('Failed to load following list');
      this.isLoading.set(false);
      this.logger.error('Error loading following list', err);
    }
  }

  async loadMutualConnections(): Promise<void> {
    try {
      // In a real app, fetch mutual connections from an API
      // For demo purposes, we'll create mock data
      setTimeout(() => {
        const mockMutuals = Array(3)
          .fill(0)
          .map((_, index) => ({
            id: `mutual-${index}`,
            npub: `mutual-npub-${index}`,
            name: `Mutual User ${index + 1}`,
            picture: null,
          }));

        this.mutualConnectionsList.set(mockMutuals);
      }, 500);
    } catch (err) {
      this.logger.error('Error loading mutual connections', err as Error);
    }
  }

  onTabChanged(tabIndex: number): void {
    this.selectedTabIndex.set(tabIndex);
    // this.scrollToTop();
  }

  goBack(): void {
    this.location.back();
  }

  formatTimestamp(timestamp: number): string {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  }
}
