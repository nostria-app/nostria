import { Injectable, computed, inject, signal, OnDestroy, effect } from '@angular/core';
import { Event, kinds, nip19, UnsignedEvent } from 'nostr-tools';
import { NostrRecord } from '../interfaces';
import { LocalStorageService } from './local-storage.service';
import { ApplicationStateService } from './application-state.service';
import { DataService } from './data.service';
import { StorageService } from './storage.service';
import { NostrUser } from './nostr.service';
import { AccountService } from '../api/services';
import { Account, Feature } from '../api/models';
import { Subject, takeUntil } from 'rxjs';
import { HttpContext } from '@angular/common/http';
import { USE_NIP98 } from './interceptors/nip98Auth';
import { UtilitiesService } from './utilities.service';
import { Wallets } from './wallets';
import { Cache } from './cache';
import { AccountRelayService } from './relays/account-relay';

interface ProfileProcessingState {
  isProcessing: boolean;
  total: number;
  processed: number;
  currentProfile: string;
  startedAt: number;
}

type ProcessingTracking = Record<
  string,
  {
    profileDiscovery: boolean;
    backupDiscovery: boolean;
  }
>;

@Injectable({
  providedIn: 'root',
})
export class AccountStateService implements OnDestroy {
  private readonly localStorage = inject(LocalStorageService);
  private readonly appState = inject(ApplicationStateService);
  private readonly data = inject(DataService);
  private readonly accountService = inject(AccountService);
  private readonly storage = inject(StorageService);
  private readonly utilities = inject(UtilitiesService);
  private readonly wallets = inject(Wallets);
  private readonly cache = inject(Cache);
  private readonly accountRelay = inject(AccountRelayService);

  private destroy$ = new Subject<void>();

  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);

  /** Use this signal to track if account has been loaded. */
  initialized = signal(false);
  account = signal<NostrUser | null>(null);
  accounts = signal<NostrUser[]>([]);

  // Signal to store pre-loaded account profiles for fast access
  accountProfiles = signal<Map<string, NostrRecord>>(new Map());

  // Flag to prevent multiple simultaneous profile preloading operations
  private isPreloadingProfiles = false;
  // Track the last set of account pubkeys we preloaded for
  private lastPreloadedAccountPubkeys = new Set<string>();

  hasAccounts = computed(() => {
    return this.accounts().length > 0;
  });

  pubkey = computed(() => {
    return this.account()?.pubkey || '';
  });

  npub = computed(() => {
    if (!this.account()) return '';
    return nip19.npubEncode(this.account()?.pubkey || '');
  });

  profile = signal<NostrRecord | undefined>(undefined);

  subscriptions = signal<Account[]>([]);

  subscription = computed(() => {
    const pubkey = this.pubkey();
    if (!pubkey) return undefined;

    const subs = this.subscriptions();
    return subs.find(sub => sub.pubkey === pubkey);
  });

  hasActiveSubscription = computed(() => {
    const subscription = this.subscription();
    return subscription?.expires && Date.now() < subscription.expires;
  });

  expiresWhen = computed(() => {
    const sub = this.subscription();
    return sub?.expires ? new Date(sub.expires) : null;
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

  muteList = signal<Event | undefined>(undefined);

  // Processing state for toolbar indicator
  profileProcessingState = signal<ProfileProcessingState>({
    isProcessing: false,
    total: 0,
    processed: 0,
    currentProfile: '',
    startedAt: 0,
  });

  // Computed signals for cache access - removed since we can't iterate over injected cache keys

  // Computed signal for processing progress
  processingProgress = computed(() => {
    const state = this.profileProcessingState();
    if (state.total === 0) return 0;
    return Math.round((state.processed / state.total) * 100);
  }); // nostr = inject(NostrService);

  // Signal to publish event
  publish = signal<Event | UnsignedEvent | undefined>(undefined);

  // Signal to store newly followed pubkeys for the current publish operation
  // This is used to notify only the newly followed users, not all followed users
  newlyFollowedPubkeys = signal<string[]>([]);

  constructor() {
    // Cache configuration is now handled by the injected cache service

    // Effect to pre-load account profiles when accounts change
    effect(() => {
      const accounts = this.accounts();
      if (accounts.length > 0 && !this.isPreloadingProfiles) {
        // Check if the set of accounts has actually changed
        const currentPubkeys = new Set(accounts.map(a => a.pubkey));
        const hasSameAccounts =
          currentPubkeys.size === this.lastPreloadedAccountPubkeys.size &&
          [...currentPubkeys].every(pubkey => this.lastPreloadedAccountPubkeys.has(pubkey));

        if (!hasSameAccounts) {
          // REMOVED, don't preload profiles.
          this.preloadAccountProfiles(accounts);
        }
      }
    });
  }

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

    // CRITICAL: Get the existing following event from relay FIRST
    // This prevents overwriting changes made in other Nostria instances
    let existingFollowingEvent = await this.accountRelay.getEventByPubkeyAndKind(account.pubkey, kinds.Contacts);

    if (existingFollowingEvent) {
      // Save fresh following list to storage
      await this.storage.saveEvent(existingFollowingEvent);
      console.log('Fetched fresh following list from relay before unfollowing');
    } else {
      // Fallback to storage only if relay fetch fails
      console.warn('Could not fetch following list from relay, falling back to storage');
      existingFollowingEvent = await this.storage.getEventByPubkeyAndKind([account.pubkey], 3);
    }

    if (!existingFollowingEvent) {
      console.warn('No existing following event found. Cannot unfollow.', pubkey);
      return;
    }

    // Get existing tags and remove the pubkey
    const updatedTags = existingFollowingEvent.tags.filter(tag => !(tag[0] === 'p' && tag[1] === pubkey));

    // CRITICAL: Create a NEW unsigned event with CURRENT timestamp
    // This ensures we don't reuse old timestamps from previously signed events
    const newFollowingEvent = this.utilities.createEvent(
      kinds.Contacts,
      existingFollowingEvent.content || '', // Preserve existing content if any
      updatedTags,
      account.pubkey
    );

    // Remove from following list
    this.followingList.update(list => list.filter(p => p !== pubkey));

    // Publish the event to update the following list
    try {
      this.publish.set(newFollowingEvent);
      console.log(`Unfollowed ${pubkey} successfully.`);
    } catch (error) {
      console.error(`Failed to unfollow ${pubkey}:`, error);
    }
  }

  isFollowing = computed(() => {
    // Return a function that checks if a given pubkey is being followed
    const following = this.followingList();
    return (pubkey: string) => following.includes(pubkey);
  });

  isCurrentUser(pubkey: string): boolean {
    return this.pubkey() === pubkey;
  }

  async load() {
    this.loadSubscriptions();

    const account = this.account();

    if (!account) {
      return;
    }

    const profile = await this.data.getProfile(account.pubkey);
    // const profile = await this.getAccountProfile(account.pubkey);
    this.profile.set(profile);

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
    this.accountProfiles.set(new Map()); // Clear pre-loaded account profiles
    this.lastPreloadedAccountPubkeys.clear(); // Clear tracking set
    this.muteList.set(undefined); // Clear mute list
    // Note: We don't clear subscriptions as they are persistent across account changes
  }

  async follow(pubkeys: string | string[]) {
    const account = this.account();
    if (!account) {
      console.warn('No account is currently set to follow:', pubkeys);
      return;
    }

    // Normalize input to always be an array
    const pubkeyArray = Array.isArray(pubkeys) ? pubkeys : [pubkeys];

    console.log('[AccountStateService] DEBUG follow() called:', {
      inputPubkeys: pubkeyArray.map(pk => pk.slice(0, 16)),
      currentFollowing: this.followingList().length,
    });

    // Filter out pubkeys that are already being followed
    const currentFollowing = this.followingList();
    const newPubkeys = pubkeyArray.filter(pubkey => !currentFollowing.includes(pubkey));

    console.log('[AccountStateService] DEBUG after filtering:', {
      newPubkeysCount: newPubkeys.length,
      newPubkeysList: newPubkeys.map(pk => pk.slice(0, 16)),
    });

    if (newPubkeys.length === 0) {
      console.log('All specified pubkeys are already being followed - RETURNING EARLY');
      return;
    }

    // CRITICAL: Get the existing following event from relay FIRST
    // This prevents overwriting changes made in other Nostria instances
    let existingFollowingEvent: Event | null = await this.accountRelay.getEventByPubkeyAndKind(
      account.pubkey,
      kinds.Contacts
    );

    if (existingFollowingEvent) {
      // Save fresh following list to storage (relay always returns signed Event)
      await this.storage.saveEvent(existingFollowingEvent);
      console.log('Fetched fresh following list from relay before following');
    } else {
      // Fallback to storage only if relay fetch fails
      console.warn('Could not fetch following list from relay, falling back to storage');
      existingFollowingEvent = await this.storage.getEventByPubkeyAndKind([account.pubkey], 3);
    }

    // Get existing tags (p-tags for followed users)
    let existingTags: string[][] = [];

    if (existingFollowingEvent) {
      // Extract all existing tags
      existingTags = existingFollowingEvent.tags;
    }

    // Add new pubkeys to the tags
    for (const pubkey of newPubkeys) {
      if (!existingTags.some(tag => tag[0] === 'p' && tag[1] === pubkey)) {
        existingTags.push(['p', pubkey]);
      }
    }

    // CRITICAL: Create a NEW unsigned event with CURRENT timestamp
    // This ensures we don't reuse old timestamps from previously signed events
    const newFollowingEvent = this.utilities.createEvent(
      kinds.Contacts,
      existingFollowingEvent?.content || '', // Preserve existing content if any
      existingTags,
      account.pubkey
    );

    // Add all new pubkeys to following list
    this.followingList.update(list => [...list, ...newPubkeys]);

    // Store the newly followed pubkeys for the publish operation
    this.newlyFollowedPubkeys.set(newPubkeys);

    console.log('[AccountStateService] DEBUG: About to publish follow event:', {
      newPubkeysCount: newPubkeys.length,
      newPubkeysList: newPubkeys.map(pk => pk.slice(0, 16)),
      totalTagsCount: existingTags.length,
      eventKind: newFollowingEvent.kind,
      eventCreatedAt: newFollowingEvent.created_at,
      currentTime: Math.floor(Date.now() / 1000),
    });

    // Publish the event to update the following list (single operation)
    try {
      this.publish.set(newFollowingEvent);
      console.log(`Followed ${newPubkeys.length} pubkey(s) successfully:`, newPubkeys);
    } catch (error) {
      console.error(`Failed to follow pubkey(s):`, error);
      // Rollback the local state if publish failed
      this.followingList.update(list => list.filter(pubkey => !newPubkeys.includes(pubkey)));
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
      this.accounts.update(u =>
        u.map(existingUser => (existingUser.pubkey === account.pubkey ? account : existingUser))
      );
    }
  }

  loadSubscriptions() {
    const subscriptions = this.localStorage.getObject<Account[]>(
      this.appState.SUBSCRIPTIONS_STORAGE_KEY
    );
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

    // If there was an error, retry only after 1 day
    if (
      subscription &&
      subscription.error &&
      subscription.retrieved &&
      Date.now() - subscription.retrieved < 24 * 60 * 60 * 1000
    ) {
      return;
    }

    // Don't fetch if data is less than 3 days old and no error
    if (
      subscription &&
      !subscription.error &&
      subscription.retrieved &&
      Date.now() - subscription.retrieved < 3 * 24 * 60 * 60 * 1000
    ) {
      return;
    }

    this.accountService
      .getAccount(pubkey, new HttpContext().set(USE_NIP98, true))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: accountObj => {
          // Create a copy with lastRetrieved property
          const accountWithTimestamp = { ...accountObj, retrieved: Date.now() };

          // Add the subscription to the local storage
          this.addSubscription(accountWithTimestamp);
        },
        error: err => {
          console.error('Failed to fetch account:', err);

          // Always save the error state to prevent repeated requests
          const errorSubscription = subscription || { pubkey };
          errorSubscription.retrieved = Date.now();
          errorSubscription.error = 'Failed to fetch account';
          // Add the subscription to the local storage
          this.addSubscription(errorSubscription);
        },
      });
  }

  /**
   * Pre-loads profiles for all accounts to avoid repeated async calls in templates
   */
  private async preloadAccountProfiles(accounts: NostrUser[]): Promise<void> {
    // Prevent multiple simultaneous preloading operations
    if (this.isPreloadingProfiles) {
      return;
    }

    this.isPreloadingProfiles = true;
    console.log('Pre-loading profiles for', accounts.length, 'accounts');

    try {
      for (const account of accounts) {
        try {
          // Check if profile is already loaded and cached
          const existingProfile = this.accountProfiles().get(account.pubkey);
          if (existingProfile) {
            continue; // Skip if already loaded
          }

          // Load profile using the existing method
          const profile = await this.loadAccountProfileInternal(account.pubkey);
          if (profile) {
            // Update the profiles map
            this.accountProfiles.update(profiles => {
              const newProfiles = new Map(profiles);
              newProfiles.set(account.pubkey, profile);
              return newProfiles;
            });
            console.log('Pre-loaded profile for account:', account.pubkey);
          }
        } catch (error) {
          console.warn('Failed to pre-load profile for account:', account.pubkey, error);
        }
      }

      // Update the tracking set
      this.lastPreloadedAccountPubkeys = new Set(accounts.map(a => a.pubkey));
    } finally {
      this.isPreloadingProfiles = false;
    }
  }

  /**
   * Internal method to load account profile without caching in the accountProfiles signal
   */
  private async loadAccountProfileInternal(pubkey: string): Promise<NostrRecord | undefined> {
    const record = await this.data.getEventByPubkeyAndKind(pubkey, kinds.Metadata, {
      cache: true,
      save: true,
    });

    if (record == null) {
      return undefined;
    }

    return record;
  }

  // Methods for tracking processing state per account
  private getProcessingTracking(): ProcessingTracking {
    return (
      this.localStorage.getObject<ProcessingTracking>(this.appState.PROCESSING_STORAGE_KEY) || {}
    );
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
  getProcessingState(pubkey: string): {
    profileDiscovery: boolean;
    backupDiscovery: boolean;
  } {
    const tracking = this.getProcessingTracking();
    return tracking[pubkey] || { profileDiscovery: false, backupDiscovery: false };
  }

  // Method to start processing profiles
  async startProfileProcessing(
    pubkeys: string[],
    dataService: DataService,
    onComplete?: () => void
  ): Promise<void> {
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
      startedAt: Date.now(),
    });

    try {
      // Use parallel processing with the optimized discovery queue
      await Promise.allSettled(
        pubkeys.map(async pubkey => {
          try {
            this.profileProcessingState.update(state => ({
              ...state,
              currentProfile: pubkey,
            }));

            const profile = await dataService.getProfile(pubkey);

            if (profile) {
              this.addToCache(pubkey, profile);
            }

            this.profileProcessingState.update(state => ({
              ...state,
              processed: state.processed + 1,
            }));
          } catch (error) {
            console.error(`Failed to cache profile for ${pubkey}:`, error);
            this.profileProcessingState.update(state => ({
              ...state,
              processed: state.processed + 1,
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
          startedAt: 0,
        });

        // Call the completion callback if provided
        if (onComplete) {
          try {
            onComplete();
          } catch (error) {
            console.error('Error in profile processing completion callback:', error);
          }
        }
      }
    }
  }

  // Method to add profile to account cache
  addToAccounts(pubkey: string, profile: NostrRecord): void {
    const cacheKey = `metadata-${pubkey}`;
    const existingProfile = this.cache.get<NostrRecord>(cacheKey);

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

    // Add to cache
    this.cache.set(cacheKey, profile);
  }

  // Method to add profile to user cache
  addToCache(pubkey: string, profile: NostrRecord): void {
    const cacheKey = `metadata-${pubkey}`;
    const existingProfile = this.cache.get<NostrRecord>(cacheKey);

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

    // Add to cache
    this.cache.set(cacheKey, profile);
  }

  // Method to search cached profiles
  searchProfiles(query: string): NostrRecord[] {
    if (!query || query.length < 1) {
      return [];
    }

    // Since we can't iterate over cache keys with the injected cache service,
    // we'll search through the following list and additional known pubkeys
    const pubkeysToSearch = [...this.followingList()];

    // Also add the current user's pubkey if available
    const currentPubkey = this.pubkey();
    if (currentPubkey && !pubkeysToSearch.includes(currentPubkey)) {
      pubkeysToSearch.push(currentPubkey);
    }

    const results: NostrRecord[] = [];
    const lowercaseQuery = query.toLowerCase();

    for (const pubkey of pubkeysToSearch) {
      const cacheKey = `metadata-${pubkey}`;
      const profile = this.cache.get<NostrRecord>(cacheKey);
      if (!profile) continue;

      const data = profile.data;

      // Search in display name, name, about, and nip05
      const searchableText = [
        data.display_name || '',
        data.name || '',
        data.about || '',
        data.nip05 || '',
        pubkey,
      ]
        .join(' ')
        .toLowerCase();

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

  // Method to get cached account profile
  // async getAccountProfile(pubkey: string): Promise<NostrRecord | undefined> {
  //   // First check if we have a pre-loaded profile
  //   // const preloadedProfile = this.accountProfiles().get(pubkey);
  //   // if (preloadedProfile) {
  //   //   return preloadedProfile;
  //   // }

  //   // Fall back to loading and caching the profile
  //   const record = await this.loadAccountProfileInternal(pubkey);

  //   if (record) {
  //     // Cache it in the accountProfiles signal for future use
  //     this.accountProfiles.update((profiles) => {
  //       const newProfiles = new Map(profiles);
  //       newProfiles.set(pubkey, record);
  //       return newProfiles;
  //     });
  //   }

  //   return record;
  // }

  /**
   * Synchronous method to get pre-loaded account profile for templates
   * Returns undefined if profile hasn't been pre-loaded yet
   * 
   * Now with fallback to cache for better reliability
   * IMPORTANT: Does NOT write to signals to avoid NG0600 error
   */
  getAccountProfileSync(pubkey: string): NostrRecord | undefined {
    // First check pre-loaded profiles
    const preloaded = this.accountProfiles().get(pubkey);
    if (preloaded) {
      return preloaded;
    }

    // Fallback to cache if not pre-loaded
    const cached = this.getCachedProfile(pubkey);
    if (cached) {
      // Schedule update for next tick to avoid writing during render
      setTimeout(() => {
        this.accountProfiles.update(profiles => {
          const newProfiles = new Map(profiles);
          newProfiles.set(pubkey, cached);
          return newProfiles;
        });
      }, 0);
      return cached;
    }

    // If not found anywhere, trigger async load in background
    // Use setTimeout to schedule for next tick
    setTimeout(() => this.loadAccountProfileInBackground(pubkey), 0);

    return undefined;
  }

  /**
   * Load account profile in background and update the signal when ready
   */
  private async loadAccountProfileInBackground(pubkey: string): Promise<void> {
    try {
      const profile = await this.loadAccountProfileInternal(pubkey);
      if (profile) {
        this.accountProfiles.update(profiles => {
          const newProfiles = new Map(profiles);
          newProfiles.set(pubkey, profile);
          return newProfiles;
        });
      }
    } catch (error) {
      console.warn('Failed to load account profile in background:', pubkey, error);
    }
  }

  getCachedProfile(pubkey: string): NostrRecord | undefined {
    // The Cache service handles TTL automatically, so no need to check age manually
    const cacheKey = `metadata-${pubkey}`;
    return this.cache.get<NostrRecord>(cacheKey) || undefined;
  }

  // Method to load profiles from storage into cache when profile discovery has been done
  async loadProfilesFromStorageToCache(
    pubkey: string,
    dataService: DataService,
    storageService: StorageService
  ): Promise<void> {
    if (!this.hasProfileDiscoveryBeenDone(pubkey)) {
      return; // Don't load if discovery hasn't been done
    }

    try {
      const followingList = this.followingList();
      if (followingList.length === 0) {
        return; // No following list to load profiles for
      }

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
  }

  // Add a method to clean up subscriptions if needed
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
