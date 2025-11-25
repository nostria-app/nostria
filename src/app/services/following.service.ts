import { Injectable, inject, signal, computed, effect, untracked } from '@angular/core';
import { Event } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { StorageService, InfoRecord, TrustMetrics } from './storage.service';
import { UserDataService } from './user-data.service';
import { Metrics } from './metrics';
import { LoggerService } from './logger.service';
import { NostrRecord } from '../interfaces';
import { UserMetric } from '../interfaces/metrics';
import { ImageCacheService } from './image-cache.service';

/**
 * Complete profile data structure for a followed user
 */
export interface FollowingProfile {
  pubkey: string;
  event: Event | null; // Original kind 0 event
  profile: NostrRecord | null; // Parsed profile data
  info: InfoRecord | null; // User info from info table
  trust: TrustMetrics | null; // Trust metrics from info table
  metric: UserMetric | null; // User metrics from info table
  lastUpdated: number; // When this profile was last updated
}

/**
 * Service that maintains an in-memory cache of all following profiles
 * This is the single source of truth for followed user data
 */
@Injectable({
  providedIn: 'root',
})
export class FollowingService {
  private readonly accountState = inject(AccountStateService);
  private readonly storage = inject(StorageService);
  private readonly userData = inject(UserDataService);
  private readonly metrics = inject(Metrics);
  private readonly logger = inject(LoggerService);
  private readonly imageCacheService = inject(ImageCacheService);

  // In-memory cache of all following profiles
  private readonly profilesMap = signal<Map<string, FollowingProfile>>(new Map());

  // Loading state
  readonly isLoading = signal(false);
  readonly isInitialized = signal(false);

  // Computed array of all profiles for easy iteration
  readonly profiles = computed(() => Array.from(this.profilesMap().values()));

  // Count of following profiles
  readonly count = computed(() => this.profilesMap().size);

  constructor() {
    // Effect to load profiles when account or following list changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const followingList = this.accountState.followingList();

      if (!pubkey || followingList.length === 0) {
        this.logger.debug('[FollowingService] No account or empty following list, clearing profiles');
        this.clear();
        return;
      }

      untracked(() => {
        this.logger.info(`[FollowingService] Account or following list changed, loading ${followingList.length} profiles`);
        this.loadProfiles(followingList);
      });
    });
  }

  /**
   * Load profiles for the given pubkeys
   */
  private async loadProfiles(pubkeys: string[]): Promise<void> {
    if (this.isLoading()) {
      this.logger.debug('[FollowingService] Already loading, skipping duplicate load');
      return;
    }

    this.isLoading.set(true);
    this.logger.info(`[FollowingService] Loading ${pubkeys.length} following profiles...`);

    try {
      // Create a new map to store all profiles
      const newMap = new Map<string, FollowingProfile>();

      // Load all profiles in parallel batches
      const batchSize = 50;
      for (let i = 0; i < pubkeys.length; i += batchSize) {
        const batch = pubkeys.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (pubkey) => {
            try {
              // Skip relay fetch for initial bulk load to prevent network spam
              const profile = await this.loadSingleProfile(pubkey, true);
              newMap.set(pubkey, profile);
            } catch (error) {
              this.logger.error(`[FollowingService] Failed to load profile for ${pubkey}:`, error);
              // Create a minimal profile even on error
              newMap.set(pubkey, this.createMinimalProfile(pubkey));
            }
          })
        );

        // Update progress periodically (every 100 profiles)
        if ((i + batchSize) % 100 === 0 || i + batchSize >= pubkeys.length) {
          this.logger.debug(`[FollowingService] Loaded ${Math.min(i + batchSize, pubkeys.length)}/${pubkeys.length} profiles`);
        }
      }

      // Update the signal with the new map
      this.profilesMap.set(newMap);
      this.isInitialized.set(true);
      this.logger.info(`[FollowingService] Successfully loaded ${newMap.size} following profiles`);

      // Preload profile images in the background
      this.preloadProfileImages(newMap);
    } catch (error) {
      this.logger.error('[FollowingService] Error loading profiles:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Preload images for all following profiles in the background
   */
  private preloadProfileImages(profilesMap: Map<string, FollowingProfile>): void {
    // Use requestIdleCallback if available, otherwise fall back to queueMicrotask
    const schedulePreload = (callback: () => void) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(callback, { timeout: 5000 });
      } else {
        queueMicrotask(callback);
      }
    };

    schedulePreload(async () => {
      try {
        const imagesToPreload: { url: string; width: number; height: number }[] = [];

        // Collect all profile image URLs
        for (const profile of profilesMap.values()) {
          if (profile.profile?.data?.picture) {
            // Preload images in different sizes commonly used
            imagesToPreload.push(
              { url: profile.profile.data.picture, width: 40, height: 40 }, // list view
              { url: profile.profile.data.picture, width: 48, height: 48 }, // small/icon view
              { url: profile.profile.data.picture, width: 128, height: 128 } // medium view
            );
          }
        }

        if (imagesToPreload.length > 0) {
          this.logger.info(
            `[FollowingService] Preloading ${imagesToPreload.length} profile images for ${profilesMap.size} users`
          );
          await this.imageCacheService.preloadImages(imagesToPreload);
          this.logger.info('[FollowingService] Profile images preloaded successfully');
        }
      } catch (error) {
        this.logger.warn('[FollowingService] Failed to preload profile images:', error);
      }
    });
  }

  /**
   * Load a single profile with all its data
   */
  private async loadSingleProfile(pubkey: string, skipRelay = false): Promise<FollowingProfile> {
    const now = Math.floor(Date.now() / 1000);

    // Load all data in parallel
    const [profileData, infoRecord, trustMetrics, metricData] = await Promise.all([
      this.userData.getProfile(pubkey, { skipRelay }).catch(() => null),
      this.storage.getInfo(pubkey, 'user').catch(() => null),
      this.storage.getInfo(pubkey, 'trust').catch(() => null),
      this.metrics.getUserMetric(pubkey).catch(() => null),
    ]);

    return {
      pubkey,
      event: profileData?.event || null,
      profile: profileData || null,
      info: infoRecord || null,
      trust: trustMetrics as TrustMetrics | null,
      metric: metricData,
      lastUpdated: now,
    };
  }

  /**
   * Create a minimal profile when loading fails
   */
  private createMinimalProfile(pubkey: string): FollowingProfile {
    return {
      pubkey,
      event: null,
      profile: null,
      info: null,
      trust: null,
      metric: null,
      lastUpdated: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Get a specific profile by pubkey
   */
  getProfile(pubkey: string): FollowingProfile | undefined {
    return this.profilesMap().get(pubkey);
  }

  /**
   * Check if a profile exists in the following list
   */
  hasProfile(pubkey: string): boolean {
    return this.profilesMap().has(pubkey);
  }

  /**
   * Update a single profile (useful when a profile is updated)
   */
  async updateProfile(pubkey: string): Promise<void> {
    if (!this.hasProfile(pubkey)) {
      this.logger.warn(`[FollowingService] Cannot update profile ${pubkey}, not in following list`);
      return;
    }

    try {
      const updatedProfile = await this.loadSingleProfile(pubkey);
      this.profilesMap.update((map) => {
        const newMap = new Map(map);
        newMap.set(pubkey, updatedProfile);
        return newMap;
      });
      this.logger.debug(`[FollowingService] Updated profile for ${pubkey}`);
    } catch (error) {
      this.logger.error(`[FollowingService] Failed to update profile for ${pubkey}:`, error);
    }
  }

  /**
   * Refresh all profiles (force reload from storage/network)
   */
  async refresh(): Promise<void> {
    const followingList = this.accountState.followingList();
    if (followingList.length === 0) {
      this.logger.debug('[FollowingService] No following list to refresh');
      return;
    }

    this.logger.info('[FollowingService] Refreshing all following profiles');
    await this.loadProfiles(followingList);
  }

  /**
   * Clear all cached profiles
   */
  clear(): void {
    this.logger.debug('[FollowingService] Clearing all following profiles');
    this.profilesMap.set(new Map());
    this.isInitialized.set(false);
  }

  /**
   * Get profiles with specific filters applied
   * This creates a virtual view of the profiles
   */
  getFilteredProfiles(
    filters: {
      hasRelayList?: boolean;
      hasFollowingList?: boolean;
      hasNip05?: boolean;
      favoritesOnly?: boolean;
      favoritesList?: string[];
    },
    profiles?: FollowingProfile[]
  ): FollowingProfile[] {
    const allProfiles = profiles ?? this.profiles();

    if (!filters || Object.keys(filters).length === 0) {
      return allProfiles;
    }

    return allProfiles.filter((profile) => {
      // Favorites filter
      if (filters.favoritesOnly && filters.favoritesList) {
        if (!filters.favoritesList.includes(profile.pubkey)) {
          return false;
        }
      }

      // Relay list filter
      if (filters.hasRelayList) {
        // Check if user has relay list (kind 10002 or kind 3 relay tags)
        const hasRelays = ((profile.info?.['relayCount'] as number | undefined) || 0) > 0;
        if (!hasRelays) return false;
      }

      // Following list filter
      if (filters.hasFollowingList) {
        const hasFollowing = ((profile.info?.['followingCount'] as number | undefined) || 0) > 0;
        if (!hasFollowing) return false;
      }

      // NIP-05 filter
      if (filters.hasNip05) {
        const hasNip05 = profile.profile?.data?.nip05 && profile.profile?.data?.nip05valid;
        if (!hasNip05) return false;
      }

      return true;
    });
  }

  /**
   * Calculate total engagement score from user metrics
   */
  private calculateEngagement(metric: UserMetric | null): number {
    if (!metric) return 0;

    return (
      (metric.liked || 0) +
      (metric.replied || 0) +
      (metric.reposted || 0) +
      (metric.quoted || 0) +
      (metric.messaged || 0) +
      (metric.mentioned || 0) +
      (metric.viewed || 0) * 0.1 // Weight views lower
    );
  }

  /**
   * Get profiles sorted by a specific criterion
   */
  getSortedProfiles(
    profiles: FollowingProfile[],
    sortBy: 'default' | 'reverse' | 'engagement-asc' | 'engagement-desc' | 'trust-asc' | 'trust-desc'
  ): FollowingProfile[] {
    const sorted = [...profiles];

    switch (sortBy) {
      case 'reverse':
        return sorted.reverse();

      case 'engagement-asc':
        return sorted.sort((a, b) => {
          const aMetric = this.calculateEngagement(a.metric) || 0;
          const bMetric = this.calculateEngagement(b.metric) || 0;
          return aMetric - bMetric;
        });

      case 'engagement-desc':
        return sorted.sort((a, b) => {
          const aMetric = this.calculateEngagement(a.metric) || 0;
          const bMetric = this.calculateEngagement(b.metric) || 0;
          return bMetric - aMetric;
        });

      case 'trust-asc':
        return sorted.sort((a, b) => {
          const aRank = a.trust?.rank || Number.MAX_SAFE_INTEGER;
          const bRank = b.trust?.rank || Number.MAX_SAFE_INTEGER;
          return aRank - bRank;
        });

      case 'trust-desc':
        return sorted.sort((a, b) => {
          const aRank = a.trust?.rank || Number.MAX_SAFE_INTEGER;
          const bRank = b.trust?.rank || Number.MAX_SAFE_INTEGER;
          return bRank - aRank;
        });

      case 'default':
      default:
        return sorted;
    }
  }

  /**
   * Search profiles by name, display name, or nip05
   */
  searchProfiles(query: string): FollowingProfile[] {
    if (!query || query.trim() === '') {
      return this.profiles();
    }

    const searchTerm = query.toLowerCase().trim();
    return this.profiles().filter((profile) => {
      const name = profile.profile?.data?.name?.toLowerCase() || '';
      const displayName = profile.profile?.data?.display_name?.toLowerCase() || '';
      const nip05 = profile.profile?.data?.nip05?.toLowerCase() || '';
      const about = profile.profile?.data?.about?.toLowerCase() || '';

      return (
        name.includes(searchTerm) ||
        displayName.includes(searchTerm) ||
        nip05.includes(searchTerm) ||
        about.includes(searchTerm)
      );
    });
  }

  /**
   * Helper method to convert FollowingProfile array to NostrRecord array
   * Filters out profiles without profile data
   */
  toNostrRecords(profiles: FollowingProfile[]): NostrRecord[] {
    return profiles
      .filter(p => p.profile !== null)
      .map(p => p.profile!);
  }
}
