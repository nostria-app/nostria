import { Component, effect, inject, input, signal, untracked, computed } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { MatListModule } from '@angular/material/list';
import { LayoutService } from '../../../services/layout.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProfileStateService } from '../../../services/profile-state.service';
import { NostrRecord } from '../../../interfaces';
import { isNip05, queryProfile } from 'nostr-tools/nip05';
import { AccountStateService } from '../../../services/account-state.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { QrCodeComponent } from '../../../components/qr-code/qr-code.component';
import { FavoritesService } from '../../../services/favorites.service';
import { MatDialog } from '@angular/material/dialog';
import { AccountService } from '../../../api/services';
import { PublicAccount } from '../../../api/models';
import { firstValueFrom } from 'rxjs';
import {
  PublishDialogComponent,
  PublishDialogData,
} from '../../../components/publish-dialog/publish-dialog.component';
import { kinds } from 'nostr-tools';
import { StorageService } from '../../../services/storage.service';
import type { ReportTarget } from '../../../services/reporting.service';
import { ReportingService } from '../../../services/reporting.service';
import { ZapButtonComponent } from '../../../components/zap-button/zap-button.component';
import { ZapService } from '../../../services/zap.service';
import {
  ZapDialogComponent,
  ZapDialogData,
} from '../../../components/zap-dialog/zap-dialog.component';
import { UserRelayService } from '../../../services/relays/user-relay';

@Component({
  selector: 'app-profile-header',
  standalone: true,
  imports: [
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    RouterModule,
    MatButtonModule,
    MatDividerModule,
    MatTooltipModule,
    QrCodeComponent,
    ZapButtonComponent,
  ],
  templateUrl: './profile-header.component.html',
  styleUrl: './profile-header.component.scss',
})
export class ProfileHeaderComponent {
  profile = input<NostrRecord | undefined>(undefined);
  pubkey = input<string>(''); // Add pubkey input for cases where no profile exists
  layout = inject(LayoutService);
  nostr = inject(NostrService);
  npub = signal<string | undefined>(undefined);
  logger = inject(LoggerService);
  compact = input<boolean>(false);
  profileState = inject(ProfileStateService);
  accountState = inject(AccountStateService);
  utilities = inject(UtilitiesService);
  layoutService = inject(LayoutService);
  private snackBar = inject(MatSnackBar);
  private favoritesService = inject(FavoritesService);
  private dialog = inject(MatDialog);
  private storage = inject(StorageService);
  private accountService = inject(AccountService);
  private reportingService = inject(ReportingService);
  private zapService = inject(ZapService);
  private userRelayService = inject(UserRelayService);

  // Add signal for QR code visibility
  showQrCode = signal<boolean>(false);
  showProfileQrCode = signal<boolean>(false);

  // Add signal for bio expansion
  isBioExpanded = signal<boolean>(false);

  // Computed property to check if bio needs expansion
  shouldShowExpander = computed(() => {
    const about = this.profile()?.data.about;
    if (!about || this.compact()) return false;

    // Split by actual newlines to count lines
    const lines = about.split('\n');

    // If there are more than 3 newline-separated lines, show expander
    if (lines.length > 3) return true;

    // Check if any of the first 3 lines are very long (more than 80 chars)
    // which would likely wrap to multiple lines
    const firstThreeLines = lines.slice(0, 3);
    const hasLongLine = firstThreeLines.some((line: string) => line.length > 80);

    // Estimate total character count that would fit in 3 lines
    // Using conservative estimate of ~80 chars per line = 240 chars total
    const totalLength = firstThreeLines.reduce((sum: number, line: string) => sum + line.length, 0);

    return hasLongLine && totalLength > 240;
  });

  // Computed property for displayed bio text
  displayedBio = computed(() => {
    const about = this.profile()?.data.about;
    if (!about || this.compact() || this.isBioExpanded() || !this.shouldShowExpander()) {
      return about;
    }

    // Truncate to approximately 3 lines worth of text
    const lines = about.split('\n');
    if (lines.length <= 3) {
      return about.length > 240 ? about.substring(0, 240) + '...' : about;
    }

    return lines.slice(0, 3).join('\n') + '...';
  });

  // Computed to get website URL with protocol prefix
  websiteUrl = computed(() => {
    const website = this.profile()?.data.website;
    if (!website) {
      return '';
    }

    // Check if the website already has a protocol prefix
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(website)) {
      return website;
    }

    // If no protocol prefix, add https:// as default
    return `https://${website}`;
  });

  // Add signal for verified identifier
  verifiedIdentifier = signal<{
    value: string;
    valid: boolean;
    status: string;
  }>({ value: '', valid: false, status: '' });

  name = computed(() => {
    const profileData = this.profile();
    if (!profileData) {
      // Fallback to truncated pubkey when no profile exists
      return this.utilities.getTruncatedNpub(this.pubkey());
    }

    if (profileData.data.display_name) {
      return profileData.data.display_name;
    } else if (profileData.data.name) {
      return profileData.data.name;
    } else {
      return this.utilities.getTruncatedNpub(profileData.event.pubkey);
    }
  });

  isOwnProfile = computed(() => {
    return this.accountState.pubkey() === this.pubkey();
  });

  isFollowing = computed(() => {
    const followingList = this.accountState.followingList();
    return followingList.includes(this.pubkey());
  });

  // Check if the profile being viewed is following the logged-in user
  isFollowingMe = computed(() => {
    const myPubkey = this.accountState.pubkey();
    const theirFollowingList = this.profileState.followingList();
    return myPubkey ? theirFollowingList.includes(myPubkey) : false;
  });

  isFavorite = computed(() => {
    return this.favoritesService.isFavorite(this.pubkey());
  });

  getUserRelays = computed(() => {
    const pubkey = this.profileState.pubkey();
    if (!pubkey) return [];
    return this.userRelayService.getRelaysForPubkey(pubkey) || [];
  });

  // Check if the current user is blocked
  isUserBlocked = computed(() => {
    const pubkey = this.pubkey();
    if (!pubkey || this.isOwnProfile()) return false;
    return this.reportingService.isUserBlocked(pubkey);
  });

  // Signal to track the premium status
  premiumTier = signal<string | null>(null);

  // Signal to track the username of the profile being viewed
  profileUsername = signal<string | null>(null);

  // Computed to check if user has premium subscription
  isPremium = computed(() => {
    const tier = this.premiumTier();
    return tier === 'premium' || tier === 'premium_plus';
  });

  // Computed to check if the profile has a Lightning Address configured
  hasLightningAddress = computed(() => {
    const profileData = this.profile()?.data;
    if (!profileData) return false;
    return this.zapService.getLightningAddress(profileData) !== null;
  });

  constructor() {
    effect(() => {
      const currentPubkey = this.pubkey();
      if (currentPubkey) {
        console.debug('LOCATION 4:');
        this.npub.set(this.utilities.getNpubFromPubkey(currentPubkey));
      }
    });

    // Add effect to fetch premium status when pubkey changes
    effect(async () => {
      const currentPubkey = this.pubkey();
      if (currentPubkey) {
        await this.fetchPremiumStatus(currentPubkey);
      }
    });

    // Add effect to verify identifier when profile changes
    effect(async () => {
      const currentProfile = this.profile();
      if (currentProfile?.data.nip05) {
        const result = await this.getVerifiedIdentifier();
        untracked(() => {
          this.verifiedIdentifier.set(result);
        });
      } else {
        untracked(() => {
          this.verifiedIdentifier.set({
            value: '',
            valid: false,
            status: 'No NIP-05 value',
          });
        });
      }
    });

    // Load favorites from localStorage
    // No need to load favorites here as the service handles it automatically
  }

  blockUser(): void {
    const pubkey = this.pubkey();
    if (pubkey) {
      if (this.isUserBlocked()) {
        // User is already blocked, so unblock them
        this.reportingService.unblockUser(pubkey);
      } else {
        // User is not blocked, so block them
        this.reportingService.muteUser(pubkey);
      }
    }
  }

  reportUser(): void {
    const pubkey = this.pubkey();
    if (!pubkey) {
      return;
    }

    const displayName = this.profile()?.data.display_name || this.profile()?.data.name || '';

    const reportTarget: ReportTarget = {
      type: 'user',
      pubkey: pubkey,
    };

    this.layout.showReportDialog(reportTarget, displayName);
  }

  /**
   * Follows the user
   */
  async followUser() {
    this.logger.debug('Follow requested for:', this.pubkey());
    await this.accountState.follow(this.pubkey());
  }

  async unfollowUser() {
    this.logger.debug('Unfollow requested for:', this.pubkey());
    await this.accountState.unfollow(this.pubkey());
  }

  /**
   * Opens the zap dialog for the user
   */
  zapUser(): void {
    const pubkey = this.pubkey();
    const profileData = this.profile()?.data;

    if (!pubkey) {
      this.snackBar.open('Unable to determine user for zap', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    if (!profileData || !this.hasLightningAddress()) {
      this.snackBar.open('This user has no lightning address configured for zaps', 'Dismiss', {
        duration: 4000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    const dialogData: ZapDialogData = {
      recipientPubkey: pubkey,
      recipientName: this.name(),
      recipientMetadata: profileData,
      eventId: undefined, // This is for zapping a user, not a specific event
    };

    this.dialog.open(ZapDialogComponent, {
      data: dialogData,
      width: '400px',
      maxWidth: '95vw',
      disableClose: false,
    });
  }

  copyProfileData(): void {
    this.layout.copyToClipboard(this.profile()?.event.content, 'profile data');
  }

  copyFollowingList(): void {
    // Placeholder for actual implementation that would fetch the following list
    this.logger.debug('Copy following list requested for:', this.pubkey());
    this.layout.copyToClipboard('Following list not implemented yet', 'following list');
  }

  copyRelayList(): void {
    // Placeholder for actual implementation that would fetch the relay list
    this.logger.debug('Copy relay list requested for:', this.pubkey());
    this.layout.copyToClipboard('Relay list not implemented yet', 'relay list');
  }

  getDefaultBanner(): string {
    // Return a default gradient for users without a banner
    return 'linear-gradient(135deg, #8e44ad, #3498db)';
  }

  private async getVerifiedIdentifier(): Promise<{
    value: string;
    valid: boolean;
    status: string;
  }> {
    const metadata = this.profile();
    if (!metadata || !metadata.data.nip05)
      return { value: '', valid: false, status: 'No NIP-05 value' };

    const value = this.utilities.parseNip05(metadata.data.nip05);

    if (isNip05(metadata.data.nip05)) {
      const profile = await queryProfile(metadata.data.nip05);

      if (profile) {
        if (profile.pubkey === metadata.event.pubkey) {
          return { value, valid: true, status: 'Verified valid' };
        } else {
          this.logger.warn(
            'NIP-05 profile pubkey mismatch:',
            profile.pubkey,
            metadata.event.pubkey
          );
        }
      }
    }

    return { value, valid: false, status: 'Invalid NIP-05' };
  }

  // Add methods for QR code visibility
  showQrCodeHandler(): void {
    this.showQrCode.set(true);
  }

  hideQrCodeHandler(): void {
    this.showQrCode.set(false);
  }

  toggleQrCodeHandler(): void {
    this.showQrCode.set(!this.showQrCode());
  }

  showProfileQrCodeHandler(): void {
    this.showProfileQrCode.set(true);
  }

  hideProfileQrCodeHandler(): void {
    this.showProfileQrCode.set(false);
  }

  toggleProfileQrCodeHandler(): void {
    this.showProfileQrCode.set(!this.showProfileQrCode());
  }

  copyNpubToClipboard(): void {
    const npubValue = this.npub();
    if (npubValue) {
      this.layout.copyToClipboard(npubValue, 'npub');
    }
  }

  copyLightningAddressToClipboard(): void {
    const profile = this.profile();
    const lightningAddress = profile?.data.lud16 || profile?.data.lud06;
    if (lightningAddress) {
      this.layout.copyToClipboard(lightningAddress, 'lightning address');
    }
  }

  toggleFavorite(): void {
    const currentPubkey = this.pubkey();
    if (!currentPubkey) return;

    const success = this.favoritesService.toggleFavorite(currentPubkey);
    if (success) {
      const isFavorite = this.favoritesService.isFavorite(currentPubkey);
      if (isFavorite) {
        this.snackBar.open('Added to favorites', 'Close', { duration: 2000 });
      } else {
        this.snackBar.open('Removed from favorites', 'Close', {
          duration: 2000,
        });
      }
    }
  }

  async publishProfileEvent(): Promise<void> {
    const currentProfile = this.profile();
    if (!currentProfile) {
      this.snackBar.open('Profile not found', 'Close', { duration: 2000 });
      return;
    }

    const dialogData: PublishDialogData = {
      event: currentProfile.event,
    };

    this.dialog.open(PublishDialogComponent, {
      data: dialogData,
      width: '600px',
      disableClose: false,
    });
  }

  async publishRelayListEvent(): Promise<void> {
    const currentPubkey = this.pubkey();
    if (!currentPubkey) {
      this.snackBar.open('Profile not found', 'Close', { duration: 2000 });
      return;
    }

    try {
      // Get the relay list event (kind 10002)
      const relayListEvent = await this.storage.getEventByPubkeyAndKind(
        currentPubkey,
        kinds.RelayList
      );

      if (!relayListEvent) {
        this.snackBar.open('Relay list not found', 'Close', {
          duration: 2000,
        });
        return;
      }

      const dialogData: PublishDialogData = {
        event: relayListEvent,
      };

      this.dialog.open(PublishDialogComponent, {
        data: dialogData,
        width: '600px',
        disableClose: false,
      });
    } catch (error) {
      this.logger.error('Error getting relay list event:', error);
      this.snackBar.open('Error loading relay list', 'Close', {
        duration: 2000,
      });
    }
  }

  async publishFollowingListEvent(): Promise<void> {
    const currentPubkey = this.pubkey();
    if (!currentPubkey) {
      this.snackBar.open('Profile not found', 'Close', { duration: 2000 });
      return;
    }

    try {
      // Get the following list event (kind 3)
      const followingListEvent = await this.storage.getEventByPubkeyAndKind(
        currentPubkey,
        kinds.Contacts
      );

      if (!followingListEvent) {
        this.snackBar.open('Following list not found', 'Close', {
          duration: 2000,
        });
        return;
      }

      const dialogData: PublishDialogData = {
        event: followingListEvent,
      };

      this.dialog.open(PublishDialogComponent, {
        data: dialogData,
        width: '600px',
        disableClose: false,
      });
    } catch (error) {
      this.logger.error('Error getting following list event:', error);
      this.snackBar.open('Error loading following list', 'Close', {
        duration: 2000,
      });
    }
  }

  /**
   * Toggles the bio expansion state
   */
  toggleBioExpansion(): void {
    this.isBioExpanded.update(expanded => !expanded);
  }

  /**
   * Fetches the premium status for a given pubkey
   */
  private async fetchPremiumStatus(pubkey: string): Promise<void> {
    try {
      // Check if this is the current user
      if (this.isOwnProfile()) {
        // For current user, get tier from account state
        const subscription = this.accountState.subscription();
        this.premiumTier.set(subscription?.tier || null);
        this.profileUsername.set(subscription?.username || null);
      } else {
        // For other users, fetch public account information
        const result = await firstValueFrom(
          this.accountService.getPublicAccount({
            pubkeyOrUsername: pubkey,
          })
        );

        if (result?.result) {
          const publicAccount: PublicAccount = result.result;
          this.premiumTier.set(publicAccount?.tier || null);
          this.profileUsername.set(publicAccount?.username || null);
        } else {
          this.premiumTier.set(null);
          this.profileUsername.set(null);
        }
      }
    } catch (error) {
      this.logger.debug('Error fetching premium status:', error);
      this.premiumTier.set(null);
      this.profileUsername.set(null);
    }
  }
}
