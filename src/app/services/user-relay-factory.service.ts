import { Injectable, inject, Injector } from '@angular/core';
import { UserRelayService } from './user-relay.service';

@Injectable({
  providedIn: 'root',
})
export class UserRelayFactoryService {
  private injector = inject(Injector);

  /**
   * Creates a new instance of UserRelayService
   * @param config Optional configuration for the service
   * @returns A new UserRelayService instance
   */
  // async create(pubkey: string, config?: { customConfig?: any, customRelays?: string[] }): Promise<UserRelayService> {
  //     // We use the injector to create a new instance with all its dependencies resolved
  //     const service = this.injector.get(UserRelayService);

  //     await service.initialize(pubkey, config);

  //     // If you need to initialize the service with specific configuration
  //     if (config?.customConfig) {
  //         // Apply configuration to the service instance
  //         // service.initialize(config.customConfig);
  //     }

  //     // Initialize with custom configuration if provided
  //     if (config?.customRelays) {
  //         // Example of post-creation configuration
  //         // service.configureRelays(config.customRelays);
  //     }

  //     return service;
  // }

  async create(
    pubkey: string,
    config?: { customConfig?: any; customRelays?: string[] }
  ): Promise<UserRelayService> {
    try {
      // Create a new child injector with UserRelayService provider
      const childInjector = Injector.create({
        providers: [{ provide: UserRelayService, deps: [] }],
        parent: this.injector,
      });

      // Get the instance from the child injector
      const service = childInjector.get(UserRelayService);

      // Initialize the service with the provided pubkey and config
      await service.initialize(pubkey, config);

      return service;
    } catch (error) {
      // this.logger.error('Failed to create UserRelayService instance', error);
      throw error;
    }
  }
}
