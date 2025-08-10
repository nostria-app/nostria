import { Injectable, inject, Injector } from '@angular/core';
import { UserRelayService } from './user-relay.service';
import { UserRelayServiceEx } from './account-relay.service';

@Injectable({
  providedIn: 'root',
})
export class UserRelayExFactoryService {
  private injector = inject(Injector);

  /**
   * Creates a new instance of UserRelayService
   * @param config Optional configuration for the service
   * @returns A new UserRelayService instance
   */
  async create(pubkey: string): Promise<UserRelayServiceEx> {
    // Create a new child injector with UserRelayService provider
    const childInjector = Injector.create({
      providers: [{ provide: UserRelayServiceEx, deps: [] }],
      parent: this.injector,
    });

    // Get the instance from the child injector
    const service = childInjector.get(UserRelayServiceEx);

    // Initialize the service with the provided pubkey and config
    await service.initialize(pubkey);

    return service;
  }
}

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
  async create(
    pubkey: string,
    config?: { customConfig?: any; customRelays?: string[] }
  ): Promise<UserRelayService> {
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
  }
}
