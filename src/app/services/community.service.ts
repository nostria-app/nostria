import { Injectable, inject, signal } from '@angular/core';
import { Event, Filter, UnsignedEvent } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { RelayPoolService } from './relays/relay-pool';
import { AccountRelayService } from './relays/account-relay';
import { UtilitiesService } from './utilities.service';
import { NostrService } from './nostr.service';
import { AccountStateService } from './account-state.service';
import { ReportingService } from './reporting.service';
import { DatabaseService } from './database.service';

/**
 * NIP-72 Community kinds
 */
export const COMMUNITY_DEFINITION_KIND = 34550;
export const COMMUNITY_APPROVAL_KIND = 4550;
export const COMMUNITY_POST_KIND = 1111;

/**
 * Parsed community definition from a kind 34550 event
 */
export interface Community {
  /** The raw Nostr event */
  event: Event;
  /** The d-tag identifier */
  id: string;
  /** Display name (from 'name' tag or d-tag) */
  name: string;
  /** Community description */
  description: string;
  /** Community banner image URL (first image tag) */
  image: string;
  /** Banner image dimensions (e.g., '1024x768') */
  imageDimensions: string;
  /** Community avatar image URL (second image tag) */
  avatar: string;
  /** Avatar image dimensions */
  avatarDimensions: string;
  /** Community moderator pubkeys */
  moderators: { pubkey: string; relay?: string }[];
  /** Community relays with optional markers */
  relays: { url: string; marker?: string }[];
  /** The community author/creator pubkey */
  creatorPubkey: string;
  /** The 'a' tag coordinate for this community: 34550:<pubkey>:<d-tag> */
  coordinate: string;
  /** Additional tags from the event */
  rules: string;
}

/**
 * A post within a community (kind 1111 or legacy kind 1)
 */
export interface CommunityPost {
  event: Event;
  /** Whether the post is approved by at least one moderator */
  approved: boolean;
  /** The approval events for this post */
  approvals: Event[];
  /** Whether this is a top-level post (vs a reply) */
  isTopLevel: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class CommunityService {
  private readonly logger = inject(LoggerService);
  private readonly pool = inject(RelayPoolService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly utilities = inject(UtilitiesService);
  private readonly nostrService = inject(NostrService);
  private readonly accountState = inject(AccountStateService);
  private readonly reporting = inject(ReportingService);
  private readonly database = inject(DatabaseService);

  /**
   * Parse a kind 34550 event into a Community object
   */
  parseCommunity(event: Event): Community {
    const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
    const name = event.tags.find(t => t[0] === 'name')?.[1] || dTag;
    const description = event.tags.find(t => t[0] === 'description')?.[1] || '';
    const imageTags = event.tags.filter(t => t[0] === 'image');
    const bannerTag = imageTags[0];
    const avatarTag = imageTags[1];
    const image = bannerTag?.[1] || '';
    const imageDimensions = bannerTag?.[2] || '';
    const avatar = avatarTag?.[1] || '';
    const avatarDimensions = avatarTag?.[2] || '';
    const rules = event.tags.find(t => t[0] === 'rules')?.[1] || '';

    const moderators = event.tags
      .filter(t => t[0] === 'p' && t[3] === 'moderator')
      .map(t => ({ pubkey: t[1], relay: t[2] || undefined }));

    const relays = event.tags
      .filter(t => t[0] === 'relay')
      .map(t => ({ url: t[1], marker: t[2] || undefined }));

    return {
      event,
      id: dTag,
      name,
      description,
      image,
      imageDimensions,
      avatar,
      avatarDimensions,
      moderators,
      relays,
      creatorPubkey: event.pubkey,
      coordinate: `${COMMUNITY_DEFINITION_KIND}:${event.pubkey}:${dTag}`,
      rules,
    };
  }

  /**
   * Get relay URLs for fetching communities.
   * Combines account relays with anonymous relays as fallback.
   */
  private getRelayUrls(): string[] {
    const accountRelays = this.accountRelay.getRelayUrls();
    if (accountRelays.length > 0) {
      return accountRelays;
    }
    return this.utilities.anonymousRelays;
  }

  /**
   * Subscribe to community definitions (kind 34550).
   * Returns a subscription handle that can be closed.
   */
  subscribeCommunities(
    onEvent: (community: Community) => void,
    options?: { authors?: string[]; limit?: number }
  ): { close: () => void } {
    const relayUrls = this.getRelayUrls();

    const filter: Filter = {
      kinds: [COMMUNITY_DEFINITION_KIND],
      limit: options?.limit || 100,
    };

    if (options?.authors) {
      filter.authors = options.authors;
    }

    return this.pool.subscribe(relayUrls, filter, (event: Event) => {
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      const community = this.parseCommunity(event);
      onEvent(community);
    });
  }

  /**
   * Fetch communities from relays (one-shot query).
   */
  async fetchCommunities(options?: { authors?: string[]; limit?: number }): Promise<Community[]> {
    const relayUrls = this.getRelayUrls();

    const filter: Filter = {
      kinds: [COMMUNITY_DEFINITION_KIND],
      limit: options?.limit || 100,
    };

    if (options?.authors) {
      filter.authors = options.authors;
    }

    const events = await this.pool.query(relayUrls, filter);
    return events
      .filter(e => !this.reporting.isUserBlocked(e.pubkey))
      .map(e => this.parseCommunity(e));
  }

  /**
   * Fetch a single community by its coordinate (34550:<pubkey>:<d-tag>).
   * Optionally provide relay hints to try first.
   */
  async fetchCommunity(pubkey: string, dTag: string, relayHints?: string[]): Promise<Community | null> {
    const filter: Filter = {
      kinds: [COMMUNITY_DEFINITION_KIND],
      authors: [pubkey],
      '#d': [dTag],
      limit: 1,
    };

    // Try relay hints first if provided
    if (relayHints && relayHints.length > 0) {
      const hintEvents = await this.pool.query(relayHints, filter, 4000);
      if (hintEvents.length > 0) {
        const latest = hintEvents.reduce((a, b) => a.created_at > b.created_at ? a : b);
        return this.parseCommunity(latest);
      }
    }

    // Fallback to account/anonymous relays
    const relayUrls = this.getRelayUrls();
    const events = await this.pool.query(relayUrls, filter, 8000);
    if (events.length === 0) return null;

    // Get the latest version
    const latest = events.reduce((a, b) => a.created_at > b.created_at ? a : b);
    return this.parseCommunity(latest);
  }

  /**
   * Subscribe to posts in a community (kind 1111 with 'A' tag, and legacy kind 1 with 'a' tag).
   */
  subscribeCommunityPosts(
    communityCoordinate: string,
    onEvent: (event: Event) => void,
    options?: { limit?: number }
  ): { close: () => void } {
    const relayUrls = this.getRelayUrls();

    // Query for kind 1111 (NIP-22 comments) with 'A' tag pointing to community
    const filter1111: Filter = {
      kinds: [COMMUNITY_POST_KIND],
      '#A': [communityCoordinate],
      limit: options?.limit || 100,
    };

    // Also query for legacy kind 1 with 'a' tag
    const filter1: Filter = {
      kinds: [1],
      '#a': [communityCoordinate],
      limit: options?.limit || 50,
    };

    const subs: { close: () => void }[] = [];

    subs.push(this.pool.subscribe(relayUrls, filter1111, (event: Event) => {
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      if (this.reporting.isContentBlocked(event)) return;
      onEvent(event);
    }));

    subs.push(this.pool.subscribe(relayUrls, filter1, (event: Event) => {
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      if (this.reporting.isContentBlocked(event)) return;
      onEvent(event);
    }));

    return {
      close: () => subs.forEach(s => s.close()),
    };
  }

  /**
   * Subscribe to approval events (kind 4550) for a community.
   */
  subscribeCommunityApprovals(
    communityCoordinate: string,
    onEvent: (event: Event) => void,
    options?: { limit?: number }
  ): { close: () => void } {
    const relayUrls = this.getRelayUrls();

    const filter: Filter = {
      kinds: [COMMUNITY_APPROVAL_KIND],
      '#a': [communityCoordinate],
      limit: options?.limit || 200,
    };

    return this.pool.subscribe(relayUrls, filter, (event: Event) => {
      onEvent(event);
    });
  }

  /**
   * Check if a post is approved by a moderator of the community.
   */
  isApprovedByModerator(
    approvals: Event[],
    moderators: { pubkey: string }[],
    postId: string
  ): boolean {
    const moderatorPubkeys = new Set(moderators.map(m => m.pubkey));
    return approvals.some(approval => {
      if (!moderatorPubkeys.has(approval.pubkey)) return false;
      const eTag = approval.tags.find(t => t[0] === 'e' && t[1] === postId);
      return !!eTag;
    });
  }

  /**
   * Create a community definition event (kind 34550).
   */
  createCommunityEvent(params: {
    dTag: string;
    name: string;
    description?: string;
    image?: string;
    imageDimensions?: string;
    avatar?: string;
    avatarDimensions?: string;
    rules?: string;
    moderators?: { pubkey: string; relay?: string }[];
    relays?: { url: string; marker?: string }[];
  }): UnsignedEvent {
    const tags: string[][] = [
      ['d', params.dTag],
    ];

    if (params.name) {
      tags.push(['name', params.name]);
    }
    if (params.description) {
      tags.push(['description', params.description]);
    }
    // First image tag = banner
    if (params.image) {
      const imageTag = ['image', params.image];
      if (params.imageDimensions) {
        imageTag.push(params.imageDimensions);
      }
      tags.push(imageTag);
    }
    // Second image tag = avatar
    if (params.avatar) {
      const avatarTag = ['image', params.avatar];
      if (params.avatarDimensions) {
        avatarTag.push(params.avatarDimensions);
      }
      tags.push(avatarTag);
    }
    if (params.rules) {
      tags.push(['rules', params.rules]);
    }
    if (params.moderators) {
      for (const mod of params.moderators) {
        const pTag = ['p', mod.pubkey];
        if (mod.relay) pTag.push(mod.relay);
        else pTag.push('');
        pTag.push('moderator');
        tags.push(pTag);
      }
    }
    if (params.relays) {
      for (const relay of params.relays) {
        const relayTag = ['relay', relay.url];
        if (relay.marker) relayTag.push(relay.marker);
        tags.push(relayTag);
      }
    }

    return this.nostrService.createEvent(COMMUNITY_DEFINITION_KIND, '', tags);
  }

  /**
   * Create a top-level post in a community (kind 1111 per NIP-22).
   * Supports title (subject tag), URL tags for media/links, and link posts.
   */
  createCommunityPost(
    communityCoordinate: string,
    communityPubkey: string,
    content: string,
    options?: {
      relayHint?: string;
      title?: string;
      urls?: string[];
      link?: string;
    },
  ): UnsignedEvent {
    const relayHint = options?.relayHint || '';
    const tags: string[][] = [
      ['A', communityCoordinate, relayHint],
      ['a', communityCoordinate, relayHint],
      ['P', communityPubkey, relayHint],
      ['p', communityPubkey, relayHint],
      ['K', String(COMMUNITY_DEFINITION_KIND)],
      ['k', String(COMMUNITY_DEFINITION_KIND)],
    ];

    if (options?.title) {
      tags.push(['subject', options.title]);
    }

    if (options?.urls) {
      for (const url of options.urls) {
        tags.push(['url', url]);
      }
    }

    if (options?.link) {
      tags.push(['r', options.link]);
    }

    return this.nostrService.createEvent(COMMUNITY_POST_KIND, content, tags);
  }

  /**
   * Create a reply to a post in a community (kind 1111 per NIP-22).
   */
  createCommunityReply(
    communityCoordinate: string,
    communityPubkey: string,
    parentEventId: string,
    parentAuthorPubkey: string,
    parentEventKind: number,
    content: string,
    relayHint?: string,
  ): UnsignedEvent {
    const tags: string[][] = [
      // Community scope (uppercase)
      ['A', communityCoordinate, relayHint || ''],
      ['P', communityPubkey, relayHint || ''],
      ['K', String(COMMUNITY_DEFINITION_KIND)],
      // Parent post (lowercase)
      ['e', parentEventId, relayHint || ''],
      ['p', parentAuthorPubkey, relayHint || ''],
      ['k', String(parentEventKind)],
    ];

    return this.nostrService.createEvent(COMMUNITY_POST_KIND, content, tags);
  }

  /**
   * Create an approval event (kind 4550) for a post in a community.
   */
  createApprovalEvent(
    communityCoordinate: string,
    postEvent: Event,
    relayHint?: string,
  ): UnsignedEvent {
    const tags: string[][] = [
      ['a', communityCoordinate, relayHint || ''],
      ['e', postEvent.id, relayHint || ''],
      ['p', postEvent.pubkey, relayHint || ''],
      ['k', String(postEvent.kind)],
    ];

    // Include the full post event JSON in the content
    const content = JSON.stringify(postEvent);

    return this.nostrService.createEvent(COMMUNITY_APPROVAL_KIND, content, tags);
  }

  /**
   * Sign and publish a community definition.
   */
  async publishCommunity(params: {
    dTag: string;
    name: string;
    description?: string;
    image?: string;
    imageDimensions?: string;
    avatar?: string;
    avatarDimensions?: string;
    rules?: string;
    moderators?: { pubkey: string; relay?: string }[];
    relays?: { url: string; marker?: string }[];
  }): Promise<{ success: boolean; event?: Event; error?: string }> {
    const unsignedEvent = this.createCommunityEvent(params);
    return this.nostrService.signAndPublish(unsignedEvent);
  }

  /**
   * Sign and publish a community post.
   */
  async publishCommunityPost(
    communityCoordinate: string,
    communityPubkey: string,
    content: string,
    options?: {
      relayHint?: string;
      title?: string;
      urls?: string[];
      link?: string;
    },
  ): Promise<{ success: boolean; event?: Event; error?: string }> {
    const unsignedEvent = this.createCommunityPost(
      communityCoordinate,
      communityPubkey,
      content,
      options,
    );
    return this.nostrService.signAndPublish(unsignedEvent);
  }

  /**
   * Sign and publish an approval for a community post.
   */
  async publishApproval(
    communityCoordinate: string,
    postEvent: Event,
    relayHint?: string,
  ): Promise<{ success: boolean; event?: Event; error?: string }> {
    const unsignedEvent = this.createApprovalEvent(
      communityCoordinate,
      postEvent,
      relayHint,
    );
    return this.nostrService.signAndPublish(unsignedEvent);
  }
}
