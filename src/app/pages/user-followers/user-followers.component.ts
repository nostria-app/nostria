import { Component, inject, signal, computed, effect, untracked, ChangeDetectionStrategy, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatMenuModule } from '@angular/material/menu';
import { MatRadioModule } from '@angular/material/radio';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { kinds } from 'nostr-tools';

import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { AccountStateService } from '../../services/account-state.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { UtilitiesService } from '../../services/utilities.service';
import { DataService } from '../../services/data.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { NostrRecord } from '../../interfaces';
import { UserRelayService } from '../../services/relays/user-relay';
import { RelayPoolService } from '../../services/relays/relay-pool';

interface UserProfile {
  id: string;
  npub: string;
  name: string;
  picture: string | null;
}

type SortOption = 'default' | 'reverse' | 'name-asc' | 'name-desc';

@Component({
  selector: 'app-user-followers',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatMenuModule,
    MatRadioModule,
    MatTooltipModule,
    MatDividerModule,
    ScrollingModule,
    UserProfileComponent,
  ],
  templateUrl: './user-followers.component.html',
  styleUrl: './user-followers.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserFollowersComponent {
  private readonly FOLLOWERS_BATCH_LIMIT = 500;
  private readonly FOLLOWERS_MAX_RESULTS = 5000;
  private static readonly followersCache = new Map<string, {
    followingList: UserProfile[];
    followersList: UserProfile[];
    viewingProfile?: NostrRecord;
  }>();

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);
  private utilities = inject(UtilitiesService);
  private dataService = inject(DataService);
  private panelNav = inject(PanelNavigationService);
  private userRelayService = inject(UserRelayService);
  private relayPool = inject(RelayPoolService);
  private destroyRef = inject(DestroyRef);

  isLoadingFollowing = signal(true);
  isLoadingFollowers = signal(true);
  errorFollowing = signal<string | null>(null);
  errorFollowers = signal<string | null>(null);
  followingList = signal<UserProfile[]>([]);
  followersList = signal<UserProfile[]>([]);
  loadingFollowersCount = signal(0);

  private hasInitialFollowing = signal(false);
  viewingPubkey = signal<string>('');
  viewingProfile = signal<NostrRecord | undefined>(undefined);
  private hasInitialFollowers = signal(false);
  private forceQuery = signal(false);
  private loadedFollowingPubkey = signal<string | null>(null);
  private hasLoadedFollowing = signal(false);
  private loadedFollowersPubkey = signal<string | null>(null);
  private hasLoadedFollowers = signal(false);

  searchTerm = signal<string>('');
  private searchChanged = new Subject<string>();
  sortOption = signal<SortOption>('default');

  filteredFollowingList = computed(() => {
    return this.filterAndSort(this.followingList(), this.searchTerm(), this.sortOption());
  });

  filteredFollowersList = computed(() => {
    return this.filterAndSort(this.followersList(), this.searchTerm(), this.sortOption());
  });

  followersTabLabel = computed(() => {
    const count = this.isLoadingFollowers()
      ? this.loadingFollowersCount()
      : this.followersList().length;
    return `Followers (${this.formatCompactCount(count)})`;
  });

  followingTabLabel = computed(() => {
    const count = this.followingList().length;
    return `Following (${this.formatCompactCount(count)})`;
  });

  followingYouKnowList = computed(() => {
    const currentUserFollowing = this.accountState.followingList();
    const viewedUserFollowing = this.filteredFollowingList();
    const currentUserFollowingSet = new Set(currentUserFollowing);
    return viewedUserFollowing.filter(user => currentUserFollowingSet.has(user.id));
  });

  followersYouKnowList = computed(() => {
    const currentUserFollowing = this.accountState.followingList();
    const profileFollowers = this.filteredFollowersList();
    const currentUserFollowingSet = new Set(currentUserFollowing);
    return profileFollowers.filter(user => currentUserFollowingSet.has(user.id));
  });

  selectedTabIndex = signal(1);

  readonly itemSize = 44;
  readonly minBufferPx = 200;
  readonly maxBufferPx = 400;

  constructor() {
    this.searchChanged.pipe(
      debounceTime(300),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(term => {
      this.searchTerm.set(term);
    });

    let pubkeyParam = this.route.snapshot.paramMap.get('pubkey');
    if (pubkeyParam) {
      pubkeyParam = this.utilities.safeGetHexPubkey(pubkeyParam) || pubkeyParam;
      this.viewingPubkey.set(pubkeyParam);
    }

    const historyState = typeof window !== 'undefined' ? history.state : null;
    const navState = (this.router.getCurrentNavigation()?.extras.state ?? historyState) as {
      followingList?: unknown;
      followersList?: unknown;
      forceQuery?: unknown;
      initialTab?: unknown;
    } | null;

    const forceQuery = navState?.forceQuery === true;
    this.forceQuery.set(forceQuery);

    const initialTab = navState?.initialTab === 'following' ? 0 : 1;
    this.selectedTabIndex.set(initialTab);

    const preloadedFollowingList = Array.isArray(navState?.followingList)
      ? navState.followingList.filter((pubkey): pubkey is string => typeof pubkey === 'string' && pubkey.trim() !== '')
      : [];

    if (preloadedFollowingList.length > 0) {
      this.hasInitialFollowing.set(true);
      this.loadFollowingList(preloadedFollowingList);
      this.isLoadingFollowing.set(false);
    }

    const preloadedFollowersList = Array.isArray(navState?.followersList)
      ? navState.followersList.filter((pubkey): pubkey is string => typeof pubkey === 'string' && pubkey.trim() !== '')
      : [];

    if (preloadedFollowersList.length > 0 && !forceQuery) {
      this.hasInitialFollowers.set(true);
      this.loadFollowersList(preloadedFollowersList);
      this.isLoadingFollowers.set(false);
    }

    const cachedState = UserFollowersComponent.followersCache.get(this.viewingPubkey());
    if (cachedState && !forceQuery) {
      this.followingList.set(cachedState.followingList);
      this.followersList.set(cachedState.followersList);
      this.viewingProfile.set(cachedState.viewingProfile);
      this.hasInitialFollowing.set(true);
      this.hasInitialFollowers.set(true);
      this.loadedFollowingPubkey.set(this.viewingPubkey());
      this.hasLoadedFollowing.set(true);
      this.loadedFollowersPubkey.set(this.viewingPubkey());
      this.hasLoadedFollowers.set(true);
      this.isLoadingFollowing.set(false);
      this.isLoadingFollowers.set(false);
    }

    effect(() => {
      const pubkey = this.viewingPubkey();
      if (pubkey) {
        untracked(() => this.loadData(pubkey));
      }
    });
  }

  private async loadData(pubkey: string): Promise<void> {
    try {
      const alreadyLoadedFollowingForPubkey =
        this.loadedFollowingPubkey() === pubkey && this.hasLoadedFollowing();

      const alreadyLoadedForPubkey =
        this.loadedFollowersPubkey() === pubkey && this.hasLoadedFollowers();

      if (alreadyLoadedForPubkey && alreadyLoadedFollowingForPubkey) {
        this.isLoadingFollowing.set(false);
        this.isLoadingFollowers.set(false);
        return;
      }

      if (!this.hasInitialFollowing()) {
        this.isLoadingFollowing.set(true);
      }
      if (!this.hasInitialFollowers()) {
        this.isLoadingFollowers.set(true);
      }
      this.loadingFollowersCount.set(0);
      this.errorFollowing.set(null);
      this.errorFollowers.set(null);

      const profile = await this.dataService.getProfile(pubkey);
      this.viewingProfile.set(profile);

      if (!this.hasInitialFollowing()) {
        try {
          const contactsEvent = await this.dataService.getContactsEvent(pubkey);
          const followingPubkeys = contactsEvent
            ? contactsEvent.tags
              .filter(tag => tag[0] === 'p' && tag[1])
              .map(tag => tag[1])
            : [];
          this.loadFollowingList(followingPubkeys);
          this.isLoadingFollowing.set(false);
        } catch (followingError) {
          this.errorFollowing.set('Failed to load following list');
          this.logger.error('Error loading following data', followingError);
          this.isLoadingFollowing.set(false);
        }
      }

      if (!this.hasInitialFollowers() || this.forceQuery()) {
        const followerPubkeys = await this.discoverFollowers(
          pubkey,
          this.FOLLOWERS_MAX_RESULTS,
          (progressFollowers) => {
            this.loadFollowersList(progressFollowers);
            this.loadingFollowersCount.set(progressFollowers.length);
          },
        );
        this.loadFollowersList(followerPubkeys);
        this.loadingFollowersCount.set(followerPubkeys.length);

        // Consume force-query once we've fetched.
        if (this.forceQuery()) {
          this.forceQuery.set(false);
        }
      }

      this.loadedFollowersPubkey.set(pubkey);
      this.hasLoadedFollowers.set(true);
      this.loadedFollowingPubkey.set(pubkey);
      this.hasLoadedFollowing.set(true);

      UserFollowersComponent.followersCache.set(pubkey, {
        followingList: this.followingList(),
        followersList: this.followersList(),
        viewingProfile: this.viewingProfile(),
      });

      this.isLoadingFollowers.set(false);
    } catch (err) {
      if (!this.hasInitialFollowers()) {
        this.errorFollowers.set('Failed to load followers list');
      }
      this.isLoadingFollowers.set(false);
      this.logger.error('Error loading followers data', err);
    }
  }

  private async discoverFollowers(
    profilePubkey: string,
    maxResults: number,
    onProgress?: (followers: string[]) => void,
  ): Promise<string[]> {
    await this.userRelayService.ensureRelaysForPubkey(profilePubkey);
    const relayUrls = this.userRelayService.getRelaysForPubkey(profilePubkey);

    if (!relayUrls || relayUrls.length === 0) {
      return [];
    }
    const followerPubkeys = new Set<string>();

    let until: number | undefined;
    while (followerPubkeys.size < maxResults) {
      const followerEvents = await this.relayPool.query(
        relayUrls,
        {
          kinds: [kinds.Contacts],
          '#p': [profilePubkey],
          limit: this.FOLLOWERS_BATCH_LIMIT,
          ...(until !== undefined ? { until } : {}),
        },
        12000,
      );

      if (followerEvents.length === 0) {
        break;
      }

      let oldestCreatedAt = Number.MAX_SAFE_INTEGER;
      for (const event of followerEvents) {
        if (this.utilities.isValidHexPubkey(event.pubkey)) {
          followerPubkeys.add(event.pubkey);
          if (followerPubkeys.size >= maxResults) {
            break;
          }
        }

        if (event.created_at > 0 && event.created_at < oldestCreatedAt) {
          oldestCreatedAt = event.created_at;
        }
      }

      followerEvents.length = 0;

      onProgress?.(Array.from(followerPubkeys));

      if (followerPubkeys.size >= maxResults || oldestCreatedAt === Number.MAX_SAFE_INTEGER) {
        break;
      }

      if (until !== undefined && oldestCreatedAt - 1 >= until) {
        break;
      }

      until = oldestCreatedAt - 1;
    }

    onProgress?.(Array.from(followerPubkeys));

    return Array.from(followerPubkeys);
  }

  formatCompactCount(count: number): string {
    const safeCount = Math.max(0, Math.floor(count));
    if (safeCount >= 1000) {
      return `${(safeCount / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    }
    return `${safeCount}`;
  }

  private loadFollowersList(pubkeys: string[]): void {
    if (!pubkeys || pubkeys.length === 0) {
      this.followersList.set([]);
      return;
    }

    const normalizedPubkeys: string[] = [];
    for (const pubkey of pubkeys) {
      const hexPubkey = this.utilities.getPubkeyFromNpub(pubkey);
      if (hexPubkey && this.utilities.isValidHexPubkey(hexPubkey)) {
        normalizedPubkeys.push(hexPubkey);
      }
    }

    if (normalizedPubkeys.length !== pubkeys.length) {
      this.logger.warn(
        `Filtered out ${pubkeys.length - normalizedPubkeys.length} invalid pubkeys from followers list`
      );
    }

    const followerProfiles = normalizedPubkeys.map(pubkey => ({
      id: pubkey,
      npub: this.utilities.getNpubFromPubkey(pubkey) || pubkey,
      name: '',
      picture: null,
    }));

    this.followersList.set(followerProfiles);
  }

  private loadFollowingList(pubkeys: string[]): void {
    if (!pubkeys || pubkeys.length === 0) {
      this.followingList.set([]);
      return;
    }

    const normalizedPubkeys: string[] = [];
    for (const pubkey of pubkeys) {
      const hexPubkey = this.utilities.getPubkeyFromNpub(pubkey);
      if (hexPubkey && this.utilities.isValidHexPubkey(hexPubkey)) {
        normalizedPubkeys.push(hexPubkey);
      }
    }

    const followingProfiles = normalizedPubkeys.map(pubkey => ({
      id: pubkey,
      npub: this.utilities.getNpubFromPubkey(pubkey) || pubkey,
      name: '',
      picture: null,
    }));

    this.followingList.set(followingProfiles);
  }

  getProfileDisplayName(): string {
    const profile = this.viewingProfile();
    if (!profile) return 'User';

    if (profile.data?.display_name) return profile.data.display_name;
    if (profile.data?.name) return profile.data.name;
    if (profile.data?.nip05) return this.utilities.parseNip05(profile.data.nip05) || 'User';
    return 'User';
  }

  onTabChanged(tabIndex: number): void {
    this.selectedTabIndex.set(tabIndex);
  }

  updateSearch(value: string): void {
    this.searchChanged.next(value);
  }

  changeSortOption(option: SortOption): void {
    this.sortOption.set(option);
  }

  private filterAndSort(list: UserProfile[], searchTerm: string, sortOption: SortOption): UserProfile[] {
    let filteredList = list;
    const search = searchTerm.toLowerCase().trim();

    if (search) {
      filteredList = filteredList.filter(user => {
        if (user.id.toLowerCase().includes(search) || user.npub.toLowerCase().includes(search)) {
          return true;
        }

        const profile = this.accountState.getCachedProfile(user.id);
        const profileData = profile?.data;
        if (profileData?.name?.toLowerCase().includes(search)) {
          return true;
        }
        if (profileData?.display_name?.toLowerCase().includes(search)) {
          return true;
        }
        const nip05Value = profileData?.nip05;
        const nip05 = Array.isArray(nip05Value) ? nip05Value[0] : nip05Value;
        if (nip05?.toLowerCase().includes(search)) {
          return true;
        }

        return false;
      });
    }

    return this.applySorting(filteredList, sortOption);
  }

  private applySorting(list: UserProfile[], sortOption: SortOption): UserProfile[] {
    const sorted = [...list];

    switch (sortOption) {
      case 'reverse':
        return sorted.reverse();
      case 'name-asc':
        return sorted.sort((a, b) => {
          const nameA = this.getDisplayName(a.id).toLowerCase();
          const nameB = this.getDisplayName(b.id).toLowerCase();
          return nameA.localeCompare(nameB);
        });
      case 'name-desc':
        return sorted.sort((a, b) => {
          const nameA = this.getDisplayName(a.id).toLowerCase();
          const nameB = this.getDisplayName(b.id).toLowerCase();
          return nameB.localeCompare(nameA);
        });
      case 'default':
      default:
        return sorted;
    }
  }

  private getDisplayName(pubkey: string): string {
    const profile = this.accountState.getCachedProfile(pubkey);
    const profileData = profile?.data;
    return profileData?.display_name || profileData?.name || pubkey.slice(0, 8);
  }

  goBack(): void {
    const isInRightPanel = this.route.outlet === 'right';

    if (isInRightPanel) {
      this.panelNav.goBackRight();
      return;
    }

    this.location.back();
  }
}
