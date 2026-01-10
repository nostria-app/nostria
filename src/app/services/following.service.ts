import { Injectable, inject, signal, computed, effect, untracked } from '@angular/core';
import { Event } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { DatabaseService, TrustMetrics } from './database.service';
import { UserDataService } from './user-data.service';
import { Metrics } from './metrics';
import { LoggerService } from './logger.service';
import { NostrRecord } from '../interfaces';
import { UserMetric } from '../interfaces/metrics';

// Define InfoRecord locally for type compatibility
interface InfoRecord {
  key: string;
  type: string;
  updated: number;
  [key: string]: unknown;
}

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
  private readonly database = inject(DatabaseService);
  private readonly userData = inject(UserDataService);
  private readonly metrics = inject(Metrics);
  private readonly logger = inject(LoggerService);

  // In-memory cache of all following profiles
  private readonly profilesMap = signal<Map<string, FollowingProfile>>(new Map());

  // Loading state
  readonly isLoading = signal(false);
  readonly isInitialized = signal(false);

  // Computed array of all profiles for easy iteration
  readonly profiles = computed(() => Array.from(this.profilesMap().values()));

  // Count of following profiles
  readonly count = computed(() => this.profilesMap().size);

  // Track the previous following list to detect additions and removals
  private previousFollowingList: string[] = [];

  constructor() {
    // Effect to load profiles when account or following list changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const followingList = this.accountState.followingList();

      if (!pubkey || followingList.length === 0) {
        this.logger.debug('[FollowingService] No account or empty following list, clearing profiles');
        this.clear();
        this.previousFollowingList = [];
        return;
      }

      untracked(() => {
        // Check if this is an incremental change (add/remove) or a full reload
        // Initial load happens when:
        // 1. No previous following list was tracked, AND
        // 2. Service hasn't been initialized yet, OR profiles map is empty
        const isInitialLoad =
          this.previousFollowingList.length === 0 &&
          (!this.isInitialized() || this.profilesMap().size === 0);

        if (isInitialLoad) {
          // Initial load - load all profiles
          this.logger.info(`[FollowingService] Initial load of ${followingList.length} profiles`);
          this.loadProfiles(followingList);
        } else {
          // Incremental update - calculate diff and update accordingly
          this.handleIncrementalUpdate(followingList);
        }

        this.previousFollowingList = [...followingList];
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
      // For RETURNING users: Wait briefly for profile cache to be loaded from storage
      // For NEW users: Skip wait since there's no cache to wait for
      // Check if profile discovery has been done to determine if this is a returning user
      const pubkey = this.accountState.pubkey();
      const isReturningUser = pubkey && this.accountState.hasProfileDiscoveryBeenDone(pubkey);

      if (isReturningUser) {
        // Returning user - wait briefly for cache (reduced from 2s to 500ms)
        const maxWaitTime = 500;
        const pollInterval = 50;
        let waited = 0;

        while (!this.accountState.profileCacheLoaded() && waited < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          waited += pollInterval;
        }

        if (waited > 0) {
          this.logger.debug(`[FollowingService] Waited ${waited}ms for profile cache to load`);
        }
      } else {
        this.logger.debug('[FollowingService] New user - skipping cache wait');
      }

      // Create a new map to store all profiles
      const newMap = new Map<string, FollowingProfile>();
      let cachedCount = 0;
      let loadedCount = 0;

      // Load all profiles in parallel batches
      const batchSize = 50;
      for (let i = 0; i < pubkeys.length; i += batchSize) {
        const batch = pubkeys.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (pubkey) => {
            try {
              // Check if profile is already in the shared cache (populated by loadProfilesFromStorageToCache)
              const cachedProfile = this.accountState.getCachedProfile(pubkey);
              if (cachedProfile) {
                // Use cached profile data directly without making any requests
                cachedCount++;
                const now = Math.floor(Date.now() / 1000);
                const [infoRecord, trustMetrics, metricData] = await Promise.all([
                  this.database.getInfo(pubkey, 'user').catch(() => null) as Promise<InfoRecord | null>,
                  this.database.getInfo(pubkey, 'trust').catch(() => null),
                  this.metrics.getUserMetric(pubkey).catch(() => null),
                ]);
                newMap.set(pubkey, {
                  pubkey,
                  event: cachedProfile.event || null,
                  profile: cachedProfile,
                  info: infoRecord || null,
                  trust: trustMetrics as TrustMetrics | null,
                  metric: metricData,
                  lastUpdated: now,
                });
              } else {
                // Not in cache, load from storage/relay (with skipRelay=true for bulk load)
                loadedCount++;
                const profile = await this.loadSingleProfile(pubkey, true);
                newMap.set(pubkey, profile);
              }
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
      this.logger.info(`[FollowingService] Successfully loaded ${newMap.size} following profiles (${cachedCount} from cache, ${loadedCount} from storage)`);
    } catch (error) {
      this.logger.error('[FollowingService] Error loading profiles:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Handle incremental updates to the following list
   * Efficiently adds new profiles and removes unfollowed profiles
   */
  private async handleIncrementalUpdate(newFollowingList: string[]): Promise<void> {
    const previousList = this.previousFollowingList;

    // Find profiles to add (in new list but not in previous list)
    const toAdd = newFollowingList.filter(pubkey => !previousList.includes(pubkey));

    // Find profiles to remove (in previous list but not in new list)
    const toRemove = previousList.filter(pubkey => !newFollowingList.includes(pubkey));

    if (toAdd.length === 0 && toRemove.length === 0) {
      this.logger.debug('[FollowingService] No changes detected in following list');
      return;
    }

    this.logger.info(`[FollowingService] Incremental update: adding ${toAdd.length}, removing ${toRemove.length} profiles`);

    // Remove unfollowed profiles first (this is synchronous)
    if (toRemove.length > 0) {
      this.profilesMap.update(map => {
        const newMap = new Map(map);
        toRemove.forEach(pubkey => {
          newMap.delete(pubkey);
          this.logger.debug(`[FollowingService] Removed profile for ${pubkey}`);
        });
        return newMap;
      });
    }

    // Add new profiles (this is asynchronous)
    if (toAdd.length > 0) {
      await this.addProfiles(toAdd);
    }
  }

  /**
   * Add multiple profiles to the cache
   * Used for incremental updates when following new accounts
   */
  private async addProfiles(pubkeys: string[]): Promise<void> {
    this.logger.info(`[FollowingService] Adding ${pubkeys.length} new profiles...`);

    try {
      // Load profiles in parallel
      const profiles = await Promise.all(
        pubkeys.map(async (pubkey) => {
          try {
            // Fetch from relay for newly followed profiles to get fresh data
            const profile = await this.loadSingleProfile(pubkey, false);
            this.logger.debug(`[FollowingService] Loaded profile for newly followed ${pubkey}`);
            return { pubkey, profile };
          } catch (error) {
            this.logger.error(`[FollowingService] Failed to load profile for ${pubkey}:`, error);
            return { pubkey, profile: this.createMinimalProfile(pubkey) };
          }
        })
      );

      // Add all loaded profiles to the map in a single update
      this.profilesMap.update(map => {
        const newMap = new Map(map);
        profiles.forEach(({ pubkey, profile }) => {
          newMap.set(pubkey, profile);
        });
        return newMap;
      });

      this.logger.info(`[FollowingService] Successfully added ${profiles.length} new profiles`);
    } catch (error) {
      this.logger.error('[FollowingService] Error adding profiles:', error);
    }
  }

  /**
   * Load a single profile with all its data
   */
  private async loadSingleProfile(pubkey: string, skipRelay = false): Promise<FollowingProfile> {
    const now = Math.floor(Date.now() / 1000);

    // Load all data in parallel
    const [profileData, infoRecord, trustMetrics, metricData] = await Promise.all([
      this.userData.getProfile(pubkey, { skipRelay }).catch(() => null),
      this.database.getInfo(pubkey, 'user').catch(() => null) as Promise<InfoRecord | null>,
      this.database.getInfo(pubkey, 'trust').catch(() => null),
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
    this.previousFollowingList = [];
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
    sortBy: 'default' | 'reverse' | 'engagement-asc' | 'engagement-desc' | 'trust-asc' | 'trust-desc' | 'name-asc' | 'name-desc'
  ): FollowingProfile[] {
    const sorted = [...profiles];

    switch (sortBy) {
      case 'reverse':
        return sorted.reverse();

      case 'name-asc':
        return sorted.sort((a, b) => {
          const aDisplayName = ((a.profile?.data?.display_name as string) || '').trim();
          const aNameField = ((a.profile?.data?.name as string) || '').trim();
          const aName = aDisplayName || aNameField;

          const bDisplayName = ((b.profile?.data?.display_name as string) || '').trim();
          const bNameField = ((b.profile?.data?.name as string) || '').trim();
          const bName = bDisplayName || bNameField;

          // Check if names start with numbers/symbols (# category) or are empty
          const aIsSymbol = !aName || /^[^A-Za-z]/.test(aName);
          const bIsSymbol = !bName || /^[^A-Za-z]/.test(bName);

          // Sort symbols/numbers/empty to the end
          if (aIsSymbol && !bIsSymbol) return 1;
          if (!aIsSymbol && bIsSymbol) return -1;

          // If both are symbols/empty, compare pubkeys
          if (aIsSymbol && bIsSymbol) {
            return a.pubkey.localeCompare(b.pubkey);
          }

          return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
        });

      case 'name-desc':
        return sorted.sort((a, b) => {
          const aDisplayName = ((a.profile?.data?.display_name as string) || '').trim();
          const aNameField = ((a.profile?.data?.name as string) || '').trim();
          const aName = aDisplayName || aNameField;

          const bDisplayName = ((b.profile?.data?.display_name as string) || '').trim();
          const bNameField = ((b.profile?.data?.name as string) || '').trim();
          const bName = bDisplayName || bNameField;

          // Check if names start with numbers/symbols (# category) or are empty
          const aIsSymbol = !aName || /^[^A-Za-z]/.test(aName);
          const bIsSymbol = !bName || /^[^A-Za-z]/.test(bName);

          // Sort symbols/numbers/empty to the end (keep them at bottom even in desc)
          if (aIsSymbol && !bIsSymbol) return 1;
          if (!aIsSymbol && bIsSymbol) return -1;

          // If both are symbols/empty, compare pubkeys
          if (aIsSymbol && bIsSymbol) {
            return a.pubkey.localeCompare(b.pubkey);
          }

          return bName.localeCompare(aName, undefined, { sensitivity: 'base' });
        });

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

  /**
   * Update trust metrics for a specific profile
   * Called when trust metrics are fetched from the relay
   */
  updateTrustMetrics(pubkey: string, trust: TrustMetrics | null): void {
    const currentMap = this.profilesMap();
    const profile = currentMap.get(pubkey);

    if (!profile) {
      // Not in following list, nothing to update
      return;
    }

    // Update the trust metrics for this profile
    this.profilesMap.update((map) => {
      const newMap = new Map(map);
      const existingProfile = newMap.get(pubkey);
      if (existingProfile) {
        newMap.set(pubkey, {
          ...existingProfile,
          trust,
          lastUpdated: Math.floor(Date.now() / 1000),
        });
        this.logger.debug(`[FollowingService] Updated trust metrics for ${pubkey}`);
      }
      return newMap;
    });
  }
}
