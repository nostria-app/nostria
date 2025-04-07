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


    // To properly scale Nostr, the first step is simply getting the user's relay list and nothing more.
    const pool = new SimplePool();
    const relays = await pool.get(this.nostr.bootStrapRelays, {
        kinds: [kinds.RelayList],
        authors: [this.nostr.currentUser()!.pubkey],
      });


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
