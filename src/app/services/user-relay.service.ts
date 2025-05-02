import { Injectable, inject, signal, computed, effect, untracked } from '@angular/core';
import { LoggerService } from './logger.service';
import { StorageService, Nip11Info, NostrEventData, UserMetadata } from './storage.service';
import { Event, kinds, SimplePool } from 'nostr-tools';
import { NostrEvent } from '../interfaces';
import { ApplicationStateService } from './application-state.service';
import { NotificationService } from './notification.service';
import { LocalStorageService } from './local-storage.service';
import { NostrService } from './nostr.service';
import { RelayService } from './relay.service';

export interface Relay {
    url: string;
    status?: 'connected' | 'disconnected' | 'connecting' | 'error';
    lastUsed?: number;
    timeout?: number;
}

@Injectable()
export class UserRelayService {
    private logger = inject(LoggerService);
    private storage = inject(StorageService);
    private nostr = inject(NostrService);
    private appState = inject(ApplicationStateService);
    private notification = inject(NotificationService);
    private localStorage = inject(LocalStorageService);
    private pool = new SimplePool();
    private relay = inject(RelayService);

    constructor() {

    }

    config: any = {};
    relayUrls: string[] = [];

    /** Initialize is called to discover the user's relay list. */
    async initialize(pubkey: string, config?: { customConfig?: any, customRelays?: string[] }) {
        this.relayUrls = await this.nostr.getRelays(pubkey);
    }

    async getEventByPubkeyAndKindAndTag(pubkey: string, kind: number, tag: { key: string, value: string }): Promise<NostrEvent | null> {
        const authors = Array.isArray(pubkey) ? pubkey : [pubkey];

        return this.get({
            authors,
            [`#${tag.key}`]: [tag.value],
            kinds: [kind]
        });
    }

    /**
  * Generic function to fetch Nostr events (one-time query)
  * @param filter Filter for the query
  * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
  * @param options Optional options for the query
  * @returns Promise that resolves to an array of events
  */
    async get<T extends Event = Event>(
        filter: { kinds?: number[], authors?: string[], '#e'?: string[], '#p'?: string[], since?: number, until?: number, limit?: number },
        relayUrls?: string[],
        options: { timeout?: number } = {}
    ): Promise<T | null> {
        this.logger.debug('Getting events with filters:', filter);

        if (!this.pool) {
            this.logger.error('Cannot get events: user pool is not initialized');
            return null;
        }

        try {
            // Default timeout is 5 seconds if not specified
            const timeout = options.timeout || 5000;

            // Execute the query
            const event = await this.pool.get(this.relayUrls, filter, { maxWait: timeout }) as T;

            this.logger.debug(`Received event from query`, event);

            return event;
        } catch (error) {
            this.logger.error('Error fetching events', error);
            return null;
        }
    }

    // async getEventByPubkeyAndKindAndTag(pubkey: string | string[], kind: number, tag: string[]): Promise<NostrEvent | null> {
    //     return this.get({
    //         "#d": pubkey,
    //         kinds: [kind]
    //     });
    // }
}


