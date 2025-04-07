import { inject, Injectable, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { kinds, SimplePool } from 'nostr-tools';

@Injectable({
  providedIn: 'root'
})
export class DataLoadingService {
  isLoading = signal(false);
  loadingMessage = signal('Loading data...');
  nostr = inject(NostrService);

  async loadData(): Promise<void> {
    if (!this.nostr.currentUser()) {
      return;
    }

    this.loadingMessage.set('Retrieving your relay list...');
    this.isLoading.set(true);

    const pubkey = this.nostr.currentUser()!.pubkey;
    let profile = null;
    let metadata = null;


    // To properly scale Nostr, the first step is simply getting the user's relay list and nothing more.
    const pool = new SimplePool();
    const relays = await pool.get(this.nostr.bootStrapRelays, {
      kinds: [kinds.RelayList],
      authors: [pubkey],
    });

    let relayUrls: string[] = [];

    if (relays) {
      relayUrls = relays.tags.filter(tag => tag.length >= 2 && tag[0] === 'r').map(tag => tag[1]);
    }

    // Attempt to connect to the user's defined relays, to help Nostr with
    // scaling, we don't use the default relays here.
    if (relayUrls.length > 0) {
      this.loadingMessage.set(`Found your ${relayUrls.length} relays, retrieving your metadata...`);

      const userPool = new SimplePool();

      metadata = await userPool.get(relayUrls, {
        kinds: [kinds.Metadata],
        authors: [pubkey],
      });

      if (metadata) {
        this.loadingMessage.set('Found your profile! 👍');
      }

      userPool.close(relayUrls);
    }

    pool.close(this.nostr.bootStrapRelays);

    this.loadingMessage.set('Loading completed! ✅');

    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      this.isLoading.set(false);
    }
    
  }

  /**
   * Simulates loading data with a timeout
   * @param duration Time in milliseconds to simulate loading
   * @param message Optional custom loading message
   * @returns Promise that resolves when loading is complete
   */
  async simulateLoading(duration: number = 5000, message: string = 'Loading data...'): Promise<void> {
    this.loadingMessage.set(message);
    this.isLoading.set(true);

    try {
      await new Promise(resolve => setTimeout(resolve, duration));
    } finally {
      this.isLoading.set(false);
    }
  }
}
