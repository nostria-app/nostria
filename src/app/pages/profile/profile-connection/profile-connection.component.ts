import { Component, inject, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event, kinds } from 'nostr-tools';
import { NostrRecord } from '../../../interfaces';
import { UserDataService } from '../../../services/user-data.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { ZapService } from '../../../services/zap.service';
import { LayoutService } from '../../../services/layout.service';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { TimestampPipe } from '../../../pipes/timestamp.pipe';

// Interfaces
interface ExternalIdentity {
  platform: string;
  identity: string;
  proof: string;
  displayName: string;
  icon: string;
  profileUrl: string | null;
  proofUrl: string | null;
  verified: boolean;
}

interface ConnectionStats {
  firstInteraction: number | null;
  daysSinceFirstInteraction: number | null;
  totalInteractions: number;
  ourLikes: number;
  theirLikes: number;
  ourReplies: number;
  theirReplies: number;
  ourReposts: number;
  theirReposts: number;
  isFollowing: boolean;
  followsUs: boolean;
}

type InteractionType = 'like-given' | 'like-received' | 'reply-given' | 'reply-received' | 'repost-given' | 'repost-received';

interface Interaction {
  type: InteractionType;
  event: Event;
  timestamp: number;
  description: string;
  icon: string;
  iconColor: string;
}

interface ZapHistoryEntry {
  type: 'sent' | 'received';
  zapReceipt: Event;
  zapRequest: Event | null;
  amount: number;
  comment: string;
  counterparty: string;
  timestamp: number;
  eventId?: string;
}

@Component({
  selector: 'app-profile-connection',
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatListModule,
    MatTooltipModule,
    MatExpansionModule,
    MatMenuModule,
    AgoPipe,
    TimestampPipe,
  ],
  templateUrl: './profile-connection.component.html',
  styleUrl: './profile-connection.component.scss',
})
export class ProfileConnectionComponent {
  private userData = inject(UserDataService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private utilities = inject(UtilitiesService);
  private profileState = inject(PROFILE_STATE);
  private zapService = inject(ZapService);
  private snackBar = inject(MatSnackBar);
  layout = inject(LayoutService);

  // Get pubkey from profile state
  pubkey = computed(() => this.profileState.pubkey());

  // Overview signals
  stats = signal<ConnectionStats>({
    firstInteraction: null,
    daysSinceFirstInteraction: null,
    totalInteractions: 0,
    ourLikes: 0,
    theirLikes: 0,
    ourReplies: 0,
    theirReplies: 0,
    ourReposts: 0,
    theirReposts: 0,
    isFollowing: false,
    followsUs: false,
  });
  isLoadingOverview = signal<boolean>(true);
  metadata = signal<NostrRecord | null>(null);
  externalIdentities = computed(() => this.parseExternalIdentities());

  // Interactions signals
  interactions = signal<Interaction[]>([]);
  isLoadingInteractions = signal<boolean>(true);

  // Monetary signals
  allZaps = signal<ZapHistoryEntry[]>([]);
  isLoadingZaps = signal<boolean>(true);

  sentZaps = computed(() => this.allZaps().filter(zap => zap.type === 'sent'));
  receivedZaps = computed(() => this.allZaps().filter(zap => zap.type === 'received'));
  totalSent = computed(() => this.sentZaps().reduce((total, zap) => total + zap.amount, 0));
  totalReceived = computed(() => this.receivedZaps().reduce((total, zap) => total + zap.amount, 0));
  balance = computed(() => this.totalSent() - this.totalReceived());

  private lastLoadedPubkey = '';
  private loadingInProgress = false;

  constructor() {
    effect(() => {
      const contactPubkey = this.pubkey();
      if (contactPubkey && contactPubkey !== this.lastLoadedPubkey && !this.loadingInProgress) {
        this.lastLoadedPubkey = contactPubkey;
        this.loadAllData(contactPubkey);
      }
    });
  }

  private async loadAllData(contactPubkey: string): Promise<void> {
    if (this.loadingInProgress) return;
    this.loadingInProgress = true;

    // Load metadata first
    await this.loadMetadata(contactPubkey);

    // Load all sections in parallel
    await Promise.all([
      this.loadConnectionStats(contactPubkey),
      this.loadInteractions(contactPubkey),
      this.loadZapHistory(contactPubkey),
    ]);

    this.loadingInProgress = false;
  }

  private async loadMetadata(contactPubkey: string): Promise<void> {
    try {
      const metadataRecord = await this.userData.getEventByPubkeyAndKind(
        contactPubkey,
        kinds.Metadata,
        { cache: true, save: true }
      );
      if (metadataRecord) {
        this.metadata.set(metadataRecord);
      }
    } catch (error) {
      this.logger.error('Error loading metadata:', error);
    }
  }

  // ==================== OVERVIEW SECTION ====================

  private async loadConnectionStats(contactPubkey: string): Promise<void> {
    this.isLoadingOverview.set(true);
    try {
      const currentUserPubkey = this.accountState.pubkey();
      if (!currentUserPubkey) {
        this.isLoadingOverview.set(false);
        return;
      }

      const [ourInteractionsWithThem, theirInteractionsWithUs] = await Promise.all([
        this.getInteractionEvents(currentUserPubkey, contactPubkey),
        this.getInteractionEvents(contactPubkey, currentUserPubkey),
      ]);

      // Calculate statistics
      const ourLikes = ourInteractionsWithThem.filter(e => e.kind === kinds.Reaction).length;
      const theirLikes = theirInteractionsWithUs.filter(e => e.kind === kinds.Reaction).length;
      const ourReplies = ourInteractionsWithThem.filter(
        e => e.kind === kinds.ShortTextNote && e.tags.some(t => t[0] === 'e')
      ).length;
      const theirReplies = theirInteractionsWithUs.filter(
        e => e.kind === kinds.ShortTextNote && e.tags.some(t => t[0] === 'e')
      ).length;
      const ourReposts = ourInteractionsWithThem.filter(
        e => e.kind === kinds.Repost || e.kind === 16
      ).length;
      const theirReposts = theirInteractionsWithUs.filter(
        e => e.kind === kinds.Repost || e.kind === 16
      ).length;

      // Find first interaction
      const allInteractions = [...ourInteractionsWithThem, ...theirInteractionsWithUs];
      const sortedInteractions = allInteractions.sort((a, b) => a.created_at - b.created_at);
      const firstInteraction = sortedInteractions.length > 0 ? sortedInteractions[0].created_at : null;
      const daysSinceFirstInteraction = firstInteraction
        ? Math.floor((Date.now() / 1000 - firstInteraction) / 86400)
        : null;

      const totalInteractions = allInteractions.length;

      // Check following status
      const following = this.accountState.followingList();
      const isFollowing = following.includes(contactPubkey);

      // Check if they follow us
      let followsUs = false;
      try {
        const theirContactsRecord = await this.userData.getEventByPubkeyAndKind(
          contactPubkey,
          kinds.Contacts,
          { cache: true, save: true }
        );
        if (theirContactsRecord) {
          followsUs = theirContactsRecord.event.tags.some(
            (tag: string[]) => tag[0] === 'p' && tag[1] === currentUserPubkey
          );
        }
      } catch (error) {
        this.logger.warn('Could not check if contact follows us:', error);
      }

      this.stats.set({
        firstInteraction,
        daysSinceFirstInteraction,
        totalInteractions,
        ourLikes,
        theirLikes,
        ourReplies,
        theirReplies,
        ourReposts,
        theirReposts,
        isFollowing,
        followsUs,
      });
    } catch (error) {
      this.logger.error('Error loading connection stats:', error);
    } finally {
      this.isLoadingOverview.set(false);
    }
  }

  private async getInteractionEvents(authorPubkey: string, targetPubkey: string): Promise<Event[]> {
    try {
      const eventArrays = await Promise.all([
        this.userData.getEventsByPubkeyAndKind(authorPubkey, kinds.Reaction, { cache: true, save: true }),
        this.userData.getEventsByPubkeyAndKind(authorPubkey, kinds.ShortTextNote, { cache: true, save: true }),
        this.userData.getEventsByPubkeyAndKind(authorPubkey, kinds.Repost, { cache: true, save: true }),
        this.userData.getEventsByPubkeyAndKind(authorPubkey, 16, { cache: true, save: true }),
      ]);

      const authorEvents = eventArrays.flat().map(record => record.event);

      const interactions = authorEvents.filter((event: Event) => {
        const pTags = event.tags.filter((t: string[]) => t[0] === 'p');
        return pTags.some((t: string[]) => t[1] === targetPubkey);
      });

      return interactions;
    } catch (error) {
      this.logger.error('Error getting interaction events:', error);
      return [];
    }
  }

  getRelationshipStatus(): string {
    const stats = this.stats();
    if (stats.isFollowing && stats.followsUs) {
      return 'Mutual Connection';
    } else if (stats.isFollowing) {
      return 'Following';
    } else if (stats.followsUs) {
      return 'Follows You';
    }
    return 'No Connection';
  }

  getRelationshipIcon(): string {
    const stats = this.stats();
    if (stats.isFollowing && stats.followsUs) {
      return 'people';
    } else if (stats.isFollowing) {
      return 'person_add';
    } else if (stats.followsUs) {
      return 'person';
    }
    return 'person_outline';
  }

  // External identities parsing (NIP-39)
  private parseExternalIdentities(): ExternalIdentity[] {
    const metadataRecord = this.metadata();
    if (!metadataRecord) return [];

    const event = metadataRecord.event;
    if (!event.tags) return [];

    const identities: ExternalIdentity[] = [];
    const iTags = event.tags.filter(tag => tag[0] === 'i' && tag.length >= 2);

    for (const tag of iTags) {
      const platformIdentity = tag[1];
      const proof = tag[2] || '';

      const separatorIndex = platformIdentity.indexOf(':');
      if (separatorIndex === -1) continue;

      const platform = platformIdentity.substring(0, separatorIndex);
      const identity = platformIdentity.substring(separatorIndex + 1);

      const externalIdentity = this.buildExternalIdentity(platform, identity, proof);
      if (externalIdentity) {
        identities.push(externalIdentity);
      }
    }

    return identities;
  }

  private isUrl(str: string): boolean {
    return str.startsWith('http://') || str.startsWith('https://');
  }

  private buildProofUrl(proof: string, fallbackUrl: string): string | null {
    if (!proof) return null;
    return this.isUrl(proof) ? proof : fallbackUrl;
  }

  private buildExternalIdentity(
    platform: string,
    identity: string,
    proof: string
  ): ExternalIdentity | null {
    const platformLower = platform.toLowerCase();

    switch (platformLower) {
      case 'github':
        return {
          platform: 'GitHub',
          identity,
          proof,
          displayName: `@${identity}`,
          icon: 'code',
          profileUrl: `https://github.com/${identity}`,
          proofUrl: this.buildProofUrl(proof, `https://gist.github.com/${identity}/${proof}`),
          verified: !!proof,
        };

      case 'twitter':
      case 'x':
        return {
          platform: 'X (Twitter)',
          identity,
          proof,
          displayName: `@${identity}`,
          icon: 'alternate_email',
          profileUrl: `https://twitter.com/${identity}`,
          proofUrl: this.buildProofUrl(proof, `https://twitter.com/${identity}/status/${proof}`),
          verified: !!proof,
        };

      case 'mastodon': {
        const mastodonUrl = `https://${identity}`;
        return {
          platform: 'Mastodon',
          identity,
          proof,
          displayName: `@${identity.split('/@')[1] || identity}`,
          icon: 'rss_feed',
          profileUrl: mastodonUrl,
          proofUrl: this.buildProofUrl(proof, `${mastodonUrl}/${proof}`),
          verified: !!proof,
        };
      }

      case 'telegram':
        return {
          platform: 'Telegram',
          identity,
          proof,
          displayName: identity,
          icon: 'send',
          profileUrl: null,
          proofUrl: this.buildProofUrl(proof, `https://t.me/${proof}`),
          verified: !!proof,
        };

      case 'linkedin':
        return {
          platform: 'LinkedIn',
          identity,
          proof,
          displayName: identity,
          icon: 'business',
          profileUrl: `https://linkedin.com/in/${identity}`,
          proofUrl: null,
          verified: !!proof,
        };

      case 'facebook':
        return {
          platform: 'Facebook',
          identity,
          proof,
          displayName: identity,
          icon: 'people',
          profileUrl: `https://facebook.com/${identity}`,
          proofUrl: null,
          verified: !!proof,
        };

      case 'instagram':
        return {
          platform: 'Instagram',
          identity,
          proof,
          displayName: `@${identity}`,
          icon: 'photo_camera',
          profileUrl: `https://instagram.com/${identity}`,
          proofUrl: null,
          verified: !!proof,
        };

      case 'reddit':
        return {
          platform: 'Reddit',
          identity,
          proof,
          displayName: `u/${identity}`,
          icon: 'forum',
          profileUrl: `https://reddit.com/user/${identity}`,
          proofUrl: null,
          verified: !!proof,
        };

      default:
        return {
          platform: platform.charAt(0).toUpperCase() + platform.slice(1),
          identity,
          proof,
          displayName: identity,
          icon: 'link',
          profileUrl: null,
          proofUrl: this.isUrl(proof) ? proof : null,
          verified: !!proof,
        };
    }
  }

  copyToClipboard(text: string, label: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.logger.debug(`${label} copied to clipboard`),
      err => this.logger.error(`Failed to copy ${label}:`, err)
    );
  }

  getNpub(): string {
    return this.utilities.getNpubFromPubkey(this.pubkey()) || this.pubkey();
  }

  getAbout(): string {
    const metadataRecord = this.metadata();
    return (metadataRecord?.data?.about as string) || '';
  }

  getWebsite(): string | null {
    const metadataRecord = this.metadata();
    return (metadataRecord?.data?.website as string) || null;
  }

  getLud16(): string | null {
    const metadataRecord = this.metadata();
    return (metadataRecord?.data?.lud16 as string) || null;
  }

  getNip05(): string | null {
    const metadataRecord = this.metadata();
    return (metadataRecord?.data?.nip05 as string) || null;
  }

  // ==================== INTERACTIONS SECTION ====================

  private async loadInteractions(contactPubkey: string): Promise<void> {
    this.isLoadingInteractions.set(true);
    try {
      const currentUserPubkey = this.accountState.pubkey();
      if (!currentUserPubkey) {
        this.isLoadingInteractions.set(false);
        return;
      }

      const [ourInteractionsWithThem, theirInteractionsWithUs] = await Promise.all([
        this.getInteractionEvents(currentUserPubkey, contactPubkey),
        this.getInteractionEvents(contactPubkey, currentUserPubkey),
      ]);

      const allInteractions: Interaction[] = [];

      for (const event of ourInteractionsWithThem) {
        const interaction = this.createInteraction(event, 'given');
        if (interaction) {
          allInteractions.push(interaction);
        }
      }

      for (const event of theirInteractionsWithUs) {
        const interaction = this.createInteraction(event, 'received');
        if (interaction) {
          allInteractions.push(interaction);
        }
      }

      allInteractions.sort((a, b) => b.timestamp - a.timestamp);
      this.interactions.set(allInteractions);
    } catch (error) {
      this.logger.error('Error loading interactions:', error);
    } finally {
      this.isLoadingInteractions.set(false);
    }
  }

  private createInteraction(event: Event, direction: 'given' | 'received'): Interaction | null {
    let type: InteractionType;
    let description: string;
    let icon: string;
    let iconColor: string;

    if (event.kind === kinds.Reaction) {
      type = direction === 'given' ? 'like-given' : 'like-received';
      description = direction === 'given' ? 'You liked their post' : 'They liked your post';
      icon = 'favorite';
      iconColor = 'var(--mat-sys-error)';
    } else if (event.kind === kinds.ShortTextNote) {
      type = direction === 'given' ? 'reply-given' : 'reply-received';
      description = direction === 'given' ? 'You replied to their post' : 'They replied to your post';
      icon = 'reply';
      iconColor = 'var(--mat-sys-primary)';
    } else if (event.kind === kinds.Repost || event.kind === 16) {
      type = direction === 'given' ? 'repost-given' : 'repost-received';
      description = direction === 'given' ? 'You reposted their post' : 'They reposted your post';
      icon = 'repeat';
      iconColor = 'var(--mat-sys-tertiary)';
    } else {
      return null;
    }

    return {
      type,
      event,
      timestamp: event.created_at,
      description,
      icon,
      iconColor,
    };
  }

  getInteractionContent(interaction: Interaction): string {
    const event = interaction.event;

    if (interaction.type === 'reply-given' || interaction.type === 'reply-received') {
      const content = event.content.trim();
      if (content.length > 100) {
        return content.substring(0, 100) + '...';
      }
      return content;
    }

    if (interaction.type === 'like-given' || interaction.type === 'like-received') {
      const content = event.content;
      if (content === '+') return '\u{1F44D}';
      if (content === '-') return '\u{1F44E}';
      return content || '\u{1F44D}';
    }

    return '';
  }

  getCustomEmojiUrl(interaction: Interaction): string | null {
    const event = interaction.event;
    if (!event.content || !event.content.startsWith(':') || !event.content.endsWith(':')) {
      return null;
    }

    const shortcode = event.content.slice(1, -1);
    const emojiTag = event.tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);

    return emojiTag?.[2] || null;
  }

  navigateToEvent(interaction: Interaction): void {
    const eventTag = interaction.event.tags.find(t => t[0] === 'e');
    if (eventTag && eventTag[1]) {
      window.open(`/e/${eventTag[1]}`, '_blank');
    }
  }

  // ==================== MONETARY SECTION ====================

  private async loadZapHistory(contactPubkey: string): Promise<void> {
    const account = this.accountState.account();
    if (!account) {
      this.isLoadingZaps.set(false);
      return;
    }

    this.isLoadingZaps.set(true);

    try {
      const userPubkey = account.pubkey;

      const [allReceivedZapReceipts, allSentZapReceipts] = await Promise.all([
        this.zapService.getZapsForUser(userPubkey),
        this.zapService.getZapsSentByUser(userPubkey),
      ]);

      const zapHistory: ZapHistoryEntry[] = [];
      const processedReceiptIds = new Set<string>();

      // Process received zaps - filter for ones from the contact
      for (const receipt of allReceivedZapReceipts) {
        if (processedReceiptIds.has(receipt.id)) {
          continue;
        }

        const parsed = this.zapService.parseZapReceipt(receipt);

        if (parsed.zapRequest && parsed.amount) {
          if (parsed.zapRequest.pubkey === contactPubkey) {
            const eventTag = receipt.tags.find(tag => tag[0] === 'e');
            zapHistory.push({
              type: 'received',
              zapReceipt: receipt,
              zapRequest: parsed.zapRequest,
              amount: parsed.amount,
              comment: parsed.comment,
              counterparty: parsed.zapRequest.pubkey,
              timestamp: receipt.created_at,
              eventId: eventTag?.[1],
            });
            processedReceiptIds.add(receipt.id);
          }
        }
      }

      // Process sent zaps - filter for ones to the contact
      for (const receipt of allSentZapReceipts) {
        if (processedReceiptIds.has(receipt.id)) {
          continue;
        }

        const parsed = this.zapService.parseZapReceipt(receipt);
        if (parsed.zapRequest && parsed.amount) {
          const pTag = parsed.zapRequest.tags.find(t => t[0] === 'p');
          const recipient = pTag && pTag[1] ? pTag[1] : parsed.zapRequest.pubkey;

          if (recipient === contactPubkey) {
            const eventTag = receipt.tags.find(tag => tag[0] === 'e');
            zapHistory.push({
              type: 'sent',
              zapReceipt: receipt,
              zapRequest: parsed.zapRequest,
              amount: parsed.amount,
              comment: parsed.comment,
              counterparty: recipient,
              timestamp: receipt.created_at,
              eventId: eventTag?.[1],
            });
            processedReceiptIds.add(receipt.id);
          }
        }
      }

      zapHistory.sort((a, b) => b.timestamp - a.timestamp);
      this.allZaps.set(zapHistory);
    } catch (error) {
      this.logger.error('Failed to load zap history for contact:', error);
    } finally {
      this.isLoadingZaps.set(false);
    }
  }

  formatAmount(amount: number): string {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return amount.toLocaleString();
  }

  async copyEventData(zap: ZapHistoryEntry): Promise<void> {
    try {
      const eventData = JSON.stringify(zap.zapReceipt, null, 2);
      await navigator.clipboard.writeText(eventData);
      this.snackBar.open('Event data copied to clipboard', 'Dismiss', {
        duration: 3000,
      });
    } catch (error) {
      this.logger.error('Failed to copy event data:', error);
      this.snackBar.open('Failed to copy event data', 'Dismiss', {
        duration: 3000,
      });
    }
  }
}
