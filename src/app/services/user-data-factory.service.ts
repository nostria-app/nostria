import { Injectable, inject, Injector } from '@angular/core';
import { UserDataService } from './user-data.service';
import { DebugLoggerService } from './debug-logger.service';
import { LoggerService } from './logger.service';
import { InstancePoolManagerService } from './instance-pool-manager.service';

@Injectable({
  providedIn: 'root',
})
export class UserDataFactoryService {
  private injector = inject(Injector);
  private debugLogger = inject(DebugLoggerService);
  private logger = inject(LoggerService);
  private poolManager = inject(InstancePoolManagerService);

  /**
   * Creates or reuses a UserDataService instance for the given pubkey
   * @param pubkey The public key for the user data service
   * @returns A UserDataService instance (new or reused)
   */
  async create(pubkey: string): Promise<UserDataService> {
    this.logger.debug(`[UserDataFactory] Creating UserDataService for pubkey: ${pubkey.slice(0, 16)}...`);

    // Use the pool manager to get or create an instance
    const instance = await this.poolManager.getOrCreateInstance(pubkey, async () => {
      // This function will only be called if a new instance needs to be created
      this.logger.debug(`[UserDataFactory] Creating new UserDataService instance for pubkey: ${pubkey}`);

      // Create a new child injector with UserDataService provider
      const childInjector = Injector.create({
        providers: [{ provide: UserDataService, deps: [] }],
        parent: this.injector,
      });

      // Get the instance from the child injector
      const service = childInjector.get(UserDataService);

      // Initialize the service with the provided pubkey and config
      await service.initialize(pubkey);

      this.logger.debug(`[UserDataFactory] Successfully created and initialized UserDataService for pubkey: ${pubkey}`);

      return service;
    });

    // Type assertion to access debugInstanceId safely
    this.logger.debug(`[UserDataFactory] UserDataService ready for pubkey: ${pubkey.slice(0, 16)}...`);

    return instance;
  }

  /**
   * Get pool statistics for debugging
   */
  getPoolStats() {
    return this.poolManager.getPoolStats();
  }

  /**
   * Update pool configuration
   */
  updatePoolConfig(config: Parameters<typeof this.poolManager.updateConfig>[0]) {
    this.poolManager.updateConfig(config);
  }

  /**
   * Manually destroy an instance (useful for testing or manual cleanup)
   */
  async destroyInstance(pubkey: string): Promise<void> {
    await this.poolManager.destroyInstance(pubkey);
  }

  /**
   * Make the factory available globally for testing and debugging
   */
  enableGlobalAccess(): void {
    if (typeof globalThis !== 'undefined') {
      (globalThis as Record<string, unknown>)['userDataFactory'] = {
        getPoolStats: () => this.getPoolStats(),
        updatePoolConfig: (config: Record<string, unknown>) => this.updatePoolConfig(config),
        destroyInstance: (pubkey: string) => this.destroyInstance(pubkey),
        createInstance: (pubkey: string) => this.create(pubkey),
        manualCleanup: () => this.poolManager.runCleanup(),
      };
      console.log('[UserDataFactory] Global access enabled. Use globalThis.userDataFactory');
    }
  }
}
