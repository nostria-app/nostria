import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
  computed,
  effect,
  inject,
  untracked,
  ViewEncapsulation,
} from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DataService } from '../../../services/data.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { SettingsService } from '../../../services/settings.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ReportingService } from '../../../services/reporting.service';
import { LayoutService } from '../../../services/layout.service';
import { DatabaseService } from '../../../services/database.service';
import { UserDataService } from '../../../services/user-data.service';
import { nip19 } from 'nostr-tools';
import { TrustService } from '../../../services/trust.service';
import { FavoritesService } from '../../../services/favorites.service';
import { PublishService } from '../../../services/publish.service';
import { NostrService } from '../../../services/nostr.service';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { ProfileHoverCardService } from '../../../services/profile-hover-card.service';
import { CreateListDialogComponent, CreateListDialogResult } from '../../create-list-dialog/create-list-dialog.component';
import { firstValueFrom } from 'rxjs';
import { stripImageProxy } from '../../../utils/strip-image-proxy';
import { Nip05VerificationService, Nip05VerificationResult } from '../../../services/nip05-verification.service';

interface ProfileData {
  data?: {
    picture?: string;
    display_name?: string;
    name?: string;
    nip05?: string;
    about?: string;
    banner?: string;
    lud16?: string;
    lud06?: string;
    [key: string]: unknown;
  };
  isEmpty?: boolean;
}

@Component({
  selector: 'app-profile-hover-card',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatDividerModule,
  ],
  templateUrl: './profile-hover-card.component.html',
  styleUrl: './profile-hover-card.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(click)': 'onCardClick($event)',
  },
})
export class ProfileHoverCardComponent {
  private dataService = inject(DataService);
  private utilities = inject(UtilitiesService);
  readonly settingsService = inject(SettingsService);
  private imageCacheService = inject(ImageCacheService);
  private accountState = inject(AccountStateService);
  private reportingService = inject(ReportingService);
  private layout = inject(LayoutService);
  private database = inject(DatabaseService);
  private userDataService = inject(UserDataService);
  private trustService = inject(TrustService);
  private dialog = inject(MatDialog);
  private favoritesService = inject(FavoritesService);
  private publishService = inject(PublishService);
  private nostrService = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  private followSetsService = inject(FollowSetsService);
  private hoverCardService = inject(ProfileHoverCardService);
  private nip05Service = inject(Nip05VerificationService);

  pubkey = input.required<string>();
  profile = signal<ProfileData | null>(null);
  isLoading = signal(false);
  imageLoadError = signal(false);
  isFollowing = signal(false);
  isLoadingFollowing = signal(false);
  mutualFollowing = signal<string[]>([]);
  mutualFollowingProfiles = signal<ProfileData[]>([]);
  isMenuOpen = signal(false);
  trustRank = signal<number | undefined>(undefined);
  nip05Verification = signal<Nip05VerificationResult | null>(null);
  hasTrustRank = computed(() => this.trustRank() !== undefined && this.trustRank() !== null);

  isFavorite = computed(() => {
    return this.favoritesService.isFavorite(this.pubkey());
  });

  trustEnabled = computed(() => this.trustService.isEnabled());

  // Computed to get available follow sets (sorted alphabetically)
  availableFollowSets = computed(() => {
    return [...this.followSetsService.followSets()].sort((a, b) => a.title.localeCompare(b.title));
  });

  npubValue = computed<string>(() => {
    const pubkey = this.pubkey();
    if (!pubkey) {
      return '';
    }
    return nip19.npubEncode(pubkey);
  });

  aliasOrNpub = computed(() => {
    const profile = this.profile();

    if (!profile || !profile.data) {
      return this.truncateNpub(this.npubValue());
    }

    // Show NIP-05 if available (first priority)
    if (profile.data.nip05) {
      const parsed = this.utilities.parseNip05(profile.data.nip05);
      if (parsed) return parsed;
    }

    // Show LUD16 if available and no NIP-05 (second priority)
    if (profile.data.lud16) {
      const lud16 = profile.data.lud16;
      return Array.isArray(lud16) ? lud16[0] || this.truncateNpub(this.npubValue()) : lud16;
    }

    // Fallback to npub if neither NIP-05 nor LUD16 is available
    return this.truncateNpub(this.npubValue());
  });

  constructor() {
    effect(() => {
      const pubkey = this.pubkey();

      if (pubkey) {
        untracked(() => {
          this.loadProfile(pubkey);
          this.checkFollowingStatus(pubkey);
          this.loadMutualFollowing(pubkey);
          this.loadTrustMetrics(pubkey);
        });
      }
    });
  }

  private async loadProfile(pubkey: string): Promise<void> {
    if (this.profile()) {
      return;
    }

    this.isLoading.set(true);

    try {
      const profile = await this.dataService.getProfile(pubkey);
      this.profile.set((profile as ProfileData) || { isEmpty: true });

      // Trigger NIP-05 verification when hover card profile loads
      const nip05 = (profile as ProfileData)?.data?.nip05;
      if (nip05) {
        this.nip05Service.verify(pubkey, nip05).then(result => {
          this.nip05Verification.set(result);
        });
      }
    } catch (error) {
      console.error('Failed to load profile for hover card:', error);
      this.profile.set({ isEmpty: true });
    } finally {
      this.isLoading.set(false);
    }
  }

  private checkFollowingStatus(pubkey: string): void {
    const followingList = this.accountState.followingList();
    this.isFollowing.set(followingList.includes(pubkey));
  }

  private async loadMutualFollowing(pubkey: string): Promise<void> {
    try {
      // Get current account's following list
      const myFollowing = this.accountState.followingList();

      if (myFollowing.length === 0) {
        return;
      }

      // Get the target profile's following list (kind 3 event)
      // Try storage first, then fetch from relays if not found
      let targetFollowingEvent = await this.database.getEventByPubkeyAndKind(pubkey, 3);

      if (!targetFollowingEvent) {
        // Not in cache, fetch from relays
        const record = await this.userDataService.getEventByPubkeyAndKind(pubkey, 3);
        targetFollowingEvent = record?.event || null;
      }

      if (!targetFollowingEvent?.tags) {
        return;
      }

      const targetFollowing = targetFollowingEvent.tags
        .filter((tag: string[]) => tag[0] === 'p')
        .map((tag: string[]) => tag[1]);

      // Find mutual follows (people that both follow)
      const mutual = myFollowing.filter(p => targetFollowing.includes(p));
      this.mutualFollowing.set(mutual);

      // Load profiles for the first 2 mutual follows
      if (mutual.length > 0) {
        const profilesToLoad = mutual.slice(0, 2);
        const profiles = await Promise.all(
          profilesToLoad.map(async p => {
            try {
              const prof = await this.dataService.getProfile(p);
              return prof as ProfileData;
            } catch {
              return null;
            }
          })
        );
        this.mutualFollowingProfiles.set(profiles.filter(p => p !== null) as ProfileData[]);
      }
    } catch (error) {
      console.error('Failed to load mutual following:', error);
    }
  }

  private async loadTrustMetrics(pubkey: string): Promise<void> {
    if (!this.trustService.isEnabled()) {
      return;
    }

    try {
      const metrics = await this.trustService.fetchMetrics(pubkey);
      this.trustRank.set(metrics?.rank);
    } catch (error) {
      console.error('Failed to load trust metrics for hover card:', error);
    }
  }

  async toggleFollow(): Promise<void> {
    const pubkey = this.pubkey();

    // Check if user is logged in with a real account
    const currentAccount = this.accountState.account();
    if (!currentAccount || currentAccount.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    this.isLoadingFollowing.set(true);

    try {
      if (this.isFollowing()) {
        await this.accountState.unfollow(pubkey);
        this.isFollowing.set(false);
        this.snackBar.open('Unfollowed successfully', 'Dismiss', { duration: 3000 });
      } else {
        await this.accountState.follow(pubkey);
        this.isFollowing.set(true);
        const displayName = this.profile()?.data?.display_name || this.profile()?.data?.name || 'User';
        this.snackBar.open(`Now following ${displayName}`, 'Dismiss', { duration: 3000 });
      }
    } catch (error) {
      console.error('Failed to toggle follow:', error);
      this.snackBar.open('Failed to update follow status', 'Dismiss', { duration: 3000 });
    } finally {
      this.isLoadingFollowing.set(false);
    }
  }

  profileUrl = computed(() => `/p/${this.npubValue()}`);

  onProfileClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.hoverCardService.hideHoverCard();
    this.layout.openProfile(this.pubkey());
  }

  async reportProfile(): Promise<void> {
    // Check if user is logged in with a real account
    const currentAccount = this.accountState.account();
    if (!currentAccount || currentAccount.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    try {
      const reportEvent = this.reportingService.createReportEvent(
        { type: 'user', pubkey: this.pubkey() },
        'spam',
        'Reported from profile hover card'
      );

      // Publish using PublishService
      await this.publishService.signAndPublishAuto(
        reportEvent,
        (event) => this.nostrService.signEvent(event)
      );
      this.layout.toast('Profile reported');
    } catch (error) {
      console.error('Failed to report profile:', error);
      this.layout.toast('Failed to report profile', 3000, 'error-snackbar');
    }
  }

  async blockUser(): Promise<void> {
    // Check if user is logged in with a real account
    const currentAccount = this.accountState.account();
    if (!currentAccount || currentAccount.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    try {
      const pubkey = this.pubkey();

      // Check if we're currently following this user
      if (this.isFollowing()) {
        // Import ConfirmDialogComponent dynamically to show confirmation dialog
        const { ConfirmDialogComponent } = await import('../../confirm-dialog/confirm-dialog.component');

        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: 'Unfollow and Block User?',
            message: 'You are currently following this user. Would you like to unfollow them before blocking?',
            confirmText: 'Unfollow and Block',
            cancelText: 'Just Block',
            confirmColor: 'warn'
          },
          width: '400px',
        });

        const shouldUnfollow = await firstValueFrom(dialogRef.afterClosed());

        if (shouldUnfollow) {
          // Unfollow first, then block
          await this.accountState.unfollow(pubkey);
        }
      }

      await this.reportingService.muteUser(pubkey);
      this.layout.toast('User blocked');
    } catch (error) {
      console.error('Failed to block user:', error);
      this.layout.toast('Failed to block user', 3000, 'error-snackbar');
    }
  }

  toggleFavorite(): void {
    const pubkey = this.pubkey();
    // Check state BEFORE toggling to show correct message
    const wasFavorite = this.favoritesService.isFavorite(pubkey);
    const success = this.favoritesService.toggleFavorite(pubkey);

    if (success) {
      if (wasFavorite) {
        this.layout.toast('Removed from favorites');
      } else {
        this.layout.toast('Added to favorites');
      }
    }
  }

  isInFollowSet(dTag: string): boolean {
    const set = this.followSetsService.getFollowSetByDTag(dTag);
    return set ? set.pubkeys.includes(this.pubkey()) : false;
  }

  async addToFollowSet(dTag: string): Promise<void> {
    const pubkey = this.pubkey();
    const isCurrentlyInSet = this.isInFollowSet(dTag);

    try {
      if (isCurrentlyInSet) {
        // Remove from set
        await this.followSetsService.removeFromFollowSet(dTag, pubkey);
        this.layout.toast('Removed from list');
      } else {
        // Add to set
        await this.followSetsService.addToFollowSet(dTag, pubkey);
        this.layout.toast('Added to list');
      }
    } catch (error) {
      this.layout.toast('Failed to update list');
    }
  }

  async createNewFollowSet(): Promise<void> {
    const dialogRef = this.dialog.open(CreateListDialogComponent, {
      data: {
        initialPrivate: false,
      },
      width: '450px',
    });

    const result: CreateListDialogResult | null = await firstValueFrom(dialogRef.afterClosed());

    if (!result || !result.title.trim()) {
      return;
    }

    try {
      const pubkey = this.pubkey();
      const newSet = await this.followSetsService.createFollowSet(
        result.title.trim(),
        [pubkey],
        result.isPrivate
      );

      if (newSet) {
        const privacyLabel = result.isPrivate ? 'private list' : 'list';
        this.layout.toast(`Created ${privacyLabel} "${result.title}" and added user`);
      } else {
        this.layout.toast('Failed to create list');
      }
    } catch (error) {
      this.layout.toast('Failed to create list');
    }
  }

  getOptimizedImageUrl(url: string): string {
    if (!this.settingsService.settings().imageCacheEnabled) {
      return stripImageProxy(url);
    }

    return this.imageCacheService.getOptimizedImageUrl(url);
  }

  /**
   * Strip third-party image proxy wrappers from a URL.
   * Used for images loaded directly (not through our image proxy).
   */
  cleanImageUrl(url: string): string {
    return stripImageProxy(url);
  }

  onImageLoadError(): void {
    this.imageLoadError.set(true);
  }

  private truncateNpub(npub: string): string {
    return this.utilities.truncateString(npub, 8, 8);
  }

  getMutualFollowingText(): string {
    const count = this.mutualFollowing().length;
    if (count === 0) return '';

    const profiles = this.mutualFollowingProfiles();
    const names = profiles
      .map(p => p?.data?.display_name || p?.data?.name || 'Unknown')
      .filter(n => n !== 'Unknown');

    if (count === 1) {
      return names.length > 0 ? `Also follows ${names[0]}` : '1 follower in common';
    } else if (count === 2) {
      return names.length === 2
        ? `Also follows ${names[0]} and ${names[1]}`
        : `${count} followers in common`;
    } else {
      const remaining = count - names.length;
      if (names.length === 0) {
        return `${count} followers in common`;
      } else if (names.length === 1) {
        return `Also follows ${names[0]} and ${remaining} other${remaining !== 1 ? 's' : ''}`;
      } else {
        return `Also follows ${names[0]}, ${names[1]} and ${remaining} other${remaining !== 1 ? 's' : ''}`;
      }
    }
  }

  truncateContent(content: string): string {
    return this.utilities.truncateContent(content, 140);
  }

  getTimeAgo(timestamp: number): string {
    return this.utilities.getRelativeTime(timestamp);
  }

  onMenuButtonEnter(): void {
    // Signal to the service that we're over the menu button
    this.isMenuOpen.set(true);
  }

  onMenuButtonLeave(): void {
    // Only reset if menu isn't actually open
    // The menuOpened/menuClosed handlers will manage the actual state
  }

  onCardClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    // Close hover card when clicking on any link or button (except menu button)
    if (target.closest('.menu-button')) {
      return; // Don't close for menu button
    }
    if (target.tagName === 'A' || target.closest('a') || target.tagName === 'BUTTON' || target.closest('button')) {
      setTimeout(() => this.hoverCardService.closeHoverCard(), 100);
    }
  }
}
