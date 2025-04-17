import { inject, Injectable, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { kinds, SimplePool } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { RelayService } from './relay.service';
import { NostrEventData, StorageService, UserMetadata } from './storage.service';

@Injectable({
  providedIn: 'root'
})
export class DataLoadingService {
  isLoading = signal(false);
  loadingMessage = signal('Loading data...');
  showSuccess = signal(false);
  nostr = inject(NostrService);
  private logger = inject(LoggerService);
  private relayService = inject(RelayService);
  private storage = inject(StorageService);

  constructor() {
    this.logger.info('Initializing DataLoadingService');
  }

  async loadData(): Promise<void> {
    if (!this.nostr.activeAccount()) {
      this.logger.warn('Cannot load data: No user is logged in');
      return;
    }

    this.loadingMessage.set('Retrieving your relay list...');
    this.isLoading.set(true);
    this.showSuccess.set(false);
    this.logger.info('Starting data loading process');

    const pubkey = this.nostr.activeAccount()!.pubkey;
    this.logger.debug('Loading data for pubkey', { pubkey });

    let profile = null;
    let metadata = null;

    // First check if we have metadata in storage
    metadata = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.Metadata);

    if (metadata) {
      this.logger.info('Found user metadata in storage', { metadata });
      this.loadingMessage.set('Found your profile in local storage! 👍');
      
      // Process and update metadata for UI refresh
      this.nostr.updateAccountMetadata(metadata);
      
      // Also store in userMetadata for legacy support
      try {
        // Parse the content field which should be JSON
        const metadataContent = typeof metadata.content === 'string' 
          ? JSON.parse(metadata.content) 
          : metadata.content;

        // Create a NostrEventData object to store the full content and tags
        const eventData: NostrEventData<UserMetadata> = {
          pubkey: metadata.pubkey,
          content: metadataContent,  // Store the parsed JSON object 
          tags: metadata.tags,       // Store the original tags
          updated: Date.now()
        };

        // Save to storage with all fields and the full event data
        await this.storage.saveUserMetadata(pubkey, eventData);
      } catch (e) {
        this.logger.error('Failed to parse metadata content', e);
      }
    }

    // Get existing Relay List in storage
    let relays = await this.storage.getEventByPubkeyAndKind(pubkey, kinds.RelayList);

    if (relays) {
      this.logger.info('Found user relays in storage', { relays });
      this.loadingMessage.set('Found your relays in local storage! ✔️');
    }

    let bootstrapPool: SimplePool | null = null;

    if (!relays) {
      // To properly scale Nostr, the first step is simply getting the user's relay list and nothing more.
      bootstrapPool = new SimplePool();
      this.logger.debug('Connecting to bootstrap relays', { relays: this.relayService.bootStrapRelays() });

      this.logger.time('fetchRelayList');
      relays = await bootstrapPool.get(this.relayService.bootStrapRelays(), {
        kinds: [kinds.RelayList],
        authors: [pubkey],
      });
      this.logger.timeEnd('fetchRelayList');

      if (relays) {
        this.logger.info('Found your relays on network', { relays });
        this.loadingMessage.set('Found your relays on the network! ✔️');
        await this.storage.saveEvent(relays);
      }
    }

    let relayUrls: string[] = [];

    if (relays) {
      relayUrls = this.nostr.getRelayUrls(relays);
      this.logger.info(`Found ${relayUrls.length} relays for user`, { relayUrls });

      // Store the relays in the relay service
      this.relayService.setRelays(relayUrls);
    }

    // If there is no relayUrls (the kind:10002 might miss it), use default for fallback:
    if (!relayUrls || relayUrls.length == 0) {
      this.logger.warn('No relay list found for user');
      // Set default bootstrap relays if no custom relays found
      const defaultRelays = [...this.relayService.defaultRelays()];
      this.relayService.setRelays(defaultRelays);
      relayUrls = defaultRelays;
    }

    const userPool = new SimplePool();
    this.logger.debug('Connecting to user relays to fetch metadata');

    // Attempt to connect to the user's defined relays, to help Nostr with
    // scaling, we don't use the default relays here.
    if (metadata) {
      this.loadingMessage.set(`Found your ${relayUrls.length} relays, refreshing your metadata...`);
    } else {
      this.loadingMessage.set(`Found your ${relayUrls.length} relays, retrieving your metadata...`);

      this.logger.time('fetchMetadata');
      metadata = await userPool.get(relayUrls, {
        kinds: [kinds.Metadata],
        authors: [pubkey],
      });
      this.logger.timeEnd('fetchMetadata');
  
      if (metadata) {
        this.logger.info('Found user metadata', { metadata });
        this.loadingMessage.set('Found your profile! 👍');
        await this.storage.saveEvent(metadata);
        
        // Update the metadata in NostrService
        this.nostr.updateAccountMetadata(metadata);
  
        try {
          // Parse the content field which should be JSON
          const metadataContent = typeof metadata.content === 'string' 
            ? JSON.parse(metadata.content) 
            : metadata.content;
  
          // Create a NostrEventData object to store the full content and tags
          const eventData: NostrEventData<UserMetadata> = {
            pubkey: metadata.pubkey,
            content: metadataContent,  // Store the parsed JSON object 
            tags: metadata.tags,       // Store the original tags
            updated: Date.now()
          };
  
          // Save to storage with all fields and the full event data
          await this.storage.saveUserMetadata(pubkey, eventData);
        } catch (e) {
          this.logger.error('Failed to parse metadata content', e);
        }
      } else {
        this.logger.warn('No metadata found for user');
      }
    }

    // Attach the userPool to the relay service for further use.
    this.relayService.setUserPool(userPool);

    if (bootstrapPool) {
      this.logger.debug('Closing bootstrap relay pool connections');
      bootstrapPool.close(this.relayService.bootStrapRelays());
    }

    this.loadingMessage.set('Loading completed!');
    this.logger.info('Data loading process completed');

    // Show success animation instead of waiting
    this.isLoading.set(false);
    this.showSuccess.set(true);

    // Hide success animation after 1.5 seconds
    setTimeout(() => {
      this.showSuccess.set(false);
    }, 1500);
  }
}
