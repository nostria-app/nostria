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
    if (!this.nostr.currentUser()) {
      this.logger.warn('Cannot load data: No user is logged in');
      return;
    }

    this.loadingMessage.set('Retrieving your relay list...');
    this.isLoading.set(true);
    this.showSuccess.set(false);
    this.logger.info('Starting data loading process');

    const pubkey = this.nostr.currentUser()!.pubkey;
    this.logger.debug('Loading data for pubkey', { pubkey });
    
    let profile = null;
    let metadata = null;

    // First check if we have metadata in storage
    const storedMetadata = await this.storage.getUserMetadata(pubkey);
    if (storedMetadata) {
      this.logger.info('Found user metadata in storage', { storedMetadata });
      this.loadingMessage.set('Found your profile in local storage! 👍');
    }

    // To properly scale Nostr, the first step is simply getting the user's relay list and nothing more.
    const bootstrapPool = new SimplePool();
    this.logger.debug('Connecting to bootstrap relays', { relays: this.relayService.bootStrapRelays() });
    
    this.logger.time('fetchRelayList');
    const relays = await bootstrapPool.get(this.relayService.bootStrapRelays(), {
      kinds: [kinds.RelayList],
      authors: [pubkey],
    });
    this.logger.timeEnd('fetchRelayList');

    let relayUrls: string[] = [];

    if (relays) {
      relayUrls = relays.tags.filter(tag => tag.length >= 2 && tag[0] === 'r').map(tag => tag[1]);
      this.logger.info(`Found ${relayUrls.length} relays for user`, { relayUrls });
      
      // Store the relays in the relay service
      this.relayService.setRelays(relayUrls);
      
      // Save to storage
      await this.relayService.saveUserRelays(pubkey);
    } else {
      this.logger.warn('No relay list found for user');
      // Set default bootstrap relays if no custom relays found
      this.relayService.setRelays([...this.relayService.defaultRelays()]);
      
      // Save bootstrap relays to storage for this user
      await this.relayService.saveUserRelays(pubkey);
    }

    // Attempt to connect to the user's defined relays, to help Nostr with
    // scaling, we don't use the default relays here.
    if (relayUrls.length > 0) {
      this.loadingMessage.set(`Found your ${relayUrls.length} relays, retrieving your metadata...`);

      const userPool = new SimplePool();
      this.logger.debug('Connecting to user relays to fetch metadata');
      
      this.logger.time('fetchMetadata');
      metadata = await userPool.get(relayUrls, {
        kinds: [kinds.Metadata],
        authors: [pubkey],
      });
      this.logger.timeEnd('fetchMetadata');

      if (metadata) {
        this.logger.info('Found user metadata', { metadata });
        this.loadingMessage.set('Found your profile! 👍');
        
        try {
          // Parse the content field which should be JSON
          const metadataContent = JSON.parse(metadata.content);

          this.logger.debug('Parsed metadata content', { metadataContent });
          
          // Create a NostrEventData object to store the full content and tags
          const eventData: NostrEventData<UserMetadata> = {
            content: metadataContent,  // Store the parsed JSON object 
            tags: metadata.tags,       // Store the original tags
            // raw: metadata.content      // Optionally store the raw JSON string
          };
          
          // Save to storage with all fields and the full event data
          await this.nostr.saveUserMetadata(pubkey, eventData);
        } catch (e) {
          this.logger.error('Failed to parse metadata content', e);
        }
      } else {
        this.logger.warn('No metadata found for user');
      }

      // Attach the userPool to the relay service for further use.
      this.relayService.setUserPool(userPool);

      // this.logger.debug('Closing user relay pool connections');
      // userPool.close(relayUrls);
    }

    this.logger.debug('Closing bootstrap relay pool connections');
    bootstrapPool.close(this.relayService.bootStrapRelays());

    this.loadingMessage.set('Loading completed!');
    this.logger.info('Data loading process completed');

    // Show success animation instead of waiting
    this.isLoading.set(false);
    this.showSuccess.set(true);
    
    // Hide success animation after 1.5 seconds
    setTimeout(() => {
      this.showSuccess.set(false);
      
      // Refresh metadata after successful data loading
      // this.nostr.loadAllUsersMetadata().catch(err => 
      //   this.logger.error('Failed to refresh metadata after data loading', err));
    }, 1500);
  }
}
