import { Injectable, inject, Injector, InjectionToken } from '@angular/core';
import { ProfileState } from './profile-state';
import { UserRelayService } from './relays/user-relay';
import { LoggerService } from './logger.service';
import { UtilitiesService } from './utilities.service';
import { DatabaseService } from './database.service';

/**
 * Injection token for providing ProfileState to child components.
 * This allows child components to inject the ProfileState created by their parent ProfileComponent.
 */
export const PROFILE_STATE = new InjectionToken<ProfileState>('ProfileState');

/**
 * Factory service for creating ProfileState instances.
 * Each ProfileComponent should create its own ProfileState instance to ensure
 * data isolation when multiple profiles are open in different panes.
 */
@Injectable({
  providedIn: 'root',
})
export class ProfileStateFactory {
  private readonly injector = inject(Injector);
  private readonly logger = inject(LoggerService);
  private readonly userRelayService = inject(UserRelayService);
  private readonly utilities = inject(UtilitiesService);
  private readonly database = inject(DatabaseService);

  /**
   * Creates a new ProfileState instance with all required dependencies.
   * The ProfileComponent should call this method and provide the result
   * to child components via the PROFILE_STATE injection token.
   * 
   * @returns A new ProfileState instance
   */
  create(): ProfileState {
    return new ProfileState(
      this.injector,
      this.logger,
      this.userRelayService,
      this.utilities,
      this.database
    );
  }
}
