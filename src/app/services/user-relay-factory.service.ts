import { Injectable, inject } from '@angular/core';
import { UserRelayService } from './relays/user-relay';

@Injectable({
  providedIn: 'root',
})
export class UserRelayExFactoryService {
  private userRelayService = inject(UserRelayService);

  /**
   * Returns the singleton UserRelayService instance and ensures relays are discovered for the pubkey
   * @param pubkey The public key to discover relays for
   * @returns The singleton UserRelayService instance
   */
  async create(pubkey: string): Promise<UserRelayService> {
    // Ensure relays are discovered and cached for this pubkey
    await this.userRelayService.ensureRelaysForPubkey(pubkey);

    // Return the singleton instance
    return this.userRelayService;
  }
}
