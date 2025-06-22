import { inject, Injectable, makeStateKey, TransferState } from "@angular/core";
import { ActivatedRouteSnapshot, Resolve } from "@angular/router";
import { NostrService } from "./services/nostr.service";
import { LayoutService } from "./services/layout.service";
import { Meta } from "@angular/platform-browser";
import { UtilitiesService } from "./services/utilities.service";
import { nip19 } from "nostr-tools";
import { DecodedNevent } from "nostr-tools/nip19";
import { MetaService } from "./services/meta.service";

export const EVENT_STATE_KEY = makeStateKey<any>('large-json-data');

export interface EventData {
    title: string;
    description: string;
    event?: any;
    metadata?: any;
}

@Injectable({ providedIn: 'root' })
export class DataResolver implements Resolve<EventData | null> {
    nostr = inject(NostrService);
    layout = inject(LayoutService);
    transferState = inject(TransferState);
    utilities = inject(UtilitiesService);
    metaService = inject(MetaService);
    meta = inject(Meta);

    constructor() {

    }

    private async connectToDiscoveryRelay(author: string): Promise<{ relayCount: number, success: boolean, relays: string[] }> {
        return new Promise((resolve) => {
            const WebSocketClass = typeof window !== 'undefined' ? WebSocket : require('ws');
            const ws = new WebSocketClass('wss://discovery.eu.nostria.app/');

            let timeout: NodeJS.Timeout;
            let relayCount = 0;
            let relays: string[] = [];

            const cleanup = () => {
                if (timeout) clearTimeout(timeout);
                if (ws.readyState === WebSocketClass.OPEN) {
                    ws.close();
                }
            };

            // Set timeout for the connection
            timeout = setTimeout(() => {
                cleanup();
                resolve({ relayCount: 0, success: false, relays: [] });
            }, 5000);

            ws.onopen = () => {
                console.log('Connected to discovery relay');

                // Send relay list request for the author
                const relayListFilter = {
                    kinds: [10002], // Relay list kind
                    authors: [author],
                    limit: 1
                };

                const subscriptionId = `relay_discovery_${Date.now()}`;
                const request = ['REQ', subscriptionId, relayListFilter];

                ws.send(JSON.stringify(request));
            };

            ws.onmessage = (event: any) => {
                try {
                    const data = JSON.parse(event.data.toString());
                    console.log('Discovery relay message:', data);

                    if (data[0] === 'EVENT' && data[2]) {
                        const nostrEvent = data[2];
                        if (nostrEvent.kind === 10002) {
                            // Extract relay URLs from the tags
                            const relayTags = nostrEvent.tags.filter((tag: string[]) => tag[0] === 'r');
                            relays = relayTags.map((tag: string[]) => tag[1]);
                            relayCount = relays.length;
                            console.log(`Found ${relayCount} relays for author:`, relays);
                        }
                    } else if (data[0] === 'EOSE') {
                        // End of stored events, close connection
                        cleanup();
                        resolve({ relayCount, success: true, relays });
                    }
                } catch (error) {
                    console.error('Error parsing discovery relay message:', error);
                }
            };

            ws.onerror = (error: any) => {
                console.error('Discovery relay error:', error);
                cleanup();
                resolve({ relayCount: 0, success: false, relays: [] });
            };

            ws.onclose = () => {
                console.log('Discovery relay connection closed');
                cleanup();
                resolve({ relayCount, success: relayCount > 0, relays });
            };
        });
    }

    private async fetchEventFromRelays(relays: string[], eventId: string): Promise<{ success: boolean, event: any | null }> {
        return new Promise((resolve) => {
            if (relays.length === 0) {
                resolve({ success: false, event: null });
                return;
            }

            const WebSocketClass = typeof window !== 'undefined' ? WebSocket : require('ws');
            let foundEvent: any = null;
            let connectionsCompleted = 0;
            let hasResolved = false;

            const tryRelay = async (relayUrl: string) => {
                try {
                    const ws = new WebSocketClass(relayUrl);
                    let timeout: NodeJS.Timeout;

                    const cleanup = () => {
                        if (timeout) clearTimeout(timeout);
                        if (ws.readyState === WebSocketClass.OPEN) {
                            ws.close();
                        }
                    };

                    timeout = setTimeout(() => {
                        cleanup();
                        connectionsCompleted++;
                        if (connectionsCompleted === relays.length && !hasResolved) {
                            hasResolved = true;
                            resolve({ success: foundEvent !== null, event: foundEvent });
                        }
                    }, 3000);

                    ws.onopen = () => {
                        console.log(`Connected to relay: ${relayUrl}`);

                        const eventFilter = {
                            ids: [eventId]
                        };

                        const subscriptionId = `event_fetch_${Date.now()}`;
                        const request = ['REQ', subscriptionId, eventFilter];

                        ws.send(JSON.stringify(request));
                    };

                    ws.onmessage = (event: any) => {
                        try {
                            const data = JSON.parse(event.data.toString());
                            console.log(`Message from ${relayUrl}:`, data);

                            if (data[0] === 'EVENT' && data[2]) {
                                const nostrEvent = data[2];
                                if (nostrEvent.id === eventId) {
                                    foundEvent = nostrEvent;
                                    console.log(`Found event on ${relayUrl}:`, nostrEvent);
                                    cleanup();
                                    if (!hasResolved) {
                                        hasResolved = true;
                                        resolve({ success: true, event: foundEvent });
                                    }
                                }
                            } else if (data[0] === 'EOSE') {
                                cleanup();
                                connectionsCompleted++;
                                if (connectionsCompleted === relays.length && !hasResolved) {
                                    hasResolved = true;
                                    resolve({ success: foundEvent !== null, event: foundEvent });
                                }
                            }
                        } catch (error) {
                            console.error(`Error parsing message from ${relayUrl}:`, error);
                        }
                    };

                    ws.onerror = (error: any) => {
                        console.error(`Error connecting to ${relayUrl}:`, error);
                        cleanup();
                        connectionsCompleted++;
                        if (connectionsCompleted === relays.length && !hasResolved) {
                            hasResolved = true;
                            resolve({ success: foundEvent !== null, event: foundEvent });
                        }
                    };

                    ws.onclose = () => {
                        console.log(`Connection to ${relayUrl} closed`);
                        cleanup();
                        connectionsCompleted++;
                        if (connectionsCompleted === relays.length && !hasResolved) {
                            hasResolved = true;
                            resolve({ success: foundEvent !== null, event: foundEvent });
                        }
                    };

                } catch (error) {
                    console.error(`Failed to connect to ${relayUrl}:`, error);
                    connectionsCompleted++;
                    if (connectionsCompleted === relays.length && !hasResolved) {
                        hasResolved = true;
                        resolve({ success: foundEvent !== null, event: foundEvent });
                    }
                }
            };

            // Try all relays in parallel
            relays.forEach(relayUrl => tryRelay(relayUrl));
        });
    }

    async resolve(route: ActivatedRouteSnapshot): Promise<EventData | null> {
        console.warn('DataResolver.resolve!!!!');

        if (this.layout.isBrowser()) {
            return null;
        }

        const id = route.params['id'];

        let data: EventData = {
            title: 'Nostr Event',
            description: 'Loading Nostr event content...'
        };

        try {
            if (this.utilities.isHex(id)) {
                // If we only have hex, we can't know which relay to find the event on.
                data.title = 'Nostr Event (Hex)';
            } else {
                // const decoded = this.utilities.decode(id) as DecodedNevent;

                // if (!decoded.data.author) {
                //     data.title = 'Nostr Event (No Author)';
                // } else {

                console.log('DataResolver.resolve', id);

                const metadata = await this.metaService.loadSocialMetadata(id);
                const { author, ...metadataWithoutAuthor } = metadata;
                data.event = metadataWithoutAuthor;

                console.log('DataResolver.resolve.metadata', metadata);

                // console.log('Finding article for', decoded.data.author);

                // const discoveryResult = await this.connectToDiscoveryRelay(decoded.data.author);
                // console.log('DataResolver.discoveryResult', discoveryResult);

                // if (discoveryResult.success && discoveryResult.relayCount > 0) {
                //     // Fetch the actual event from the discovered relays
                //     const eventResult = await this.fetchEventFromRelays(discoveryResult.relays, decoded.data.id);

                //     if (eventResult.success && eventResult.event) {
                //         const event = eventResult.event;
                //         data.title = event.content ? event.content.substring(0, 50) + '...' : `Nostr Event from ${decoded.data.author.substring(0, 8)}...`;
                //         data.description = `Found event: ${event.kind ? `Kind ${event.kind}` : 'Unknown type'} - ${event.content ? event.content.substring(0, 100) + '...' : 'No content available'}`;
                //         data.event = event;
                //     } else {
                //         data.title = `Nostr Event from ${decoded.data.author.substring(0, 8)}...`;
                //         data.description = `Found on ${discoveryResult.relayCount} relays: ${discoveryResult.relays.slice(0, 3).join(', ')}${discoveryResult.relays.length > 3 ? '...' : ''}`;
                //     }
                // } else {
                //     data.title = 'Nostr Event (No Relays Found)';
                //     data.description = 'Could not discover relay information';
                // }
                // }
            }
        } catch (error) {
            console.error('Error processing Nostr event:', error);
            data.title = 'Nostr Event (Error)';
            data.description = 'Error loading event content';
        }

        console.log('DataResolver.data', data);

        // this.metaService.updateSocialMetadata()

        // og:title
        // og:description
        // og:image
        // twitter:title
        // twitter:description
        // twitter:image

        // Set meta tags
        // this.meta.updateTag({ property: 'og:title', content: data.title });
        // this.meta.updateTag({ property: 'og:description', content: data.description || 'Amazing Nostr event content' });
        // this.meta.updateTag({ name: 'twitter:title', content: data.title });
        // this.meta.updateTag({ name: 'twitter:description', content: data.description || 'Amazing Nostr event content' });

        this.transferState.set(EVENT_STATE_KEY, data);

        return data;
    }
}