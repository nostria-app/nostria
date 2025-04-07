import { Injectable, inject, signal, computed } from '@angular/core';
import { LoggerService } from './logger.service';

export interface Relay {
  url: string;
  status?: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastUsed?: number;
}

@Injectable({
  providedIn: 'root'
})
export class RelayService {
  private readonly logger = inject(LoggerService);
  
  // Signal to store the relays for the current user
  private relays = signal<Relay[]>([]);
  
  // Computed value for public access to relays
  userRelays = computed(() => this.relays());
  
  constructor() {
    this.logger.info('Initializing RelayService');
  }
  
  /**
   * Sets the list of relays for the current user
   */
  setRelays(relayUrls: string[]): void {
    this.logger.debug(`Setting ${relayUrls.length} relays for current user`);
    
    // Convert simple URLs to Relay objects with default properties
    const relayObjects = relayUrls.map(url => ({
      url,
      status: 'disconnected' as const,
      lastUsed: Date.now()
    }));
    
    this.relays.set(relayObjects);
    this.logger.debug('Relays updated successfully');
  }
  
  /**
   * Updates the status of a specific relay
   */
  updateRelayStatus(url: string, status: Relay['status']): void {
    this.logger.debug(`Updating relay status for ${url} to ${status}`);
    
    this.relays.update(relays => 
      relays.map(relay => 
        relay.url === url 
          ? { ...relay, status, lastUsed: Date.now() } 
          : relay
      )
    );
  }
  
  /**
   * Adds a new relay to the list
   */
  addRelay(url: string): void {
    this.logger.debug(`Adding new relay: ${url}`);
    
    const newRelay: Relay = {
      url,
      status: 'disconnected',
      lastUsed: Date.now()
    };
    
    this.relays.update(relays => [...relays, newRelay]);
  }
  
  /**
   * Removes a relay from the list
   */
  removeRelay(url: string): void {
    this.logger.debug(`Removing relay: ${url}`);
    this.relays.update(relays => relays.filter(relay => relay.url !== url));
  }
  
  /**
   * Clears all relays (used when logging out)
   */
  clearRelays(): void {
    this.logger.debug('Clearing all relays');
    this.relays.set([]);
  }
}
