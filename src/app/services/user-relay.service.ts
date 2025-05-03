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

    /**
 * Generic function to subscribe to Nostr events
 * @param filters Array of filter objects for the subscription
 * @param onEvent Callback function that will be called for each event received
 * @param onEose Callback function that will be called when EOSE (End Of Stored Events) is received
 * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
 * @returns Subscription object with unsubscribe method
 */
    subscribe<T extends Event = Event>(
        filters: { kinds?: number[], authors?: string[], '#e'?: string[], '#p'?: string[], since?: number, until?: number, limit?: number }[],
        onEvent: (event: T) => void,
        onEose?: () => void,
        relayUrls?: string[]
    ) {
        this.logger.debug('Creating subscription with filters:', filters);

        if (!this.pool) {
            this.logger.error('Cannot subscribe: account pool is not initialized');
            return {
                unsubscribe: () => {
                    this.logger.debug('No subscription to unsubscribe from');
                }
            };
        }

        // Use provided relay URLs or default to the user's relays
        if (this.relayUrls.length === 0) {
            this.logger.warn('No relays available for subscription');
            return {
                unsubscribe: () => {
                    this.logger.debug('No subscription to unsubscribe from (no relays)');
                }
            };
        }

        try {
            // Create the subscription
            const sub = this.pool.subscribeMany(this.relayUrls, filters, {
                onevent: (evt) => {
                    this.logger.debug(`Received event of kind ${evt.kind}`);

                    // Update the lastUsed timestamp for this relay
                    // this.updateRelayLastUsed(relay);

                    // Call the provided event handler
                    onEvent(evt as T);

                    // console.log('Event received', evt);

                    // if (evt.kind === kinds.Contacts) {
                    //   const followingList = this.storage.getPTagsValues(evt);
                    //   console.log(followingList);
                    // this.followingList.set(followingList);
                    // this.profileState.followingList.set(followingList);

                    // this.storage.saveEvent(evt);

                    // Now you can use 'this' here
                    // For example: this.handleContacts(evt);
                    // }
                },
                onclose: (reasons) => {
                    console.log('Pool closed', reasons);
                    // Also changed this to an arrow function for consistency
                },
                oneose: () => {
                    if (onEose) {
                        this.logger.debug('End of stored events reached');
                        onEose();
                    }
                },
            });

            // Return an object with close method
            return {
                close: () => {
                    this.logger.debug('Close from events');
                    sub.close();
                }
            };
        } catch (error) {
            this.logger.error('Error creating subscription', error);
            return {
                close: () => {
                    this.logger.debug('Error subscription close called');
                }
            };
        }
    }

    // async getEventByPubkeyAndKindAndTag(pubkey: string | string[], kind: number, tag: string[]): Promise<NostrEvent | null> {
    //     return this.get({
    //         "#d": pubkey,
    //         kinds: [kind]
    //     });
    // }
}


