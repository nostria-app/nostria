import { Injectable, inject } from '@angular/core';
import { UserDataFactoryService } from './user-data-factory.service';
import { InstancePoolManagerService } from './instance-pool-manager.service';
import { LoggerService } from './logger.service';
import { UserDataService } from './user-data.service';

/**
 * Lightweight helper that acquires a UserDataService instance just-in-time,
 * performs an operation, then releases it so underlying relay resources can be recycled.
 */
@Injectable({
  providedIn: 'root',
})
export class OnDemandUserDataService {
  private factory = inject(UserDataFactoryService);
  private pool = inject(InstancePoolManagerService);
  private logger = inject(LoggerService);

  /**
   * Generic helper to run a function with a pooled instance and auto-release.
   */
  private async withInstance<T>(pubkey: string, fn: (uds: UserDataService) => Promise<T>): Promise<T> {
    const instance = await this.factory.create(pubkey);
    try {
      return await fn(instance);
    } finally {
      // Release reference immediately; data should be cached at storage layer.
      await this.pool.releaseInstance(pubkey);
    }
  }

  getProfile(pubkey: string, refresh = false) {
    return this.withInstance(pubkey, uds => uds.getProfile(pubkey, refresh));
  }

  getProfiles(pubkeys: string[]) {
    // Acquire/release sequentially to minimize simultaneous sockets
    return this.withInstance(pubkeys[0], async uds => {
      return uds.getProfiles(pubkeys);
    });
  }

  getEvent(pubkey: string, id: string) {
    return this.withInstance(pubkey, uds => uds.getEventById(id, { cache: true, save: true }));
  }

  /**
   * Fetch events (replaceable or regular) of a kind for a single pubkey.
   * Uses short-lived pooled instance.
   */
  getEventsByPubkeyAndKind(pubkey: string, kind: number) {
    return this.withInstance(pubkey, uds => uds.getEventsByPubkeyAndKind(pubkey, kind, { cache: true, save: true }));
  }
}
