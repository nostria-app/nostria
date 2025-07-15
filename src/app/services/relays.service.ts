// import { Injectable } from "@angular/core";
// import { SimplePool } from "nostr-tools";

// /** Responsible for holding and managing the instances of SimplePool utilized in Nostria. */
// @Injectable({
//     providedIn: 'root'
// })
// export class RelaysService {
//     private readonly accountPool = new SimplePool();
//     private readonly userPool = new SimplePool();
//     private readonly discoveryPool = new SimplePool();

//     private readonly accountRelayUrls: string[] = [];
//     private readonly userRelayUrls: string[] = [];
//     private readonly discoveryRelayUrls: string[] = [];

//     constructor() {
//         // Every 1 minutes, we will clean up the userPool by calling close on all connections that are not part of the current
//         // user relay list.
//         setInterval(() => {
//             this.closeUnused();
//         }, 1 * 60 * 1000);
//     }

//     closeUnused() {
//         // Create a diff from current connections with the current relay URLs, and close those that are not in the list.
//         const currentUserUrls = Array.from(this.userPool.listConnectionStatus().keys());
//         const unusedUrls = currentUserUrls.filter(url => !this.userRelayUrls.includes(url));
//         this.userPool.close(unusedUrls);

//         // TODO: The SimplePool does NOT remove relays from the internal "relays" Map. Maybe this could be improved in the future.
//     }

//     getAccountPool(): SimplePool {
//         return this.accountPool;
//     }

//     getUserPool(): SimplePool {
//         return this.userPool;
//     }

//     getDiscoveryPool(): SimplePool {
//         return this.discoveryPool;
//     }

//     setAccountRelayUrls(urls: string[]): void {
//         this.accountRelayUrls.length = 0;
//         this.accountRelayUrls.push(...urls);
//     }

//     setUserRelayUrls(urls: string[]): void {
//         this.userRelayUrls.length = 0;
//         this.userRelayUrls.push(...urls);
//     }

//     setDiscoveryRelayUrls(urls: string[]): void {
//         this.discoveryRelayUrls.length = 0;
//         this.discoveryRelayUrls.push(...urls);
//     }
// }
