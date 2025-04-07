import { inject, Injectable, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { kinds, SimplePool } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { RelayService } from './relay.service';

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

    // To properly scale Nostr, the first step is simply getting the user's relay list and nothing more.
    const pool = new SimplePool();
    this.logger.debug('Connecting to bootstrap relays', { relays: this.nostr.bootStrapRelays });
    
    this.logger.time('fetchRelayList');
    const relays = await pool.get(this.nostr.bootStrapRelays, {
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
    } else {
      this.logger.warn('No relay list found for user');
      // Set default bootstrap relays if no custom relays found
      this.relayService.setRelays([...this.nostr.bootStrapRelays]);
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
      } else {
        this.logger.warn('No metadata found for user');
      }

      this.logger.debug('Closing user relay pool connections');
      userPool.close(relayUrls);
    }

    this.logger.debug('Closing bootstrap relay pool connections');
    pool.close(this.nostr.bootStrapRelays);

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

  /**
   * Simulates loading data with a timeout
   * @param duration Time in milliseconds to simulate loading
   * @param message Optional custom loading message
   * @returns Promise that resolves when loading is complete
   */
  async simulateLoading(duration: number = 5000, message: string = 'Loading data...'): Promise<void> {
    this.logger.info(`Simulating loading for ${duration}ms with message: "${message}"`);
    this.loadingMessage.set(message);
    this.isLoading.set(true);
    this.showSuccess.set(false);

    try {
      await new Promise(resolve => setTimeout(resolve, duration));
      this.logger.debug('Simulated loading completed');
      
      // Show success animation
      this.isLoading.set(false);
      this.showSuccess.set(true);
      
      // Hide success animation after 1.5 seconds
      setTimeout(() => {
        this.showSuccess.set(false);
      }, 1500);
    } catch (error) {
      this.isLoading.set(false);
      throw error;
    }
  }
}
