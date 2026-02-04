import { Component, inject, signal, computed, effect, ViewChild, ElementRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { animate, style, transition, trigger } from '@angular/animations';
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
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';
import { AccountStateService } from '../../../services/account-state.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { UtilitiesService } from '../../../services/utilities.service';

interface UserProfile {
  id: string;
  npub: string;
  name: string;
  picture: string | null;
}

interface ProfileData {
  name: string;
  picture: string | null;
}

// Define sorting options
type SortOption = 'default' | 'reverse' | 'name-asc' | 'name-desc';

@Component({
  selector: 'app-following',
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
  templateUrl: './following.component.html',
  styleUrl: './following.component.scss',
  animations: [
    trigger('slideInOut', [
      transition(':enter', [
        style({ transform: 'translateY(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateY(0)', opacity: 1 })),
      ]),
      transition(':leave', [
        animate('300ms ease-in', style({ transform: 'translateY(100%)', opacity: 0 })),
      ]),
    ]),
    trigger('profileShrink', [
      transition(':enter', [
        style({ transform: 'scale(1.3)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'scale(1)', opacity: 1 })),
      ]),
    ]),
  ],
})
export class FollowingComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  profileState = inject(PROFILE_STATE);
  private accountState = inject(AccountStateService);
  private utilities = inject(UtilitiesService);

  @ViewChild('followingContainer') followingContainerRef!: ElementRef;

  isLoading = signal(true);
  error = signal<string | null>(null);
  followingList = signal<UserProfile[]>([]);

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

  npub = computed(() => this.route.snapshot.parent?.paramMap.get('npub') || '');
  userProfile = signal<ProfileData | null>(null);

  // Item size for virtual scrolling (approx. height of each item in pixels)
  readonly itemSize = 44;

  // Buffer size determines how many items to render outside viewport
  readonly minBufferPx = 200;
  readonly maxBufferPx = 400;

  constructor() {
    // Initialize search debounce
    this.searchChanged.pipe(debounceTime(300)).subscribe(term => {
      this.searchTerm.set(term);
    });

    effect(async () => {
      const list = this.profileState.followingList();
      await this.loadFollowingList(list);
    });
  }

  /**
   * Scroll the component into view
   */
  // scrollToTop(): void {
  //   this.layoutService.scrollToElement('.following-header');
  //   this.logger.debug('Scrolled following container into view');
  // }

  async loadUserProfile(): Promise<void> {
    try {
      setTimeout(() => {
        this.userProfile.set({
          name: 'Example User',
          picture: 'https://example.com/avatar.jpg',
        });
      }, 300);
    } catch {
      this.error.set('Failed to load profile');
    }
  }

  async loadFollowingList(pubkeys: string[]): Promise<void> {
    try {
      this.isLoading.set(true);

      if (!pubkeys || pubkeys.length === 0) {
        this.followingList.set([]);
        this.isLoading.set(false);
        return;
      }

      // Filter out invalid pubkeys
      const validPubkeys = pubkeys.filter(pubkey => this.utilities.isValidPubkey(pubkey));

      if (validPubkeys.length !== pubkeys.length) {
        this.logger.warn(
          `Filtered out ${pubkeys.length - validPubkeys.length} invalid pubkeys from following list`
        );
      }

      const followingProfiles = validPubkeys.map((pubkey, index) => ({
        id: pubkey,
        npub: pubkey,
        name: `User ${index + 1}`,
        picture: null,
      }));
      this.followingList.set(followingProfiles);
      this.isLoading.set(false);
    } catch (err) {
      this.error.set('Failed to load following list');
      this.isLoading.set(false);
      this.logger.error('Error loading following list', err);
    }
  }

  onTabChanged(tabIndex: number): void {
    this.selectedTabIndex.set(tabIndex);
    // this.scrollToTop();
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
    this.location.back();
  }
}
