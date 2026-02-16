import {
  Component,
  inject,
  signal,
  computed,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';
import { ApplicationService } from '../../../services/application.service';
import { DatabaseService } from '../../../services/database.service';
import type { TrustMetrics } from '../../../services/database.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DiscoveryRelayService } from '../../../services/relays/discovery-relay';
import { DataService } from '../../../services/data.service';
import { Metrics } from '../../../services/metrics';
import { UserMetric } from '../../../interfaces/metrics';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { NostrRecord } from '../../../interfaces';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { TimestampPipe } from '../../../pipes/timestamp.pipe';
import { nip19, kinds, type Event as NostrEvent } from 'nostr-tools';

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

interface ReportTypeStat {
  type: string;
  count: number;
}

interface ModerationOverview {
  totalReports: number;
  uniqueReporters: number;
  uniqueMuters: number;
  unknownTypeReports: number;
  downloadedReportEvents: number;
  downloadedMuteListEvents: number;
  latestReportAt: number | null;
  reportTypes: ReportTypeStat[];
}

@Component({
  selector: 'app-details',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    AgoPipe,
    TimestampPipe,
  ],
  templateUrl: './details.component.html',
  styleUrl: './details.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailsComponent {
  private accountRelay = inject(AccountRelayService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private route = inject(ActivatedRoute);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  app = inject(ApplicationService);
  database = inject(DatabaseService);
  private metricsService = inject(Metrics);
  private utilities = inject(UtilitiesService);
  private dataService = inject(DataService);
  private panelNav = inject(PanelNavigationService);

  // The profile being viewed (loaded from DataService)
  viewingProfile = signal<NostrRecord | undefined>(undefined);

  info = signal<DiscoveryInfo | null>(null);
  metrics = signal<UserMetric | null>(null);
  trustMetrics = signal<TrustMetrics | null>(null);
  profileUpdatedAt = signal<number | null>(null);
  relayListInfo = signal<RelayListInfo | null>(null);
  contactListRelayInfo = signal<ContactListRelayInfo | null>(null);
  moderationOverview = signal<ModerationOverview | null>(null);
  isLoadingModerationSignals = signal(false);

  private readonly VALID_REPORT_TYPES = new Set([
    'nudity',
    'malware',
    'profanity',
    'illegal',
    'spam',
    'impersonation',
    'other',
  ]);

  /**
   * Resolves the pubkey identifier from route params.
   * Checks 'pubkey' param (user-details/:pubkey route) first,
   * then falls back to 'id' param (p/:id/details child route).
   */
  npub = computed(() => {
    return (
      this.route.snapshot.paramMap.get('pubkey') ||
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

  reportTypeBreakdown = computed(() => this.moderationOverview()?.reportTypes ?? []);

  constructor() {
    // Load profile data from DataService
    effect(() => {
      const pubkey = this.pubkeyHex();
      if (pubkey) {
        untracked(() => this.loadProfile(pubkey));
      }
    });

    effect(async () => {
      if (this.app.authenticated()) {
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

    effect(async () => {
      const pubkey = this.pubkeyHex();
      if (!pubkey) {
        this.moderationOverview.set(null);
        return;
      }

      await this.loadModerationOverview(pubkey);
    });
  }

  private async loadModerationOverview(pubkey: string): Promise<void> {
    this.isLoadingModerationSignals.set(true);

    try {
      const [accountReports, discoveryReports, accountMuteLists, discoveryMuteLists] = await Promise.all([
        this.accountRelay.getEventsByKindAndPubKeyTag(pubkey, kinds.Report),
        this.discoveryRelay.getEventsByKindAndPubKeyTag(pubkey, kinds.Report),
        this.accountRelay.getEventsByKindAndPubKeyTag(pubkey, kinds.Mutelist),
        this.discoveryRelay.getEventsByKindAndPubKeyTag(pubkey, kinds.Mutelist),
      ]);

      const reports = this.deduplicateEventsById([...accountReports, ...discoveryReports]);
      const muteLists = this.deduplicateReplaceableByAuthor([
        ...accountMuteLists,
        ...discoveryMuteLists,
      ]);

      await Promise.all([
        ...reports.map(event => this.database.saveEvent(event)),
        ...muteLists.map(event => this.database.saveReplaceableEvent(event)),
      ]);

      const reportTypeCounts = new Map<string, number>();
      const reporterPubkeys = new Set<string>();
      let unknownTypeReports = 0;

      for (const reportEvent of reports) {
        reporterPubkeys.add(reportEvent.pubkey);

        const matchedTypes = this.extractReportTypesForTarget(reportEvent, pubkey);

        if (matchedTypes.length === 0) {
          unknownTypeReports += 1;
          continue;
        }

        matchedTypes.forEach(type => {
          reportTypeCounts.set(type, (reportTypeCounts.get(type) ?? 0) + 1);
        });
      }

      const muterPubkeys = new Set<string>();
      for (const muteEvent of muteLists) {
        const hasMutedTarget = muteEvent.tags.some(tag => tag[0] === 'p' && tag[1] === pubkey);
        if (hasMutedTarget) {
          muterPubkeys.add(muteEvent.pubkey);
        }
      }

      const reportTypes = Array.from(reportTypeCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

      const latestReportAt = reports.reduce<number | null>((latest, event) => {
        if (!latest || event.created_at > latest) {
          return event.created_at;
        }
        return latest;
      }, null);

      this.moderationOverview.set({
        totalReports: reports.length,
        uniqueReporters: reporterPubkeys.size,
        uniqueMuters: muterPubkeys.size,
        unknownTypeReports,
        downloadedReportEvents: reports.length,
        downloadedMuteListEvents: muteLists.length,
        latestReportAt,
        reportTypes,
      });
    } catch (error) {
      this.logger.warn('Failed to load moderation overview', error);
      this.moderationOverview.set(null);
    } finally {
      this.isLoadingModerationSignals.set(false);
    }
  }

  private deduplicateEventsById(events: NostrEvent[]): NostrEvent[] {
    const unique = new Map<string, NostrEvent>();

    for (const event of events) {
      if (!event.id) continue;
      unique.set(event.id, event);
    }

    return Array.from(unique.values());
  }

  private deduplicateReplaceableByAuthor(events: NostrEvent[]): NostrEvent[] {
    const latestByAuthor = new Map<string, NostrEvent>();

    for (const event of events) {
      const existing = latestByAuthor.get(event.pubkey);
      if (!existing || event.created_at > existing.created_at) {
        latestByAuthor.set(event.pubkey, event);
      }
    }

    return Array.from(latestByAuthor.values());
  }

  private extractReportTypesForTarget(reportEvent: NostrEvent, targetPubkey: string): string[] {
    const reportTypes = new Set<string>();

    reportEvent.tags
      .filter(tag => tag[0] === 'p' && tag[1] === targetPubkey)
      .forEach(tag => {
        const reportType = tag[2]?.trim().toLowerCase();
        if (reportType && this.VALID_REPORT_TYPES.has(reportType)) {
          reportTypes.add(reportType);
        }
      });

    if (reportTypes.size > 0) {
      return Array.from(reportTypes);
    }

    reportEvent.tags
      .filter(tag => tag[0] === 'e')
      .forEach(tag => {
        const reportType = tag[2]?.trim().toLowerCase();
        if (reportType && this.VALID_REPORT_TYPES.has(reportType)) {
          reportTypes.add(reportType);
        }
      });

    return Array.from(reportTypes);
  }

  private async loadProfile(pubkey: string): Promise<void> {
    try {
      const profile = await this.dataService.getProfile(pubkey);
      this.viewingProfile.set(profile);
    } catch (e) {
      this.logger.warn('Failed to load profile for details page', e);
    }
  }

  getProfileDisplayName(): string {
    const profile = this.viewingProfile();
    if (!profile) return 'User';

    if (profile.data?.display_name) return profile.data.display_name;
    if (profile.data?.name) return profile.data.name;
    if (profile.data?.nip05) return this.utilities.parseNip05(profile.data.nip05) || 'User';
    return 'User';
  }

  async broadcastProfile() {
    const event = await this.database.getEventByPubkeyAndKind(this.pubkeyHex(), 0);

    if (event) {
      this.logger.debug('Broadcasting metadata event:', event);
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

  goBack(): void {
    // Check if we're in the right panel (auxiliary outlet)
    const isInRightPanel = this.route.outlet === 'right';

    if (isInRightPanel) {
      this.panelNav.goBackRight();
      return;
    }

    // Fallback for primary outlet
    history.back();
  }

  formatTimestamp(timestamp: number): string {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  }
}
