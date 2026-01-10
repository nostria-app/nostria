import { Component, inject, signal, input, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NostrRecord } from '../../../../interfaces';
import { UserDataService } from '../../../../services/user-data.service';
import { AccountStateService } from '../../../../services/account-state.service';
import { LoggerService } from '../../../../services/logger.service';
import { UtilitiesService } from '../../../../services/utilities.service';
import { Event, kinds } from 'nostr-tools';

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

@Component({
  selector: 'app-contact-overview',
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatListModule,
    MatTooltipModule,
  ],
  templateUrl: './contact-overview.component.html',
  styleUrl: './contact-overview.component.scss',
})
export class ContactOverviewComponent {
  pubkey = input.required<string>();
  metadata = input.required<NostrRecord>();

  private userData = inject(UserDataService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private utilities = inject(UtilitiesService);

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

  isLoading = signal<boolean>(true);

  externalIdentities = computed(() => this.parseExternalIdentities());

  private lastLoadedPubkey = '';
  private loadingInProgress = false;

  constructor() {
    effect(() => {
      const pubkey = this.pubkey();
      if (pubkey && pubkey !== this.lastLoadedPubkey && !this.loadingInProgress) {
        this.lastLoadedPubkey = pubkey;
        this.loadConnectionStats(pubkey);
      }
    });
  }

  private async loadConnectionStats(contactPubkey: string): Promise<void> {
    if (this.loadingInProgress) return;

    this.loadingInProgress = true;
    this.isLoading.set(true);
    try {
      const currentUserPubkey = this.accountState.pubkey();
      if (!currentUserPubkey) {
        this.isLoading.set(false);
        this.loadingInProgress = false;
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
      this.isLoading.set(false);
      this.loadingInProgress = false;
    }
  }

  private async getInteractionEvents(authorPubkey: string, targetPubkey: string): Promise<Event[]> {
    try {
      // Get all events by the author for each kind separately
      const eventArrays = await Promise.all([
        this.userData.getEventsByPubkeyAndKind(authorPubkey, kinds.Reaction, { cache: true, save: true }),
        this.userData.getEventsByPubkeyAndKind(authorPubkey, kinds.ShortTextNote, { cache: true, save: true }),
        this.userData.getEventsByPubkeyAndKind(authorPubkey, kinds.Repost, { cache: true, save: true }),
        this.userData.getEventsByPubkeyAndKind(authorPubkey, 16, { cache: true, save: true }), // Generic repost
      ]);

      // Flatten and extract events from NostrRecord
      const authorEvents = eventArrays.flat().map(record => record.event);

      // Filter for interactions with the target user
      const interactions = authorEvents.filter((event: Event) => {
        // Check if the event references the target pubkey
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

  // Contact info methods (merged from ContactInfoComponent)
  private parseExternalIdentities(): ExternalIdentity[] {
    const metadata = this.metadata();
    const event = metadata.event;

    if (!event.tags) return [];

    const identities: ExternalIdentity[] = [];

    // Find all 'i' tags (NIP-39)
    const iTags = event.tags.filter(tag => tag[0] === 'i' && tag.length >= 2);

    for (const tag of iTags) {
      const platformIdentity = tag[1];
      const proof = tag[2] || '';

      // Split platform:identity
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
        // Identity format: instance/@username
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
    const metadata = this.metadata();
    return (metadata.data.about as string) || '';
  }

  getWebsite(): string | null {
    const metadata = this.metadata();
    return (metadata.data.website as string) || null;
  }

  getLud16(): string | null {
    const metadata = this.metadata();
    return (metadata.data.lud16 as string) || null;
  }

  getNip05(): string | null {
    const metadata = this.metadata();
    return (metadata.data.nip05 as string) || null;
  }
}
