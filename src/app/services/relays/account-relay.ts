import { Injectable, inject } from '@angular/core';
import { kinds, SimplePool } from 'nostr-tools';
import { UtilitiesService } from '../utilities.service';
import { StorageService } from '../storage.service';
import { RelayServiceBase } from './relay-base';
import { DiscoveryRelayServiceEx } from './discovery-relay';

@Injectable({
  providedIn: 'root',
})
export class AccountRelayServiceEx extends RelayServiceBase {
  private storage = inject(StorageService);
  private utilities = inject(UtilitiesService);
  private discoveryRelay = inject(DiscoveryRelayServiceEx);

  constructor() {
    // TODO: We always create a new instance here that will be immediately destroyed by setAccount.
    super(new SimplePool());
  }

  async setAccount(pubkey: string) {
    this.destroy();

    // When the active user is changed, we need to discover their relay urls
    this.logger.debug(`Setting account relays for pubkey: ${pubkey}`);

    let relayUrls: string[] = [];

    // Get the relays URLs from storage, if available.
    let event = await this.storage.getEventByPubkeyAndKind(
      pubkey,
      kinds.RelayList
    );

    if (event) {
      this.logger.debug(`Found relay list for pubkey ${pubkey} in storage`);
      relayUrls = this.utilities.getRelayUrls(event);
    } else {
      event = await this.storage.getEventByPubkeyAndKind(
        pubkey,
        kinds.Contacts
      );

      if (event) {
        relayUrls = this.utilities.getRelayUrlsFromFollowing(event);
      }
    }

    if (relayUrls.length === 0) {
      relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
    }

    this.init(relayUrls);
  }

  clear() { }
}

// @Injectable({
//   providedIn: 'root',
// })
// export class AccountRelayService {
//   private logger = inject(LoggerService);
//   private relay = inject(RelayService);
//   userRelaysFound = signal<boolean>(true);
//   pool = new SimplePool();
//   config: any = {};

//   async getEventByPubkeyAndKindAndTag(
//     pubkey: string,
//     kind: number,
//     tag: { key: string; value: string }
//   ): Promise<Event | null> {
//     const authors = Array.isArray(pubkey) ? pubkey : [pubkey];

//     return this.get({
//       authors,
//       [`#${tag.key}`]: [tag.value],
//       kinds: [kind],
//     });
//   }

//   /**
//    * Generic function to fetch Nostr events (one-time query)
//    * @param filter Filter for the query
//    * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
//    * @param options Optional options for the query
//    * @returns Promise that resolves to an array of events
//    */
//   async get<T extends Event = Event>(
//     filter: {
//       kinds?: number[];
//       authors?: string[];
//       '#e'?: string[];
//       '#p'?: string[];
//       since?: number;
//       until?: number;
//       limit?: number;
//     },
//     relayUrls?: string[],
//     options: { timeout?: number } = {}
//   ): Promise<T | null> {
//     this.logger.debug('Getting events with filters (account-relay):', filter);

//     if (!this.pool) {
//       this.logger.error('Cannot get events: user pool is not initialized');
//       return null;
//     }

//     try {
//       // Default timeout is 5 seconds if not specified
//       const timeout = options.timeout || 5000;

//       // Execute the query
//       const event = (await this.pool.get(
//         this.relay.getAccountRelayUrls(),
//         filter,
//         { maxWait: timeout }
//       )) as T;

//       this.logger.debug(`Received event from query`, event);

//       return event;
//     } catch (error) {
//       this.logger.error('Error fetching events', error);
//       return null;
//     }
//   }

//   publish(event: Event): Promise<string>[] | undefined {
//     this.logger.debug('Publishing event:', event);

//     if (!this.pool) {
//       this.logger.error('Cannot publish event: user pool is not initialized');
//       return;
//     }

//     try {
//       // Publish the event to all relays
//       return this.pool.publish(this.relay.getAccountRelayUrls(), event);
//     } catch (error) {
//       this.logger.error('Error publishing event', error);
//     }

//     return;
//   }

//   /**
//    * Generic function to subscribe to Nostr events
//    * @param filters Array of filter objects for the subscription
//    * @param onEvent Callback function that will be called for each event received
//    * @param onEose Callback function that will be called when EOSE (End Of Stored Events) is received
//    * @param relayUrls Optional specific relay URLs to use (defaults to user's relays)
//    * @returns Subscription object with unsubscribe method
//    */
//   subscribe<T extends Event = Event>(
//     filters: {
//       kinds?: number[];
//       authors?: string[];
//       '#e'?: string[];
//       '#p'?: string[];
//       since?: number;
//       until?: number;
//       limit?: number;
//     }[],
//     onEvent: (event: T) => void,
//     onEose?: () => void,
//     relayUrls?: string[]
//   ) {
//     this.logger.debug('Creating subscription with filters:', filters);

//     if (!this.pool) {
//       this.logger.error('Cannot subscribe: user pool is not initialized');
//       return {
//         unsubscribe: () => {
//           this.logger.debug('No subscription to unsubscribe from');
//         },
//       };
//     }

//     // Use provided relay URLs or default to the user's relays
//     if (this.relay.getAccountRelayUrls().length === 0) {
//       this.logger.warn('No relays available for subscription');
//       return {
//         unsubscribe: () => {
//           this.logger.debug('No subscription to unsubscribe from (no relays)');
//         },
//       };
//     }

//     try {
//       // Create the subscription
//       const sub = this.pool.subscribeMany(
//         this.relay.getAccountRelayUrls(),
//         filters,
//         {
//           onevent: evt => {
//             this.logger.debug(`Received event of kind ${evt.kind}`);

//             // Update the lastUsed timestamp for this relay
//             // this.updateRelayLastUsed(relay);

//             // Call the provided event handler
//             onEvent(evt as T);

//             // console.log('Event received', evt);

//             // if (evt.kind === kinds.Contacts) {
//             //   const followingList = this.storage.getPTagsValues(evt);
//             //   console.log(followingList);
//             // this.followingList.set(followingList);
//             // this.profileState.followingList.set(followingList);

//             // this.storage.saveEvent(evt);

//             // Now you can use 'this' here
//             // For example: this.handleContacts(evt);
//             // }
//           },
//           onclose: reasons => {
//             console.log('Pool closed', reasons);
//             // Also changed this to an arrow function for consistency
//           },
//           oneose: () => {
//             if (onEose) {
//               this.logger.debug('End of stored events reached');
//               onEose();
//             }
//           },
//         }
//       );

//       // Return an object with close method
//       return {
//         close: () => {
//           this.logger.debug('Close from events');
//           sub.close();
//         },
//       };
//     } catch (error) {
//       this.logger.error('Error creating subscription', error);
//       return {
//         close: () => {
//           this.logger.debug('Error subscription close called');
//         },
//       };
//     }
//   }
// }
