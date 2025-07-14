import { Injectable, inject, signal, computed, effect, untracked } from '@angular/core';
import { LoggerService } from './logger.service';
import { Event, kinds, SimplePool } from 'nostr-tools';
// import { ApplicationStateService } from './application-state.service';
// import { NotificationService } from './notification.service';
// import { LocalStorageService } from './local-storage.service';
// import { NostrService } from './nostr.service';
import { RelayService } from './relay.service';

export interface Relay {
    url: string;
    status?: 'connected' | 'disconnected' | 'connecting' | 'error';
    lastUsed?: number;
    timeout?: number;
}

@Injectable({
    providedIn: 'root'
})
export class AccountRelayService {
    private logger = inject(LoggerService);
    // private nostr = inject(NostrService);
    // private appState = inject(ApplicationStateService);
    // private notification = inject(NotificationService);
    // private localStorage = inject(LocalStorageService);
    private relay = inject(RelayService);
    userRelaysFound = signal<boolean>(true);
    pool = new SimplePool();

    // Signal to store the relays for the current user (account relays)
    // private relays = signal<Relay[]>([]);
    // relays: Relay[] = [];

    // relaysChanged = signal<Relay[]>([]);

    // /** Holds the metadata event for all accounts in the app. */
    // // accountsMetadata = signal<NostrRecord[]>([]);

    // accountRelays = computed(() => {
    //     return this.relaysChanged();
    // });

    // accountRelayUrls = computed(() => {
    //     return this.accountRelays().map((r) => r.url);
    // });

    constructor() {
        // // When relays change, sync with storage
        // effect(() => {
        //     if (this.relaysChanged()) {
        //         this.logger.debug(`Relay effect triggered with ${this.relays.length} relays`);

        //         if (this.relays.length > 0) {
        //             this.syncRelaysToStorage(this.relays);
        //         }
        //     }
        // });
    }

    // /**
    //  * Clears all relays (used when logging out)
    //  */
    // clearRelays(): void {
    //     this.logger.debug('Clearing all relays');
    //     this.relays = [];
    //     this.relaysChanged.set(this.relays);
    // }

    // /**
    //  * Adds a new relay to the list
    //  */
    // addRelay(url: string): void {
    //     this.logger.debug(`Adding new relay: ${url}`);

    //     const newRelay: Relay = {
    //         url,
    //         status: 'disconnected',
    //         lastUsed: Date.now()
    //     };

    //     this.relays.push(newRelay);
    //     this.relaysChanged.set(this.relays);

    //     // this.relays.update(relays => [...relays, newRelay]);
    // }

    // /**
    //  * Sets the list of relays for the current user
    //  */
    // setRelays(relayUrls: string[]): void {
    //     this.logger.debug(`Setting ${relayUrls.length} relays for current account`);

    //     // Convert simple URLs to Relay objects with default properties
    //     const relayObjects = relayUrls.map(url => ({
    //         url,
    //         status: 'connecting' as const,
    //         lastUsed: Date.now()
    //     }));

    //     // Before storing the relays, make sure that they have / at the end
    //     // if they are missing it. This ensures consistency in the relay URLs with SimplePool.
    //     relayObjects.forEach(relay => {
    //         if (!relay.url.endsWith('/')) {
    //             relay.url += '/';
    //         }
    //     });

    //     this.relays = relayObjects;
    //     this.logger.debug('Relays updated successfully');
    //     this.relaysChanged.set(this.relays);
    // }

    // /**
    //  * Gets the user pool
    //  */
    // // getUserPool(): SimplePool | null {
    // //   return this.accountPool;
    // // }

    // /**
    //  * Updates the status of a specific relay
    //  */
    // updateRelayStatus(url: string, status: Relay['status']): void {
    //     this.logger.debug(`Updating relay status for ${url} to ${status}`);

    //     const relay = this.relays.find(relay => relay.url === url);
    //     if (relay) {
    //         relay.status = status;
    //         relay.lastUsed = Date.now();
    //     }

    //     this.relaysChanged.set(this.relays);
    // }

    // /**
    //  * Helper method to update the lastUsed timestamp for a relay
    //  */
    // private updateRelayLastUsed(url: string): void {
    //     const relay = this.relays.find(relay => relay.url === url);
    //     if (relay) {
    //         relay.lastUsed = Date.now();
    //     }

    //     // this.relays.update(relays =>
    //     //   relays.map(relay =>
    //     //     relay.url === url
    //     //       ? { ...relay, lastUsed: Date.now() }
    //     //       : relay
    //     //   )
    //     // );
    // }

    // /**
    //  * Removes a relay from the list
    //  */
    // removeRelay(url: string): void {
    //     this.logger.debug(`Removing relay: ${url}`);

    //     this.relays = this.relays.filter(relay => relay.url !== url);
    //     // this.relays.update(relays => relays.filter(relay => relay.url !== url));

    //     this.relaysChanged.set(this.relays);
    // }

    // /**
    //  * Saves the current relays to storage for the current user
    //  */
    // private async syncRelaysToStorage(relays: Relay[]): Promise<void> {
    //     try {
    //         // Save each relay to the storage
    //         for (const relay of relays) {
    //             await this.storage.saveRelay(relay);
    //         }

    //         this.logger.debug(`Synchronized ${relays.length} relays to storage`);
    //     } catch (error) {
    //         this.logger.error('Error syncing relays to storage', error);
    //     }
    // }

    config: any = {};
    // relayUrls: string[] = [];

    // async initialize(pubkey: string, config?: { customConfig?: any, customRelays?: string[] }) {
    //     let relayUrls = await this.nostr.getRelays(pubkey);

    //     // If no relays were found, we will fall back to using the account relays. This is especially
    //     // important when the current logged-on user opens their own profile page and does NOT have 
    //     // any relay list discovered yet.
    //     if (relayUrls.length === 0) {
    //         this.logger.warn(`No relays found for user ${pubkey}, falling back to account relays`);
    //         relayUrls = this.accountRelayUrls();
    //         this.userRelaysFound.set(false);

    //         // Log additional info for debugging
    //         this.logger.debug(`Using ${relayUrls.length} account relays as fallback:`, relayUrls);
    //     } else {
    //         this.logger.debug(`Found ${relayUrls.length} relays for user ${pubkey}:`, relayUrls);
    //     }

    //     this.relayUrls = relayUrls;
    // }

    /**
     * Sets the user pool
     */
    // setAccountPool(pool: SimplePool): void {
    //     this.pool = pool;

    //     // After setting the user pool, check the online status of the relays
    //     this.logger.debug('Account pool set, checking relay status...');

    //     const connectionStatuses = this.pool.listConnectionStatus();

    //     // Update relay statuses using a for...of loop
    //     for (const [url, status] of connectionStatuses) {
    //         const userRelay = this.accountRelays().find(r => r.url === url);

    //         if (!userRelay) {
    //             this.logger.warn(`Relay ${url} not found in account relays`);
    //             continue;
    //         }

    //         userRelay.status = status ? 'connected' : 'disconnected';
    //     }
    // }

    async getEventByPubkeyAndKindAndTag(pubkey: string, kind: number, tag: { key: string, value: string }): Promise<Event | null> {
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
            const event = await this.pool.get(this.relay.getAccountRelayUrls(), filter, { maxWait: timeout }) as T;

            this.logger.debug(`Received event from query`, event);

            return event;
        } catch (error) {
            this.logger.error('Error fetching events', error);
            return null;
        }
    }

    publish(event: Event) {
        this.logger.debug('Publishing event:', event);

        if (!this.pool) {
            this.logger.error('Cannot publish event: user pool is not initialized');
            return;
        }

        try {
            // Publish the event to all relays
            return this.pool.publish(this.relay.getAccountRelayUrls(), event);
        } catch (error) {
            this.logger.error('Error publishing event', error);
        }

        return;
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
            this.logger.error('Cannot subscribe: user pool is not initialized');
            return {
                unsubscribe: () => {
                    this.logger.debug('No subscription to unsubscribe from');
                }
            };
        }

        // Use provided relay URLs or default to the user's relays
        if (this.relay.getAccountRelayUrls().length === 0) {
            this.logger.warn('No relays available for subscription');
            return {
                unsubscribe: () => {
                    this.logger.debug('No subscription to unsubscribe from (no relays)');
                }
            };
        }

        try {
            // Create the subscription
            const sub = this.pool.subscribeMany(this.relay.getAccountRelayUrls(), filters, {
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