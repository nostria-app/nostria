import { Injectable, inject, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { DatabaseService } from './database.service';
import { DataService } from './data.service';
import { AccountStateService } from './account-state.service';
import { MediaService } from './media.service';
import { LoggerService } from './logger.service';
import { Event } from 'nostr-tools';
import { AccountRelayService } from './relays/account-relay';

/**
 * Interface for profile data
 */
export interface ProfileData {
  display_name?: string;
  name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  lud16?: string; // Lightning address
  lud06?: string; // Lightning address (deprecated)
  nip05?: string; // Nostr address
  [key: string]: unknown; // Allow additional custom fields
}

/**
 * Interface for profile update options
 */
export interface ProfileUpdateOptions {
  /** Profile data to update */
  profileData: ProfileData;
  /** Profile image file to upload (optional) */
  profileImageFile?: File;
  /** Banner image file to upload (optional) */
  bannerImageFile?: File;
  /** Whether to skip media server validation and allow profile creation without file uploads */
  skipMediaServerCheck?: boolean;
  /** External identities (NIP-39) - array of [platform, identity, proof?] */
  externalIdentities?: Array<{ platform: string; identity: string; proof?: string }>;
}

/**
 * Interface for profile creation result
 */
export interface ProfileCreateResult {
  success: boolean;
  error?: string;
  profileEvent?: Event;
}

/**
 * Service for managing user profiles
 * Handles profile creation, updates, and publishing to Nostr relays
 */
@Injectable({
  providedIn: 'root',
})
export class Profile {
  private nostr = inject(NostrService);
  // private relay = inject(RelayService);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private data = inject(DataService);
  private accountState = inject(AccountStateService);
  private media = inject(MediaService);
  private logger = inject(LoggerService);

  private isUpdating = signal<boolean>(false);

  /**
   * Signal indicating if a profile update is in progress
   */
  get updating() {
    return this.isUpdating.asReadonly();
  }

  /**
   * Creates or updates a user profile
   * @param options Profile update options
   * @returns Promise resolving to the result of the operation
   */
  async updateProfile(options: ProfileUpdateOptions): Promise<ProfileCreateResult> {
    this.logger.debug('Updating profile', options);

    if (this.isUpdating()) {
      return { success: false, error: 'Profile update already in progress' };
    }

    this.isUpdating.set(true);

    try {
      const profileData = { ...options.profileData };

      // Check if file uploads are needed and media servers are available
      const needsFileUpload = options.profileImageFile || options.bannerImageFile;

      // If media servers are required but not available, handle gracefully
      if (needsFileUpload && !options.skipMediaServerCheck) {
        if (!this.hasMediaServers()) {
          throw new Error(
            'Media servers are required for file uploads. Please configure media servers first.'
          );
        }
      }

      // Handle profile image upload (only if media servers are available or check is skipped)
      if (options.profileImageFile && (options.skipMediaServerCheck || this.hasMediaServers())) {
        const uploadResult = await this.media.uploadFile(
          options.profileImageFile,
          false,
          this.media.mediaServers()
        );

        if (!uploadResult.item) {
          throw new Error(
            `Failed to upload profile image: ${uploadResult.message || 'Unknown error'}`
          );
        }

        profileData.picture = uploadResult.item.url;
        this.logger.debug('Profile image uploaded', {
          url: profileData.picture,
        });
      }

      // Handle banner upload (only if media servers are available or check is skipped)
      if (options.bannerImageFile && (options.skipMediaServerCheck || this.hasMediaServers())) {
        const uploadResult = await this.media.uploadFile(
          options.bannerImageFile,
          false,
          this.media.mediaServers()
        );

        if (!uploadResult.item) {
          throw new Error(
            `Failed to upload banner image: ${uploadResult.message || 'Unknown error'}`
          );
        }

        profileData.banner = uploadResult.item.url;
        this.logger.debug('Banner image uploaded', { url: profileData.banner });
      }

      // Log if files were skipped due to missing media servers
      if (options.skipMediaServerCheck) {
        if (options.profileImageFile && !this.hasMediaServers()) {
          this.logger.debug('Profile image upload skipped - no media servers configured');
        }
        if (options.bannerImageFile && !this.hasMediaServers()) {
          this.logger.debug('Banner image upload skipped - no media servers configured');
        }
      }

      // Clean the profile data
      const cleanedProfile = this.cleanProfileData(profileData);

      // Build tags array for external identities (NIP-39)
      const tags: string[][] = [];
      if (options.externalIdentities && options.externalIdentities.length > 0) {
        for (const identity of options.externalIdentities) {
          const tag = ['i', `${identity.platform}:${identity.identity}`];
          if (identity.proof) {
            tag.push(identity.proof);
          }
          tags.push(tag);
        }
      }

      // Create and publish the profile event
      const profileEvent = await this.createProfileEvent(cleanedProfile, tags);

      // Publish to relays
      await this.accountRelay.publish(profileEvent);
      this.logger.debug('Profile published to relays');

      // Save locally
      await this.database.saveEvent(profileEvent);
      this.logger.debug('Profile saved locally');

      // Update account state
      const record = this.data.toRecord(profileEvent);
      this.accountState.addToAccounts(record.event.pubkey, record);
      this.accountState.addToCache(record.event.pubkey, record);

      // Update the local account name
      const account = this.accountState.account();
      if (account) {
        account.name = cleanedProfile.display_name || cleanedProfile.name || '';
      }

      // Update the profile signal
      this.accountState.profile.set(record);

      this.logger.debug('Profile update completed successfully');
      return { success: true, profileEvent };
    } catch (error) {
      this.logger.error('Failed to update profile', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    } finally {
      this.isUpdating.set(false);
    }
  }

  /**
   * Creates a basic profile for new users during onboarding
   * @param displayName Optional display name
   * @param profileImageFile Optional profile image file
   * @returns Promise resolving to the result of the operation
   */
  async createInitialProfile(
    pubkey: string,
    displayName?: string,
    profileImageFile?: File
  ): Promise<ProfileCreateResult> {
    this.logger.debug('Creating initial profile', {
      hasDisplayName: !!displayName,
      hasProfileImage: !!profileImageFile,
    });

    // Only create profile if user provided some data
    if (!displayName && !profileImageFile) {
      this.logger.debug('No profile data provided, skipping profile creation');
      return { success: true };
    }

    // Ensure media servers are loaded for new users
    // During account creation, media servers are already configured by region
    await this.media.load(pubkey);

    const profileData: ProfileData = {};

    if (displayName?.trim()) {
      profileData.display_name = displayName.trim();
    }

    return this.updateProfile({
      profileData,
      profileImageFile,
      skipMediaServerCheck: false, // Now that media servers are loaded, we can properly validate
    });
  }

  /**
   * Checks if media servers are configured for file uploads
   * @returns True if media servers are available
   */
  private hasMediaServers(): boolean {
    return this.media.mediaServers().length > 0;
  }

  /**
   * Cleans profile data by removing deprecated and temporary fields
   * @param profileData Raw profile data
   * @returns Cleaned profile data
   */
  private cleanProfileData(profileData: ProfileData): ProfileData {
    const cleaned = { ...profileData };

    // Remove deprecated fields according to NIP-24
    delete cleaned['displayName']; // Use display_name instead
    delete cleaned['username']; // Use name instead

    // Remove temporary file references and URL fields used by UI
    delete cleaned['selectedProfileFile'];
    delete cleaned['selectedBannerFile'];
    delete cleaned['pictureUrl'];
    delete cleaned['bannerUrl'];

    // Handle NIP-05 identifier formatting
    if (cleaned.nip05) {
      // If user enters "@domain.com" (root domain), convert to "_@domain.com"
      if (cleaned.nip05.startsWith('@') && !cleaned.nip05.startsWith('_@')) {
        cleaned.nip05 = `_${cleaned.nip05}`;
      }
      // For regular "user@domain.com" format, leave as-is
    }

    // Remove empty string values to keep the profile clean
    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] === '') {
        delete cleaned[key];
      }
    });

    return cleaned;
  }

  /**
   * Creates a Nostr event for the profile data
   * @param profileData Cleaned profile data
   * @param tags Optional tags array (e.g., for NIP-39 external identities)
   * @returns Signed Nostr event
   */
  private async createProfileEvent(profileData: ProfileData, tags: string[][] = []): Promise<Event> {
    // Get existing profile to preserve kind
    const existingProfile = this.accountState.profile();
    const kind = existingProfile?.event.kind || 0; // Default to kind 0 for metadata

    // Create unsigned event
    const unsignedEvent = this.nostr.createEvent(kind, JSON.stringify(profileData), tags);

    // Sign the event
    const signedEvent = await this.nostr.signEvent(unsignedEvent);

    return signedEvent;
  }
}
