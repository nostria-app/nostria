import { Injectable, inject, Injector } from '@angular/core';
import { UserDataService } from './user-data.service';

@Injectable({
  providedIn: 'root',
})
export class UserDataFactoryService {
  private injector = inject(Injector);

  /**
   * Creates a new instance of UserRelayService
   * @param config Optional configuration for the service
   * @returns A new UserRelayService instance
   */
  async create(pubkey: string): Promise<UserDataService> {
    // Create a new child injector with UserRelayService provider
    const childInjector = Injector.create({
      providers: [{ provide: UserDataService, deps: [] }],
      parent: this.injector,
    });

    // Get the instance from the child injector
    const service = childInjector.get(UserDataService);

    // Initialize the service with the provided pubkey and config
    await service.initialize(pubkey);

    return service;
  }
}
