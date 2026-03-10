import { Injectable, inject, signal, effect } from '@angular/core';
import { NostrService } from './nostr.service';
import { AccountStateService } from './account-state.service';
import { UserDataService } from './user-data.service';
import { LoggerService } from './logger.service';
import { ApplicationService } from './application.service';
import { RelayPoolService } from './relays/relay-pool';
import { AccountRelayService } from './relays/account-relay';
import { nip19 } from 'nostr-tools';
import type { Event as NostrEvent } from 'nostr-tools';

export interface UserStatus {
  content: string;
  type: 'general' | 'music';
  url?: string;
  aTag?: string;
  expiration?: number;
  createdAt: number;
}

const USER_STATUS_KIND = 30315;

@Injectable({
  providedIn: 'root',
})
export class UserStatusService {
  private nostr = inject(NostrService);
  private accountState = inject(AccountStateService);
  private userDataService = inject(UserDataService);
  private logger = inject(LoggerService);
  private app = inject(ApplicationService);
  private relayPool = inject(RelayPoolService);
  private accountRelay = inject(AccountRelayService);

  /** The logged-in user's own general status */
  ownGeneralStatus = signal<UserStatus | null>(null);

  /** The logged-in user's own music status */
  ownMusicStatus = signal<UserStatus | null>(null);

  /** Cache of fetched user statuses keyed by pubkey */
  private statusCache = new Map<string, { general: UserStatus | null; music: UserStatus | null; fetchedAt: number }>();

  private readonly CACHE_TTL_MS = 60_000; // 1 minute cache

  constructor() {
    if (!this.app.isBrowser()) {
      return;
    }

    // Load own statuses when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.loadOwnStatuses();
      }
    });
  }

  /**
   * Publish a general status for the current user.
   * Pass empty content to clear the status.
   */
  async setGeneralStatus(content: string, url?: string): Promise<boolean> {
    const tags: string[][] = [['d', 'general']];

    if (url) {
      tags.push(['r', url]);
    }

    const event = this.nostr.createEvent(USER_STATUS_KIND, content, tags);
    const result = await this.nostr.signAndPublish(event);

    if (result.success) {
      const nextGeneralStatus = content
        ? { content, type: 'general' as const, url, createdAt: event.created_at }
        : null;
      this.ownGeneralStatus.set(
        nextGeneralStatus,
      );
      this.updateOwnStatusCache({ general: nextGeneralStatus });
      this.logger.info('[UserStatus] General status published');
    } else {
      this.logger.error('[UserStatus] Failed to publish general status', result.error);
    }

    return result.success;
  }

  /**
   * Publish a music status for the current user with expiration.
   * @param trackTitle - Display text (e.g. "Track Name - Artist")
   * @param durationSeconds - Track duration in seconds (used to set expiration)
   * @param trackInfo - Optional track event info for linking
   */
  async setMusicStatus(trackTitle: string, durationSeconds: number, trackInfo?: { eventPubkey: string; eventIdentifier: string }): Promise<boolean> {
    const expirationTimestamp = Math.floor(Date.now() / 1000) + Math.ceil(durationSeconds);

    const tags: string[][] = [
      ['d', 'music'],
      ['expiration', String(expirationTimestamp)],
    ];

    if (trackInfo?.eventPubkey && trackInfo?.eventIdentifier) {
      // Add "a" tag referencing the music track event
      const aTagValue = `36787:${trackInfo.eventPubkey}:${trackInfo.eventIdentifier}`;
      tags.push(['a', aTagValue]);

      // Generate naddr URL for the "r" tag
      try {
        const relayUrls = this.accountRelay.getRelayUrls().slice(0, 3);
        const naddrEncoded = nip19.naddrEncode({
          kind: 36787,
          pubkey: trackInfo.eventPubkey,
          identifier: trackInfo.eventIdentifier,
          relays: relayUrls,
        });
        tags.push(['r', `https://nostria.app/a/${naddrEncoded}`]);
      } catch (err) {
        this.logger.warn('[UserStatus] Failed to encode naddr for music status', err);
      }
    }

    const event = this.nostr.createEvent(USER_STATUS_KIND, trackTitle, tags);
    const result = await this.nostr.signAndPublish(event);

    if (result.success) {
      const aTag = trackInfo?.eventPubkey && trackInfo?.eventIdentifier
        ? `36787:${trackInfo.eventPubkey}:${trackInfo.eventIdentifier}`
        : undefined;
      const nextMusicStatus: UserStatus = {
        content: trackTitle,
        type: 'music',
        url: tags.find(t => t[0] === 'r')?.[1],
        aTag,
        expiration: expirationTimestamp,
        createdAt: event.created_at,
      };
      this.ownMusicStatus.set(nextMusicStatus);
      this.updateOwnStatusCache({ music: nextMusicStatus });
      this.logger.info('[UserStatus] Music status published');
    } else {
      this.logger.error('[UserStatus] Failed to publish music status', result.error);
    }

    return result.success;
  }

  /**
   * Clear the music status (publish empty content).
   */
  async clearMusicStatus(): Promise<boolean> {
    const tags: string[][] = [['d', 'music']];
    const event = this.nostr.createEvent(USER_STATUS_KIND, '', tags);
    const result = await this.nostr.signAndPublish(event);

    if (result.success) {
      this.ownMusicStatus.set(null);
      this.updateOwnStatusCache({ music: null });
    }

    return result.success;
  }

  /**
   * Clear the general status (publish empty content).
   */
  async clearGeneralStatus(): Promise<boolean> {
    return this.setGeneralStatus('');
  }

  /**
   * Fetch user statuses for a given pubkey.
   * Uses a short TTL cache to avoid excessive relay queries.
   */
  async getUserStatuses(pubkey: string): Promise<{ general: UserStatus | null; music: UserStatus | null }> {
    const now = Date.now();
    const cached = this.statusCache.get(pubkey);

    if (cached && now - cached.fetchedAt < this.CACHE_TTL_MS) {
      return { general: cached.general, music: cached.music };
    }

    let general: UserStatus | null = null;
    let music: UserStatus | null = null;

    try {
      // Fetch general status
      const generalRecord = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
        pubkey,
        USER_STATUS_KIND,
        'general',
        { cache: true },
      );

      if (generalRecord?.event) {
        general = this.parseStatusEvent(generalRecord.event as NostrEvent);
      }
    } catch (error) {
      this.logger.warn('[UserStatus] Failed to fetch general status for', pubkey, error);
    }

    try {
      // Fetch music status
      const musicRecord = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
        pubkey,
        USER_STATUS_KIND,
        'music',
        { cache: true },
      );

      if (musicRecord?.event) {
        music = this.parseStatusEvent(musicRecord.event as NostrEvent);
      }
    } catch (error) {
      this.logger.warn('[UserStatus] Failed to fetch music status for', pubkey, error);
    }

    const result = { general, music, fetchedAt: now };
    this.statusCache.set(pubkey, result);

    return { general: result.general, music: result.music };
  }

  /**
   * Parse a NIP-38 status event into a UserStatus object.
   * Returns null if the status is expired or empty.
   */
  private parseStatusEvent(event: NostrEvent): UserStatus | null {
    if (!event.content || event.content.trim() === '') {
      return null;
    }

    const dTag = event.tags.find(t => t[0] === 'd')?.[1];
    const type = dTag === 'music' ? 'music' : 'general';
    const url = event.tags.find(t => t[0] === 'r')?.[1];
    const aTag = event.tags.find(t => t[0] === 'a')?.[1];
    const expirationStr = event.tags.find(t => t[0] === 'expiration')?.[1];
    const expiration = expirationStr ? parseInt(expirationStr, 10) : undefined;

    // Check if expired
    if (expiration && expiration < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      content: event.content,
      type,
      url,
      aTag,
      expiration,
      createdAt: event.created_at,
    };
  }

  /**
   * Load the current user's own statuses from relays.
   */
  private async loadOwnStatuses(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      const statuses = await this.getUserStatuses(pubkey);
      this.ownGeneralStatus.set(statuses.general);
      this.ownMusicStatus.set(statuses.music);
    } catch (error) {
      this.logger.warn('[UserStatus] Failed to load own statuses', error);
    }
  }

  /**
   * Invalidate cache for a given pubkey (force re-fetch next time).
   */
  invalidateCache(pubkey: string): void {
    this.statusCache.delete(pubkey);
  }

  private updateOwnStatusCache(updates: { general?: UserStatus | null; music?: UserStatus | null }): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return;
    }

    const cached = this.statusCache.get(pubkey);
    this.statusCache.set(pubkey, {
      general: updates.general !== undefined ? updates.general : (cached?.general ?? this.ownGeneralStatus()),
      music: updates.music !== undefined ? updates.music : (cached?.music ?? this.ownMusicStatus()),
      fetchedAt: Date.now(),
    });
  }

  /**
   * Subscribe to live NIP-38 status updates for a given pubkey.
   * Returns a cleanup function that closes the subscription.
   * The callback fires whenever a new status event is received.
   */
  subscribeToUserStatuses(
    pubkey: string,
    onUpdate: (statuses: { general: UserStatus | null; music: UserStatus | null }) => void,
  ): () => void {
    const relayUrls = this.accountRelay.getRelayUrls();
    if (relayUrls.length === 0) {
      this.logger.warn('[UserStatus] No relay URLs available for status subscription');
      return () => { };
    }

    // Track the latest status events so we can resolve updates correctly
    let latestGeneral: NostrEvent | null = null;
    let latestMusic: NostrEvent | null = null;

    const filter = {
      kinds: [USER_STATUS_KIND],
      authors: [pubkey],
      '#d': ['general', 'music'],
      since: Math.floor(Date.now() / 1000),
    };

    const subscription = this.relayPool.subscribe(relayUrls, filter, (event: NostrEvent) => {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];

      if (dTag === 'general') {
        if (!latestGeneral || event.created_at > latestGeneral.created_at) {
          latestGeneral = event;
        }
      } else if (dTag === 'music') {
        if (!latestMusic || event.created_at > latestMusic.created_at) {
          latestMusic = event;
        }
      }

      const general = latestGeneral ? this.parseStatusEvent(latestGeneral) : null;
      const music = latestMusic ? this.parseStatusEvent(latestMusic) : null;

      // Update cache
      this.statusCache.set(pubkey, { general, music, fetchedAt: Date.now() });

      onUpdate({ general, music });
    });

    this.logger.debug('[UserStatus] Subscribed to live status updates', { pubkey });

    return () => {
      subscription.close();
      this.logger.debug('[UserStatus] Unsubscribed from live status updates', { pubkey });
    };
  }
}
