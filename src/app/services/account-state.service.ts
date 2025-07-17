import { Injectable, computed, inject, signal } from '@angular/core';
import { Event, kinds, nip19, UnsignedEvent } from 'nostr-tools';
import { NostrRecord } from '../interfaces';
import { LocalStorageService } from './local-storage.service';
import { ApplicationStateService } from './application-state.service';
import { DataService } from './data.service';
import { StorageService } from './storage.service';
import { NostrService, NostrUser } from './nostr.service';
import { AccountService } from '../api/services';
import { Account, Feature, Tier } from '../api/models';
import { Subject, takeUntil } from 'rxjs';
import { HttpContext } from '@angular/common/http';
import { USE_NIP98 } from './interceptors/nip98Auth';
import { UtilitiesService } from './utilities.service';
import { Wallets } from './wallets';
import { Cache } from './cache';

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
  private readonly localStorage = inject(LocalStorageService);
  private readonly appState = inject(ApplicationStateService);
  private readonly accountService = inject(AccountService);
  private readonly storage = inject(StorageService);
  private readonly utilities = inject(UtilitiesService);
  private readonly wallets = inject(Wallets);
  private readonly cache = inject(Cache);

  private destroy$ = new Subject<void>();

  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);

  /** Use this signal to track if account has been loaded. */
  initialized = signal(false);
  account = signal<NostrUser | null>(null);
  accounts = signal<NostrUser[]>([]);

  hasAccounts = computed(() => {
    return this.accounts().length > 0;
  });

  pubkey = computed(() => {
    return this.account()?.pubkey || '';
  });

  npub = computed(() => {
    if (!this.account()) return '';
    return nip19.npubEncode(this.account()?.pubkey || '');
  })

  profile = signal<NostrRecord | undefined>(undefined);

  subscriptions = signal<Account[]>([]);

  subscription = computed(() => {
    const pubkey = this.pubkey();
    if (!pubkey) return undefined;

    const subs = this.subscriptions();
    return subs.find(sub => sub.pubkey === pubkey);
  });

  profilePath = computed(() => {
    const sub = this.subscription();
    const username = sub?.username;
    if (username && this.hasFeature('USERNAME' as Feature)) {
      return `/u/${username}`;
    } else {
      return `/p/${this.npub()}`;
    }
  });

  hasFeature(feature: Feature): boolean {
    const sub = this.subscription();
    if (!sub) return false;
    const features = (sub.entitlements?.features || []) as any as Feature[];
    return features.includes(feature);
  }

  async unfollow(pubkey: string) {
    const account = this.account();
    if (!account) {
      console.warn('No account is currently set to unfollow:', pubkey);
      return;
    }

    // Check if not following
    if (!this.followingList().includes(pubkey)) {
      console.log(`Not following ${pubkey}, cannot unfollow.`);
      return;
    }

    // Get the existing following event so we don't loose existing structure.
    // Ensure we keep original 'content' and relays/pet names.
    let followingEvent = await this.storage.getEventByPubkeyAndKind([account.pubkey], 3);

    if (!followingEvent) {
      console.warn('No existing following event found. Cannot unfollow.', pubkey);
      return;
    }

    // Remove the pubkey from the following list in the event
    followingEvent.tags = followingEvent.tags.filter(tag => !(tag[0] === 'p' && tag[1] === pubkey));

    // Remove from following list
    this.followingList.update(list => list.filter(p => p !== pubkey));

    // Publish the event to update the following list
    try {
      this.publish.set(followingEvent);
      console.log(`Unfollowed ${pubkey} successfully.`);
    } catch (error) {
      console.error(`Failed to unfollow ${pubkey}:`, error);
    }
  }

  isFollowing = computed(() => {

  });

  isCurrentUser(pubkey: string): boolean {
    return this.pubkey() === pubkey;
  }

  async load() {
    const account = this.account();

    if (!account) {
      return;
    }

    this.profile.set(this.getAccountProfile(account.pubkey));

    // TODO: Improve this!
    if (account.source === 'nsec') {
      this.loadData();
    } else if (account.source === 'extension') {
      // Check for window.nostr availability with interval
      const checkNostrInterval = setInterval(() => {
        if (window.nostr) {
          clearInterval(checkNostrInterval);
          this.loadData();
        }
      }, 100); // Check every 100ms

      // Optional: Add a timeout to prevent infinite checking
      setTimeout(() => {
        clearInterval(checkNostrInterval);
        console.warn('Timeout waiting for window.nostr to become available');
      }, 10000); // Stop checking after 10 seconds
    } else {
      // Remote signing, readonly, etc.
      this.loadData();
    }
  }

  clear() {
    this.followingList.set([]);
    this.profile.set(undefined);
  }

  async follow(pubkey: string) {
    const account = this.account();
    if (!account) {
      console.warn('No account is currently set to follow:', pubkey);
      return;
    }

    // Check if already following
    if (this.followingList().includes(pubkey)) {
      console.log(`Already following ${pubkey}`);
      return;
    }

    // Get the existing following event so we don't loose existing structure.
    // Ensure we keep original 'content' and relays/pet names.
    let followingEvent: Event | UnsignedEvent | null = await this.storage.getEventByPubkeyAndKind([account.pubkey], 3);

    if (!followingEvent) {
      console.warn('No existing following event found. This might result in overwriting this event on unknown relays.', pubkey);
      followingEvent = this.utilities.createEvent(kinds.Contacts, "", [[`p`, pubkey]], account.pubkey);
    } else {
      // Add the pubkey from the following list in the event, if not already present
      if (!followingEvent.tags.some(tag => tag[0] === 'p' && tag[1] === pubkey)) {
        followingEvent.tags.push(['p', pubkey]);
      } else {
        console.log(`Pubkey ${pubkey} is already in the following list.`);
        return;
      }
    }

    // Add to following list
    this.followingList.update(list => [...list, pubkey]);

    // Publish the event to update the following list
    try {
      this.publish.set(followingEvent);
      console.log(`Followed ${pubkey} successfully.`);
    } catch (error) {
      console.error(`Failed to unfollow ${pubkey}:`, error);
    }
  }

  async parseFollowingList(event: Event) {
    if (event) {
      const followingTags = this.utilities.getTags(event, 'p');

      // Get current following list to compare
      const currentFollowingList = this.followingList();

      // Check if the lists are different
      const hasChanged = !this.utilities.arraysEqual(currentFollowingList, followingTags);
      if (hasChanged) {
        this.followingList.set(followingTags);
        await this.storage.saveEvent(event);
      }
    }
  }

  changeAccount(account: NostrUser | null): void {
    // this.accountChanging.set(account?.pubkey || '');
    this.account.set(account);

    // if (!account) {
    //   this.profile.set(undefined);
    //   return;
    // } else {

    // }
  }

  updateAccount(account: NostrUser) {
    // Update lastUsed timestamp
    const allAccounts = this.accounts();
    const existingAccountIndex = allAccounts.findIndex(u => u.pubkey === account.pubkey);

    if (existingAccountIndex >= 0) {
      this.accounts.update(u => u.map(existingUser => existingUser.pubkey === account.pubkey ? account : existingUser));
    }
  }

  loadSubscriptions() {
    const subscriptions = this.localStorage.getObject<Account[]>(this.appState.SUBSCRIPTIONS_STORAGE_KEY);
    this.subscriptions.set(subscriptions || []);
  }

  addSubscription(account: Account) {
    const currentSubscriptions = this.subscriptions();
    const existingIndex = currentSubscriptions.findIndex(sub => sub.pubkey === account.pubkey);

    if (existingIndex >= 0) {
      // Update existing subscription
      currentSubscriptions[existingIndex] = account;
    } else {
      // Add new subscription
      currentSubscriptions.push(account);
    }

    this.localStorage.setObject(this.appState.SUBSCRIPTIONS_STORAGE_KEY, currentSubscriptions);
    this.subscriptions.set(currentSubscriptions);
  }

  private loadData() {
    const pubkey = this.pubkey();

    if (!this.account()) {
      return;
    }

    const subscription = this.subscription() as any;

    // Don't fetch if data is less than 3 days old
    if (subscription && Date.now() - subscription.retrieved < 3 * 24 * 60 * 60 * 1000) {
      return;
    }

    this.accountService.getAccount(pubkey, new HttpContext().set(USE_NIP98, true))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (accountObj) => {
          // this.accountSubscription.set(accountObj);

          // Create a copy with lastRetrieved property
          const accountWithTimestamp = { ...accountObj, retrieved: Date.now() };

          // Add the subscription to the local storage
          this.addSubscription(accountWithTimestamp);
        },
        error: (err) => {
          console.error('Failed to fetch account:', err);
          // this.accountSubscription.set(undefined);
        }
      });
  }

  muteList = signal<Event | undefined>(undefined);

  // Profile caches using Cache service
  private userProfileCache = new Cache();
  private accountProfileCache = new Cache();

  // Processing state for toolbar indicator
  profileProcessingState = signal<ProfileProcessingState>({
    isProcessing: false,
    total: 0,
    processed: 0,
    currentProfile: '',
    startedAt: 0
  });

  // Computed signals for cache access
  cachedUserProfiles = computed(() => {
    const keys = this.userProfileCache.keys();
    const profiles: NostrRecord[] = [];
    for (const key of keys) {
      const profile = this.userProfileCache.get<NostrRecord>(key);
      if (profile) {
        profiles.push(profile);
      }
    }
    return profiles;
  });

  cachedAccountProfiles = computed(() => {
    const keys = this.accountProfileCache.keys();
    const profiles: NostrRecord[] = [];
    for (const key of keys) {
      const profile = this.accountProfileCache.get<NostrRecord>(key);
      if (profile) {
        profiles.push(profile);
      }
    }
    return profiles;
  });

  // Computed signal for processing progress
  processingProgress = computed(() => {
    const state = this.profileProcessingState();
    if (state.total === 0) return 0;
    return Math.round((state.processed / state.total) * 100);
  });// nostr = inject(NostrService);

  // Signal to publish event
  publish = signal<Event | UnsignedEvent | undefined>(undefined);

  constructor() {
    // Configure the caches with specific options
    this.userProfileCache.configure({ maxSize: 300, ttl: 24 * 60 * 60 * 1000 }); // 24 hours TTL, max 300 entries
    this.accountProfileCache.configure({ persistent: true, maxSize: 1000 }); // Persistent, max 1000 entries
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

  // Method to add profile to account cache
  addToAccounts(pubkey: string, profile: NostrRecord): void {
    const existingProfile = this.accountProfileCache.get<NostrRecord>(pubkey);

    // Check if profile already exists and is newer
    if (existingProfile) {
      // Compare created_at timestamps if available
      const existingTimestamp = existingProfile.event.created_at || 0;
      const newTimestamp = profile.event.created_at || Date.now();

      // Only update if the new profile is newer
      if (newTimestamp <= existingTimestamp) {
        return; // Don't update, existing profile is newer or same age
      }
    }

    // Add to cache with persistent option
    this.accountProfileCache.set(pubkey, profile, { persistent: true });
  }

  // Method to add profile to user cache
  addToCache(pubkey: string, profile: NostrRecord): void {
    const existingProfile = this.userProfileCache.get<NostrRecord>(pubkey);

    // Check if profile already exists and is newer
    if (existingProfile) {
      // Compare created_at timestamps if available
      const existingTimestamp = existingProfile.event.created_at || 0;
      const newTimestamp = profile.event.created_at || Date.now();

      // Only update if the new profile is newer
      if (newTimestamp <= existingTimestamp) {
        return; // Don't update, existing profile is newer or same age
      }
    }

    // Add to cache with max size limit of 300
    this.userProfileCache.set(pubkey, profile, { maxSize: 300 });
  }

  // Method to search cached profiles
  searchProfiles(query: string): NostrRecord[] {
    console.log('searchProfiles called with query:', query);
    if (!query || query.length < 1) {
      return [];
    }

    const cacheKeys = this.userProfileCache.keys();
    console.log('Profile cache size:', cacheKeys.length);
    const results: NostrRecord[] = [];
    const lowercaseQuery = query.toLowerCase();

    for (const pubkey of cacheKeys) {
      const profile = this.userProfileCache.get<NostrRecord>(pubkey);
      if (!profile) continue;

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

  // Method to get cached account profile
  getAccountProfile(pubkey: string): NostrRecord | undefined {
    return this.accountProfileCache.get<NostrRecord>(pubkey) || undefined;
  }

  getCachedProfile(pubkey: string): NostrRecord | undefined {
    // The Cache service handles TTL automatically, so no need to check age manually
    return this.userProfileCache.get<NostrRecord>(pubkey) || undefined;
  }

  // Method to clear cache
  clearProfileCache(): void {
    this.userProfileCache.clear();
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
      const records = dataService.toRecords(events);

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
    const stats = this.userProfileCache.stats();
    const cacheKeys = this.userProfileCache.keys();
    
    if (cacheKeys.length === 0) {
      return { size: 0, oldestEntry: 0, newestEntry: 0 };
    }

    // Get timestamp information from cache entries
    const entries = this.userProfileCache.entries<NostrRecord>();
    const timestamps = entries.map(([_, entry]) => entry.timestamp);
    
    return {
      size: stats.size,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : 0
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

  // Add a method to clean up subscriptions if needed
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}