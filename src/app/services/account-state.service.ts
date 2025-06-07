import { Injectable, computed, inject, signal } from '@angular/core';
import { Event } from 'nostr-tools';
import { NostrRecord } from '../interfaces';
import { LocalStorageService } from './local-storage.service';
import { ApplicationStateService } from './application-state.service';
import { DataService } from './data.service';
import { StorageService } from './storage.service';
import { NostrService, NostrUser } from './nostr.service';

interface ProfileCacheEntry {
  profile: NostrRecord;
  cachedAt: number;
}

interface ProfileProcessingState {
  isProcessing: boolean;
  total: number;
  processed: number;
  currentProfile: string;
  startedAt: number;
}

interface ProcessingTracking {
  [pubkey: string]: {
    profileDiscovery: boolean;
    backupDiscovery: boolean;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AccountStateService {
  private localStorage = inject(LocalStorageService);
  private appState = inject(ApplicationStateService);

  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);

  // Current profile pubkey
  // currentProfilePubkey = signal<string>('');

  accountChanging = signal<string>('');

  account = signal<NostrUser | null>(null);

  pubkey = computed(() => {
    return this.account()?.pubkey || '';
  });

  profile = computed(() => {
    const account = this.account();

    if (account) {
      // If account is set, return its profile
      return this.getAccountProfile(account.pubkey);
    }

    return undefined
  });

  changeAccount(account: NostrUser | null): void {
    this.accountChanging.set(account?.pubkey || '');
    this.account.set(account);
  }

  muteList = signal<Event | undefined>(undefined);

  // Profile cache - in-memory cache for quick searches
  private userProfileCache = signal<Map<string, ProfileCacheEntry>>(new Map());
  private accountProfileCache = signal<Map<string, ProfileCacheEntry>>(new Map());

  // Processing state for toolbar indicator
  profileProcessingState = signal<ProfileProcessingState>({
    isProcessing: false,
    total: 0,
    processed: 0,
    currentProfile: '',
    startedAt: 0
  });

  // Computed signal for cache access
  cachedUserProfiles = computed(() => this.userProfileCache());
  cachedAccountProfiles = computed(() => this.accountProfileCache());

  // Computed signal for processing progress
  processingProgress = computed(() => {
    const state = this.profileProcessingState();
    if (state.total === 0) return 0;
    return Math.round((state.processed / state.total) * 100);
  });// nostr = inject(NostrService);

  publish = signal<Event | undefined>(undefined);

  constructor() {

  }

  // Methods for tracking processing state per account
  private getProcessingTracking(): ProcessingTracking {
    return this.localStorage.getObject<ProcessingTracking>(this.appState.PROCESSING_STORAGE_KEY) || {};
  }

  private saveProcessingTracking(tracking: ProcessingTracking): void {
    this.localStorage.setObject(this.appState.PROCESSING_STORAGE_KEY, tracking);
  }

  hasProfileDiscoveryBeenDone(pubkey: string): boolean {
    const tracking = this.getProcessingTracking();
    return tracking[pubkey]?.profileDiscovery === true;
  }

  markProfileDiscoveryDone(pubkey: string): void {
    const tracking = this.getProcessingTracking();
    if (!tracking[pubkey]) {
      tracking[pubkey] = { profileDiscovery: false, backupDiscovery: false };
    }
    tracking[pubkey].profileDiscovery = true;
    this.saveProcessingTracking(tracking);
  }

  // Public methods for checking/managing processing state
  hasBackupDiscoveryBeenDone(pubkey: string): boolean {
    const tracking = this.getProcessingTracking();
    return tracking[pubkey]?.backupDiscovery === true;
  }

  markBackupDiscoveryDone(pubkey: string): void {
    const tracking = this.getProcessingTracking();
    if (!tracking[pubkey]) {
      tracking[pubkey] = { profileDiscovery: false, backupDiscovery: false };
    }
    tracking[pubkey].backupDiscovery = true;
    this.saveProcessingTracking(tracking);
  }

  // Method to reset processing state for an account (useful for testing or forcing re-processing)
  resetProcessingState(pubkey: string): void {
    const tracking = this.getProcessingTracking();
    if (tracking[pubkey]) {
      delete tracking[pubkey];
      this.saveProcessingTracking(tracking);
    }
  }

  // Method to get processing state for debugging
  getProcessingState(pubkey: string): { profileDiscovery: boolean; backupDiscovery: boolean } {
    const tracking = this.getProcessingTracking();
    return tracking[pubkey] || { profileDiscovery: false, backupDiscovery: false };
  }

  // Method to start processing profiles
  async startProfileProcessing(pubkeys: string[], nostrService: NostrService): Promise<void> {
    // Don't start if already processing
    const currentState = this.profileProcessingState();
    if (currentState.isProcessing) {
      console.log('Profile processing already in progress, skipping...');
      return;
    }

    this.profileProcessingState.set({
      isProcessing: true,
      total: pubkeys.length,
      processed: 0,
      currentProfile: '',
      startedAt: Date.now()
    });

    try {
      // Get NostrService from the injector to avoid circular dependency
      // const { NostrService } = await import('./nostr.service');
      // const nostrService = this.injector.get(NostrService);

      // Use parallel processing with the optimized discovery queue
      await Promise.allSettled(
        pubkeys.map(async (pubkey) => {
          try {
            this.profileProcessingState.update(state => ({
              ...state,
              currentProfile: pubkey
            }));

            const profile = await nostrService.getMetadataForUser(pubkey);
            if (profile) {
              this.addToCache(pubkey, profile);
            }

            this.profileProcessingState.update(state => ({
              ...state,
              processed: state.processed + 1
            }));
          } catch (error) {
            console.error(`Failed to cache profile for ${pubkey}:`, error);
            this.profileProcessingState.update(state => ({
              ...state,
              processed: state.processed + 1
            }));
          }
        })
      );
    } catch (error) {
      console.error('Failed to start profile processing:', error);
    } finally {
      // Mark processing as complete only if we're still in the processing state
      // This prevents race conditions with restart attempts
      const finalState = this.profileProcessingState();
      if (finalState.isProcessing) {
        this.profileProcessingState.set({
          isProcessing: false,
          total: 0,
          processed: 0,
          currentProfile: '',
          startedAt: 0
        });
      }
    }
  }

  // Method to add profile to cache
  addToAccounts(pubkey: string, profile: NostrRecord): void {
    const cache = this.accountProfileCache();
    const existingEntry = cache.get(pubkey);

    // Check if profile already exists and is newer
    if (existingEntry) {
      // Compare created_at timestamps if available, otherwise use cached timestamp
      const existingTimestamp = existingEntry.profile.event.created_at || existingEntry.cachedAt;
      const newTimestamp = profile.event.created_at || Date.now();

      // Only update if the new profile is newer
      if (newTimestamp <= existingTimestamp) {
        return; // Don't update, existing profile is newer or same age
      }
    }

    const newCache = new Map(cache);

    newCache.set(pubkey, {
      profile,
      cachedAt: Date.now()
    });

    // Limit cache size to prevent memory issues
    if (newCache.size > 1000) {
      // Remove oldest entries
      const entries = Array.from(newCache.entries());
      entries.sort((a, b) => a[1].cachedAt - b[1].cachedAt);

      // Keep newest 800 entries
      const toKeep = entries.slice(-800);
      newCache.clear();
      toKeep.forEach(([key, value]) => newCache.set(key, value));
    }

    this.accountProfileCache.set(newCache);
  }

  // Method to add profile to cache
  addToCache(pubkey: string, profile: NostrRecord): void {
    const cache = this.userProfileCache();
    const existingEntry = cache.get(pubkey);

    // Check if profile already exists and is newer
    if (existingEntry) {
      // Compare created_at timestamps if available, otherwise use cached timestamp
      const existingTimestamp = existingEntry.profile.event.created_at || existingEntry.cachedAt;
      const newTimestamp = profile.event.created_at || Date.now();

      // Only update if the new profile is newer
      if (newTimestamp <= existingTimestamp) {
        return; // Don't update, existing profile is newer or same age
      }
    }

    const newCache = new Map(cache);

    newCache.set(pubkey, {
      profile,
      cachedAt: Date.now()
    });

    // Limit cache size to prevent memory issues
    if (newCache.size > 1000) {
      // Remove oldest entries
      const entries = Array.from(newCache.entries());
      entries.sort((a, b) => a[1].cachedAt - b[1].cachedAt);

      // Keep newest 800 entries
      const toKeep = entries.slice(-800);
      newCache.clear();
      toKeep.forEach(([key, value]) => newCache.set(key, value));
    }

    this.userProfileCache.set(newCache);
  }

  // Method to search cached profiles
  searchProfiles(query: string): NostrRecord[] {
    console.log('searchProfiles called with query:', query);
    if (!query || query.length < 2) {
      console.log('Query too short or empty, returning empty results');
      return [];
    }

    const cache = this.userProfileCache();
    console.log('Profile cache size:', cache.size);
    const results: NostrRecord[] = [];
    const lowercaseQuery = query.toLowerCase();

    for (const [pubkey, entry] of cache.entries()) {
      const profile = entry.profile;
      const data = profile.data;

      // Search in display name, name, about, and nip05
      const searchableText = [
        data.display_name || '',
        data.name || '',
        data.about || '',
        data.nip05 || '',
        pubkey
      ].join(' ').toLowerCase();

      if (searchableText.includes(lowercaseQuery)) {
        results.push(profile);
      }

      // Limit results to prevent overwhelming UI
      if (results.length >= 20) break;
    }

    return results.sort((a, b) => {
      // Prioritize display_name matches
      const aName = (a.data.display_name || a.data.name || '').toLowerCase();
      const bName = (b.data.display_name || b.data.name || '').toLowerCase();

      const aStartsWithQuery = aName.startsWith(lowercaseQuery);
      const bStartsWithQuery = bName.startsWith(lowercaseQuery);

      if (aStartsWithQuery && !bStartsWithQuery) return -1;
      if (!aStartsWithQuery && bStartsWithQuery) return 1;

      return aName.localeCompare(bName);
    });
  }

  // setCachedProfiles(profiles: NostrRecord[]): void {
  //   const cache = this.profileCache();
  //   const newCache = new Map(cache);

  //   profiles.forEach(profile => {
  //     newCache.set(profile.event.pubkey, {
  //       profile,
  //       cachedAt: Date.now()
  //     });
  //   });

  //   // Limit cache size to prevent memory issues
  //   if (newCache.size > 1000) {
  //     // Remove oldest entries
  //     const entries = Array.from(newCache.entries());
  //     entries.sort((a, b) => a[1].cachedAt - b[1].cachedAt);

  //     // Keep newest 800 entries
  //     const toKeep = entries.slice(-800);
  //     newCache.clear();
  //     toKeep.forEach(([key, value]) => newCache.set(key, value));
  //   }

  //   this.profileCache.set(newCache);
  // }

  // Method to get cached profile

  getAccountProfile(pubkey: string): NostrRecord | undefined {
    const cache = this.accountProfileCache();
    const entry = cache.get(pubkey);

    return entry?.profile;
  }

  getCachedProfile(pubkey: string): NostrRecord | undefined {
    const cache = this.userProfileCache();
    const entry = cache.get(pubkey);

    if (entry) {
      // Check if cache entry is not too old (24 hours)
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      if (Date.now() - entry.cachedAt < maxAge) {
        return entry.profile;
      } else {
        // Remove expired entry
        const newCache = new Map(cache);
        newCache.delete(pubkey);
        this.userProfileCache.set(newCache);
      }
    }

    return undefined;
  }

  // Method to clear cache
  clearProfileCache(): void {
    this.userProfileCache.set(new Map());
  }

  // Method to load profiles from storage into cache when profile discovery has been done
  async loadProfilesFromStorageToCache(pubkey: string, dataService: DataService, storageService: StorageService): Promise<void> {
    if (!this.hasProfileDiscoveryBeenDone(pubkey)) {
      return; // Don't load if discovery hasn't been done
    }

    try {
      const followingList = this.followingList();
      if (followingList.length === 0) {
        return; // No following list to load profiles for
      }

      // const { DataService } = await import('./data.service');
      // const dataService = this.injector.get(DataService);
      // const { StorageService } = await import('./storage.service');
      // const storageService = this.injector.get(StorageService);

      console.log('Loading profiles from storage to cache for account:', pubkey);
      console.log('Following list size:', followingList.length);

      // Load metadata events from storage for all following users
      const events = await storageService.getEventsByPubkeyAndKind(followingList, 0); // kind 0 is metadata
      const records = dataService.getRecords(events);

      console.log('Found metadata records in storage:', records.length);

      // Add all found profiles to cache
      for (const record of records) {
        this.addToCache(record.event.pubkey, record);
      }

      console.log('Profile cache populated with', records.length, 'profiles from storage');
    } catch (error) {
      console.error('Failed to load profiles from storage to cache:', error);
    }
  }

  // Method to get cache stats
  getCacheStats(): { size: number; oldestEntry: number; newestEntry: number } {
    const cache = this.userProfileCache();
    if (cache.size === 0) {
      return { size: 0, oldestEntry: 0, newestEntry: 0 };
    }

    const timestamps = Array.from(cache.values()).map(entry => entry.cachedAt);
    return {
      size: cache.size,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps)
    };
  }

  // Computed signals for different types of mutes
  mutedAccounts = computed(() => {
    const list = this.muteList();
    if (!list || !list.tags) return [];
    return list.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
  });

  mutedTags = computed(() => {
    const list = this.muteList();
    if (!list || !list.tags) return [];
    return list.tags.filter(tag => tag[0] === 't').map(tag => tag[1]);
  });

  mutedWords = computed(() => {
    const list = this.muteList();
    if (!list || !list.tags) return [];
    return list.tags.filter(tag => tag[0] === 'word').map(tag => tag[1]);
  });

  mutedThreads = computed(() => {
    const list = this.muteList();
    if (!list || !list.tags) return [];
    return list.tags.filter(tag => tag[0] === 'e').map(tag => tag[1]);
  });

  // Method to update mute list
  updateMuteList(muteEvent: Event): void {
    this.muteList.set(muteEvent);
  }

  muted(event: Event) {
    if (!event) {
      return;
    }

    return this.mutedAccounts().find(account => account === event.pubkey);
  }

  async mutePubkey(pubkey: string) {
    const currentMuteList = this.muteList();
    if (!currentMuteList) {
      console.warn('No mute list available to update.');
      return;
    }

    // Check if the pubkey is already muted
    if (this.mutedAccounts().includes(pubkey)) {
      console.log(`Pubkey ${pubkey} is already muted.`);
      return;
    }

    // Add the pubkey to the mute list
    currentMuteList.tags.push(['p', pubkey]);
    this.updateMuteList(currentMuteList);

    this.publish.set(currentMuteList);

    // await this.saveMuteList(currentMuteList);
  }

  // async saveMuteList(muteList: Event) {
  //   const event = await this.nostr.publish(muteList);
  //   this.updateMuteList(event);
  // }
}