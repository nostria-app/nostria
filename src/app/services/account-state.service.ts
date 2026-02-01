import { Injectable, computed, inject, signal, OnDestroy, effect } from '@angular/core';
import { Event, kinds, nip19, UnsignedEvent } from 'nostr-tools';
import { NostrRecord } from '../interfaces';
import { LocalStorageService } from './local-storage.service';
import { ApplicationStateService } from './application-state.service';
import { DataService } from './data.service';
import { DatabaseService } from './database.service';
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
import { PublishService } from './publish.service';

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
  private readonly database = inject(DatabaseService);
  private readonly utilities = inject(UtilitiesService);
  private readonly wallets = inject(Wallets);
  private readonly cache = inject(Cache);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly publishService = inject(PublishService);

  private destroy$ = new Subject<void>();

  // Function to sign events - must be set by NostrService to avoid circular dependency
  private signFunction?: (event: UnsignedEvent) => Promise<Event>;

  /**
   * Set the signing function. Called by NostrService during initialization.
   * This avoids circular dependency between AccountStateService and NostrService.
   */
  setSignFunction(signFn: (event: UnsignedEvent) => Promise<Event>): void {
    this.signFunction = signFn;
  }

  /**
   * Publish an event using the PublishService.
   * Replaces the old publish signal pattern.
   * 
   * @param event The unsigned event to publish
   * @param newlyFollowedPubkeys For kind 3 events, the newly followed pubkeys
   */
  private async publishEvent(event: UnsignedEvent, newlyFollowedPubkeys?: string[]): Promise<void> {
    if (!this.signFunction) {
      console.error('[AccountStateService] Sign function not set. Cannot publish event.');
      return;
    }

    try {
      await this.publishService.signAndPublishAuto(event, this.signFunction, newlyFollowedPubkeys);
    } catch (error) {
      console.error('[AccountStateService] Error publishing event:', error);
      throw error;
    }
  }

  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);

  // Signal to track if the following list has been loaded (even if empty)
  // This helps distinguish between "not loaded yet" vs "loaded but empty"
  followingListLoaded = signal(false);

  /** Use this signal to track if account has been loaded. */
  initialized = signal(false);
  account = signal<NostrUser | null>(null);
  accounts = signal<NostrUser[]>([]);

  // Signal to track when profile cache has been loaded from storage
  // FollowingService waits for this before making individual profile requests
  profileCacheLoaded = signal(false);

  // Signal to store pre-loaded account profiles for fast access
  accountProfiles = signal<Map<string, NostrRecord>>(new Map());

  // Flag to prevent multiple simultaneous profile preloading operations
  private isPreloadingProfiles = false;
  // Track the last set of account pubkeys we preloaded for
  private lastPreloadedAccountPubkeys = new Set<string>();
  // Track pending background profile loads to prevent duplicate requests
  private pendingProfileBackgroundLoads = new Set<string>();

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
  });

  // DEPRECATED: Legacy publish signal removed - use publishEvent() method instead
  // publish = signal<Event | UnsignedEvent | undefined>(undefined);
  // newlyFollowedPubkeys = signal<string[]>([]);

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
    if (!account || account.source === 'preview') {
      console.warn('No valid account is currently set to unfollow:', pubkey);
      return;
    }

    // Check if not following
    if (!this.followingList().includes(pubkey)) {
      console.log(`Not following ${pubkey}, cannot unfollow.`);
      return;
    }

    // CRITICAL: Get the existing following event from relay FIRST
    // This prevents overwriting changes made in other Nostria instances
    let existingFollowingEvent: Event | null = null;

    try {
      // Create a timeout promise that resolves to null after 2.5 seconds
      const timeoutPromise = new Promise<null>(resolve =>
        setTimeout(() => {
          console.warn('Timeout waiting for following list from relay (unfollow)');
          resolve(null);
        }, 2500)
      );

      existingFollowingEvent = await Promise.race([
        this.accountRelay.getEventByPubkeyAndKind(account.pubkey, kinds.Contacts),
        timeoutPromise,
      ]);
    } catch (error) {
      console.warn('Error fetching following list from relay (unfollow):', error);
    }

    if (existingFollowingEvent) {
      // Save fresh following list to storage
      await this.database.saveEvent(existingFollowingEvent);
      console.log('Fetched fresh following list from relay before unfollowing');
    } else {
      // Fallback to storage only if relay fetch fails
      console.warn('Could not fetch following list from relay, falling back to storage');
      existingFollowingEvent = await this.database.getEventByPubkeyAndKind([account.pubkey], 3);
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
      await this.publishEvent(newFollowingEvent);
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
      // Extensions typically inject window.nostr within 100-500ms of page load
      let dataLoaded = false;
      const checkNostrInterval = setInterval(() => {
        if (window.nostr) {
          clearInterval(checkNostrInterval);
          if (!dataLoaded) {
            dataLoaded = true;
            this.loadData();
          }
        }
      }, 50); // Check every 50ms for faster detection

      // Timeout after 1 second - if extension isn't available by then, proceed anyway
      // The user may not have a NIP-07 extension installed
      setTimeout(() => {
        clearInterval(checkNostrInterval);
        if (!dataLoaded) {
          dataLoaded = true;
          if (!window.nostr) {
            console.debug('window.nostr not available - extension may not be installed');
          }
          this.loadData();
        }
      }, 2000);
    } else {
      // Remote signing, readonly, etc.
      this.loadData();
    }
  }

  clear() {
    this.followingList.set([]);
    this.followingListLoaded.set(false); // Reset loading state when clearing
    this.profile.set(undefined);
    this.accountProfiles.set(new Map()); // Clear pre-loaded account profiles
    this.lastPreloadedAccountPubkeys.clear(); // Clear tracking set
    this.muteList.set(undefined); // Clear mute list
    // Note: We don't clear subscriptions as they are persistent across account changes
  }

  async follow(pubkeys: string | string[]) {
    const account = this.account();
    if (!account || account.source === 'preview') {
      console.warn('No valid account is currently set to follow:', pubkeys);
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
    let existingFollowingEvent: Event | null = null;

    try {
      // Create a timeout promise that resolves to null after 2.5 seconds
      // We want this to be fast so the UI doesn't feel unresponsive
      const timeoutPromise = new Promise<null>(resolve =>
        setTimeout(() => {
          console.warn('Timeout waiting for following list from relay');
          resolve(null);
        }, 2500)
      );

      existingFollowingEvent = await Promise.race([
        this.accountRelay.getEventByPubkeyAndKind(account.pubkey, kinds.Contacts),
        timeoutPromise,
      ]);
    } catch (error) {
      console.warn('Error fetching following list from relay:', error);
    }

    if (existingFollowingEvent) {
      // Save fresh following list to storage (relay always returns signed Event)
      await this.database.saveEvent(existingFollowingEvent);
      console.log('Fetched fresh following list from relay before following');
    } else {
      // Fallback to storage only if relay fetch fails
      console.warn('Could not fetch following list from relay, falling back to storage');
      existingFollowingEvent = await this.database.getEventByPubkeyAndKind([account.pubkey], 3);
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
      await this.publishEvent(newFollowingEvent, newPubkeys);
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

      // Filter out invalid pubkeys - some clients incorrectly put hashtag names in p-tags
      const validFollowingTags = followingTags.filter(pubkey => {
        const isValid = this.utilities.isValidPubkey(pubkey);
        if (!isValid) {
          console.warn('[AccountStateService] Invalid pubkey in following list:', pubkey);
          // console.log(JSON.stringify(event));
          // debugger; // Debug invalid pubkeys
        }
        return isValid;
      });

      // Get current following list to compare
      const currentFollowingList = this.followingList();

      // Check if the lists are different
      const hasChanged = !this.utilities.arraysEqual(currentFollowingList, validFollowingTags);
      if (hasChanged) {
        this.followingList.set(validFollowingTags);
        await this.database.saveEvent(event);
      }

      // Mark as loaded since we received a valid contacts event
      this.followingListLoaded.set(true);
    }
  }

  changeAccount(account: NostrUser | null): void {
    // Reset profile cache loaded flag when account changes
    // This ensures FollowingService waits for the new account's profiles to load
    this.profileCacheLoaded.set(false);

    // Reset following list loaded flag when account changes
    // This ensures UI doesn't show "not following anyone" while loading
    this.followingListLoaded.set(false);

    // Immediately set profile from cache if available
    // This provides instant UI update while async load happens in background
    if (account) {
      const cachedProfile = this.accountProfiles().get(account.pubkey);
      if (cachedProfile && !(cachedProfile as any).isEmpty) {
        // Found in pre-loaded account profiles - use it immediately
        this.profile.set(cachedProfile);
      } else {
        // Try the general profile cache as fallback
        const generalCached = this.getCachedProfile(account.pubkey);
        if (generalCached) {
          this.profile.set(generalCached);
        } else {
          // Clear profile - will be loaded async
          this.profile.set(undefined);
        }
      }
    } else {
      this.profile.set(undefined);
    }

    this.account.set(account);
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

    // Create a new array to ensure reactivity
    let updatedSubscriptions: Account[];

    if (existingIndex >= 0) {
      // Update existing subscription by creating new array with updated item
      updatedSubscriptions = [
        ...currentSubscriptions.slice(0, existingIndex),
        account,
        ...currentSubscriptions.slice(existingIndex + 1)
      ];
    } else {
      // Add new subscription by creating new array with new item
      updatedSubscriptions = [...currentSubscriptions, account];
    }

    this.localStorage.setObject(this.appState.SUBSCRIPTIONS_STORAGE_KEY, updatedSubscriptions);
    this.subscriptions.set(updatedSubscriptions);
  }

  /**
   * Force refresh subscription data from the API, bypassing cache
   * Use this when you need the latest subscription status (e.g., when viewing premium pages)
   * @returns Promise that resolves when the subscription has been refreshed
   */
  async refreshSubscription(): Promise<void> {
    const pubkey = this.pubkey();
    if (!this.account() || !pubkey) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.accountService
        .getAccount({}, new HttpContext().set(USE_NIP98, true))
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: accountObj => {
            // Create a copy with retrieved timestamp
            const accountWithTimestamp = { ...accountObj, retrieved: Date.now() };

            // Update the subscription in local storage and signal
            this.addSubscription(accountWithTimestamp);
            resolve();
          },
          error: err => {
            console.error('Failed to refresh subscription:', err);

            // Save error state to prevent repeated requests
            const subscription = this.subscription() || { pubkey };
            const errorSubscription = {
              ...subscription,
              retrieved: Date.now(),
              error: 'Failed to fetch account'
            } as any;

            this.addSubscription(errorSubscription);
            reject(err);
          },
        });
    });
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
      .getAccount({}, new HttpContext().set(USE_NIP98, true))
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

    console.log('🔄 [Profile Loading] Starting batch profile processing');
    console.log(`📊 [Profile Loading] Total profiles to load: ${pubkeys.length}`);
    console.log(`👤 [Profile Loading] Account: ${this.pubkey()?.substring(0, 8)}...`);

    this.profileProcessingState.set({
      isProcessing: true,
      total: pubkeys.length,
      processed: 0,
      currentProfile: '',
      startedAt: Date.now(),
    });

    const startTime = Date.now();

    try {
      // Use batch loading instead of individual requests
      const results = await dataService.batchLoadProfiles(
        pubkeys,
        (loaded, total, pubkey) => {
          this.profileProcessingState.update(state => ({
            ...state,
            processed: loaded,
            currentProfile: pubkey,
          }));
        }
      );

      // Add all loaded profiles to cache
      let successCount = 0;
      for (const [pubkey, profile] of results) {
        this.addToCache(pubkey, profile);
        successCount++;
      }

      const skippedCount = pubkeys.length - successCount;
      const duration = Date.now() - startTime;

      console.log(`✅ [Profile Loading] Batch processing completed in ${duration}ms`);
      console.log(`📈 [Profile Loading] Results: ${successCount} loaded, ${skippedCount} not found`);
      console.log(`💾 [Profile Loading] Total cached profiles: ${this.cache.keys().filter(k => k.startsWith('metadata-')).length}`);

      // Signal that cache loading is complete - FollowingService waits for this
      this.profileCacheLoaded.set(true);
    } catch (error) {
      console.error('❌ [Profile Loading] Failed to complete batch profile processing:', error);
      // Still mark as loaded on error so FollowingService doesn't wait forever
      this.profileCacheLoaded.set(true);
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

    // Add to cache with persistent options (no expiration, no size limit eviction)
    // Following profiles should stay in cache for the entire session
    this.cache.set(cacheKey, profile, {
      persistent: true,
      maxSize: Infinity, // No limit for followed profiles
    });
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
        // console.log(`⏭️ [Cache] Skipping older/same profile for ${pubkey.substring(0, 8)}... (existing: ${existingTimestamp}, new: ${newTimestamp})`);
        return; // Don't update, existing profile is newer or same age
      }
      console.log(`🔄 [Cache] Updating profile for ${pubkey.substring(0, 8)}... (${existingTimestamp} → ${newTimestamp})`);
    } else {
      // console.log(`➕ [Cache] Adding new profile for ${pubkey.substring(0, 8)}...`);
    }

    // Add to cache with persistent options (no expiration, no size limit eviction)
    // Following profiles should stay in cache for the entire session
    this.cache.set(cacheKey, profile, {
      persistent: true,
      maxSize: Infinity, // No limit for followed profiles
    });
  }

  // Method to search cached profiles
  searchProfiles(query: string): NostrRecord[] {
    if (!query || query.length < 1) {
      return [];
    }

    console.log(`🔍 [Profile Search] Searching for: "${query}"`);

    // Since we can't iterate over cache keys with the injected cache service,
    // we'll search through the following list and additional known pubkeys
    const pubkeysToSearch = [...this.followingList()];

    // Also add the current user's pubkey if available
    const currentPubkey = this.pubkey();
    if (currentPubkey && !pubkeysToSearch.includes(currentPubkey)) {
      pubkeysToSearch.push(currentPubkey);
    }

    console.log(`📊 [Profile Search] Searching through ${pubkeysToSearch.length} pubkeys`);

    const results: NostrRecord[] = [];
    const lowercaseQuery = query.toLowerCase();
    let cachedCount = 0;
    let notCachedCount = 0;

    for (const pubkey of pubkeysToSearch) {
      const cacheKey = `metadata-${pubkey}`;
      const profile = this.cache.get<NostrRecord>(cacheKey);
      if (!profile) {
        notCachedCount++;
        continue;
      }

      cachedCount++;
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

    console.log(`📈 [Profile Search] Results: ${results.length} matches found`);
    console.log(`💾 [Profile Search] Cache stats: ${cachedCount} cached, ${notCachedCount} not cached out of ${pubkeysToSearch.length} total`);

    if (notCachedCount > 0) {
      console.warn(`⚠️ [Profile Search] ${notCachedCount} profiles from following list are not in cache!`);
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
    // Check if we already have a pending load for this pubkey
    if (!this.pendingProfileBackgroundLoads.has(pubkey)) {
      this.pendingProfileBackgroundLoads.add(pubkey);
      setTimeout(() => this.loadAccountProfileInBackground(pubkey), 0);
    }

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
      } else {
        // Even if profile is not found, add a marker to prevent repeated requests
        // Use a minimal placeholder to indicate we tried but found nothing
        this.accountProfiles.update(profiles => {
          const newProfiles = new Map(profiles);
          newProfiles.set(pubkey, { isEmpty: true, pubkey } as unknown as NostrRecord);
          return newProfiles;
        });
      }
    } catch (error) {
      console.warn('Failed to load account profile in background:', pubkey, error);
      // Add empty placeholder to prevent repeated failed requests
      this.accountProfiles.update(profiles => {
        const newProfiles = new Map(profiles);
        newProfiles.set(pubkey, { isEmpty: true, pubkey, error: true } as unknown as NostrRecord);
        return newProfiles;
      });
    } finally {
      // Remove from pending set when done
      this.pendingProfileBackgroundLoads.delete(pubkey);
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
    databaseService: DatabaseService
  ): Promise<void> {
    if (!this.hasProfileDiscoveryBeenDone(pubkey)) {
      console.log(`⏭️ [Profile Loading] Skipping storage load - discovery not done for ${pubkey.substring(0, 8)}...`);
      // Still mark as loaded so FollowingService and DataService don't wait forever
      this.profileCacheLoaded.set(true);
      return; // Don't load if discovery hasn't been done
    }

    try {
      const followingList = this.followingList();
      if (followingList.length === 0) {
        console.log('⏭️ [Profile Loading] Skipping storage load - no following list');
        // Still mark as loaded so FollowingService and DataService don't wait forever
        this.profileCacheLoaded.set(true);
        return; // No following list to load profiles for
      }

      console.log(`📂 [Profile Loading] Loading profiles from storage for account: ${pubkey.substring(0, 8)}...`);
      console.log(`📊 [Profile Loading] Following list size: ${followingList.length}`);

      const startTime = Date.now();

      // Load metadata events from storage for all following users
      const events = await databaseService.getEventsByPubkeyAndKind(followingList, 0); // kind 0 is metadata

      // OPTIMIZATION: Deduplicate to keep only the latest event per pubkey
      // This avoids processing old duplicate metadata events
      const latestEventsByPubkey = new Map<string, Event>();
      const oldEventIds: string[] = [];

      for (const event of events) {
        const existing = latestEventsByPubkey.get(event.pubkey);
        if (!existing || event.created_at > existing.created_at) {
          // This is the newest event for this pubkey
          if (existing) {
            // Mark the older event for deletion
            oldEventIds.push(existing.id);
          }
          latestEventsByPubkey.set(event.pubkey, event);
        } else {
          // This event is older than what we already have
          oldEventIds.push(event.id);
        }
      }

      const deduplicatedEvents = Array.from(latestEventsByPubkey.values());
      const records = dataService.toRecords(deduplicatedEvents);

      console.log(`💾 [Profile Loading] Found ${events.length} metadata records in storage (${records.length} unique profiles)`);

      // Clean up old duplicate metadata events from database
      if (oldEventIds.length > 0) {
        console.log(`🧹 [Profile Loading] Cleaning up ${oldEventIds.length} old duplicate metadata events from database...`);
        await databaseService.deleteEvents(oldEventIds).catch(err => {
          console.error('❌ [Profile Loading] Failed to delete old metadata events:', err);
        });
      }

      // Add all found profiles to cache
      for (const record of records) {
        this.addToCache(record.event.pubkey, record);
      }

      const duration = Date.now() - startTime;
      const missingCount = followingList.length - records.length;

      console.log(`✅ [Profile Loading] Storage load completed in ${duration}ms`);
      console.log(`📈 [Profile Loading] Added ${records.length} profiles to cache`);
      if (missingCount > 0) {
        console.warn(`⚠️ [Profile Loading] Missing ${missingCount} profiles from storage (${followingList.length - records.length}/${followingList.length})`);
      }
      console.log(`💾 [Profile Loading] Total cached profiles now: ${this.cache.keys().filter(k => k.startsWith('metadata-')).length}`);

      // Signal that cache loading is complete - FollowingService waits for this
      this.profileCacheLoaded.set(true);
    } catch (error) {
      console.error('❌ [Profile Loading] Failed to load profiles from storage to cache:', error);
      // Still mark as loaded on error so FollowingService doesn't wait forever
      this.profileCacheLoaded.set(true);
    }
  }

  // Computed signals for different types of mutes
  mutedAccounts = computed(() => {
    const list = this.muteList();
    if (!list || !list.tags) return [];
    const pubkeys = list.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
    console.log('[AccountState] mutedAccounts computed updated, count:', pubkeys.length);
    return pubkeys;
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

    await this.publishEvent(currentMuteList);
  }

  // Add a method to clean up subscriptions if needed
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
