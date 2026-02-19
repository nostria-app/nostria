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

import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { AccountStateService } from '../../services/account-state.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { UtilitiesService } from '../../services/utilities.service';
import { DataService } from '../../services/data.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { NostrRecord } from '../../interfaces';

interface UserProfile {
  id: string;
  npub: string;
  name: string;
  picture: string | null;
}

// Define sorting options
type SortOption = 'default' | 'reverse' | 'name-asc' | 'name-desc';

/**
 * Standalone component for viewing a user's following list.
 * Used in the right panel when opened from profile header.
 * Does not depend on PROFILE_STATE - loads its own data.
 */
@Component({
  selector: 'app-user-following',
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
  templateUrl: './user-following.component.html',
  styleUrl: './user-following.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserFollowingComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);
  private utilities = inject(UtilitiesService);
  private dataService = inject(DataService);
  private panelNav = inject(PanelNavigationService);
  private destroyRef = inject(DestroyRef);

  isLoading = signal(true);
  error = signal<string | null>(null);
  followingList = signal<UserProfile[]>([]);

  // The pubkey we're viewing
  viewingPubkey = signal<string>('');
  viewingProfile = signal<NostrRecord | undefined>(undefined);
  private hasInitialFollowing = signal(false);

  // Search and sorting
  searchTerm = signal<string>('');
  private searchChanged = new Subject<string>();
  sortOption = signal<SortOption>('default');

  // Computed signal for filtered and sorted following list
  filteredFollowingList = computed(() => {
    let list = this.followingList();
    const search = this.searchTerm().toLowerCase().trim();
    const sort = this.sortOption();

    // Apply search filter
    if (search) {
      list = list.filter(user => {
        // Check if search matches pubkey/npub
        if (user.id.toLowerCase().includes(search) || user.npub.toLowerCase().includes(search)) {
          return true;
        }
        // Check if search matches cached profile name
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

    // Apply sorting
    list = this.applySorting(list, sort);

    return list;
  });

  // Computed signal for mutual connections - optimized with Set for O(n) instead of O(n*m)
  mutualConnectionsList = computed(() => {
    const currentUserFollowing = this.accountState.followingList();
    const profileFollowing = this.filteredFollowingList();

    // Use Set for O(1) lookups instead of O(n) array scanning
    const currentUserFollowingSet = new Set(currentUserFollowing);

    // Find users that both the current user and the profile are following
    return profileFollowing.filter(user => currentUserFollowingSet.has(user.id));
  });

  selectedTabIndex = signal(0);

  // Item size for virtual scrolling (approx. height of each item in pixels)
  readonly itemSize = 44;

  // Buffer size determines how many items to render outside viewport
  readonly minBufferPx = 200;
  readonly maxBufferPx = 400;

  constructor() {
    // Initialize search debounce
    this.searchChanged.pipe(
      debounceTime(300),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(term => {
      this.searchTerm.set(term);
    });

    // Get pubkey from route params
    let pubkeyParam = this.route.snapshot.paramMap.get('pubkey');
    if (pubkeyParam) {
      // Convert npub to hex if needed
      pubkeyParam = this.utilities.safeGetHexPubkey(pubkeyParam) || pubkeyParam;
      this.viewingPubkey.set(pubkeyParam);
    }

    const historyState = typeof window !== 'undefined' ? history.state : null;
    const navState = (this.router.getCurrentNavigation()?.extras.state ?? historyState) as {
      followingList?: unknown;
    } | null;
    const preloadedFollowingList = Array.isArray(navState?.followingList)
      ? navState.followingList.filter((pubkey): pubkey is string => typeof pubkey === 'string' && pubkey.trim() !== '')
      : [];

    if (preloadedFollowingList.length > 0) {
      this.hasInitialFollowing.set(true);
      this.loadFollowingList(preloadedFollowingList);
      this.isLoading.set(false);
    }

    // Load data when pubkey is available
    effect(() => {
      const pubkey = this.viewingPubkey();
      if (pubkey) {
        untracked(() => this.loadData(pubkey));
      }
    });
  }

  private async loadData(pubkey: string): Promise<void> {
    try {
      if (!this.hasInitialFollowing()) {
        this.isLoading.set(true);
      }
      this.error.set(null);

      // Load profile data
      const profile = await this.dataService.getProfile(pubkey);
      this.viewingProfile.set(profile);

      // Load contacts/following list
      const contactsEvent = await this.dataService.getContactsEvent(pubkey);
      if (contactsEvent) {
        // Extract pubkeys from p tags
        const followingPubkeys = contactsEvent.tags
          .filter(tag => tag[0] === 'p' && tag[1])
          .map(tag => tag[1]);

        await this.loadFollowingList(followingPubkeys);
      } else {
        if (!this.hasInitialFollowing()) {
          this.followingList.set([]);
        }
      }

      this.isLoading.set(false);
    } catch (err) {
      if (!this.hasInitialFollowing()) {
        this.error.set('Failed to load following list');
      }
      this.isLoading.set(false);
      this.logger.error('Error loading following data', err);
    }
  }

  private async loadFollowingList(pubkeys: string[]): Promise<void> {
    if (!pubkeys || pubkeys.length === 0) {
      this.followingList.set([]);
      return;
    }

    // Normalize pubkeys to hex format and filter out invalid ones
    const normalizedPubkeys: string[] = [];
    for (const pubkey of pubkeys) {
      // Convert npub to hex if needed
      const hexPubkey = this.utilities.getPubkeyFromNpub(pubkey);
      if (hexPubkey && this.utilities.isValidHexPubkey(hexPubkey)) {
        normalizedPubkeys.push(hexPubkey);
      }
    }

    if (normalizedPubkeys.length !== pubkeys.length) {
      this.logger.warn(
        `Filtered out ${pubkeys.length - normalizedPubkeys.length} invalid pubkeys from following list`
      );
    }

    const followingProfiles = normalizedPubkeys.map((pubkey) => ({
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

  preventPropagation(event: Event): void {
    event.stopPropagation();
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
    // Check if we're in the right panel (auxiliary outlet)
    const isInRightPanel = this.route.outlet === 'right';

    if (isInRightPanel) {
      // Use panel navigation to properly close the right panel
      this.panelNav.goBackRight();
      return;
    }

    // Left panel navigation
    this.location.back();
  }
}
