import { Component, inject, signal, computed, effect, ViewChild, ElementRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { animate, style, transition, trigger } from '@angular/animations';
import { Location } from '@angular/common';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { ProfileStateService } from '../../../services/profile-state.service';
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

@Component({
  selector: 'app-following',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTabsModule,
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
  profileState = inject(ProfileStateService);
  private accountState = inject(AccountStateService);
  private utilities = inject(UtilitiesService);

  @ViewChild('followingContainer') followingContainerRef!: ElementRef;

  isLoading = signal(true);
  error = signal<string | null>(null);
  followingList = signal<UserProfile[]>([]);

  // Computed signal for mutual connections
  mutualConnectionsList = computed(() => {
    const currentUserFollowing = this.accountState.followingList();
    const profileFollowing = this.followingList();

    // Find users that both the current user and the profile are following
    const mutualPubkeys = currentUserFollowing.filter(pubkey =>
      profileFollowing.some(user => user.id === pubkey)
    );

    // Return the user profiles for mutual connections
    return profileFollowing.filter(user => mutualPubkeys.includes(user.id));
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

  goBack(): void {
    this.location.back();
  }
}
