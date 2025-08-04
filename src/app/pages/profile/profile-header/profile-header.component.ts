import {
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  ElementRef,
  OnDestroy,
  AfterViewInit,
  computed,
} from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { MatListModule } from '@angular/material/list';
import { LayoutService } from '../../../services/layout.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProfileStateService } from '../../../services/profile-state.service';
import { NostrRecord } from '../../../interfaces';
import { isNip05, queryProfile } from 'nostr-tools/nip05';
import { AccountStateService } from '../../../services/account-state.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { QrCodeComponent } from '../../../components/qr-code/qr-code.component';
import { FavoritesService } from '../../../services/favorites.service';

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
    QrCodeComponent,
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

  // Add signal for QR code visibility
  showQrCode = signal<boolean>(false);
  showProfileQrCode = signal<boolean>(false);

  // Add signal for verified identifier
  verifiedIdentifier = signal<{
    value: string;
    valid: boolean;
    status: string;
  }>({ value: '', valid: false, status: '' });

  currentPubkey = computed(() => {
    return this.profile()?.event.pubkey || this.pubkey();
  });

  name = computed(() => {
    const profileData = this.profile();
    if (!profileData) {
      // Fallback to truncated pubkey when no profile exists
      return this.utilities.getTruncatedNpub(this.currentPubkey());
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
    return this.accountState.pubkey() === this.currentPubkey();
  });

  isFollowing = computed(() => {
    const followingList = this.accountState.followingList();
    return followingList.includes(this.pubkey());
  });

  isFavorite = computed(() => {
    return this.favoritesService.isFavorite(this.currentPubkey());
  });

  constructor() {
    effect(() => {
      const currentPubkey = this.currentPubkey();
      if (currentPubkey) {
        console.debug('LOCATION 4:');
        this.npub.set(this.utilities.getNpubFromPubkey(currentPubkey));
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

  muteUser(): void {
    const pubkey = this.currentPubkey();
    if (pubkey) {
      this.accountState.mutePubkey(pubkey);
    }
  }

  blockUser(): void {
    this.logger.debug('Block requested for:', this.currentPubkey());
    // TODO: Implement actual block functionality
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

  copyProfileData(): void {
    this.layout.copyToClipboard(this.profile()?.event.content, 'profile data');
  }

  copyFollowingList(): void {
    // Placeholder for actual implementation that would fetch the following list
    this.logger.debug('Copy following list requested for:', this.pubkey());
    this.layout.copyToClipboard(
      'Following list not implemented yet',
      'following list'
    );
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

  toggleFavorite(): void {
    const currentPubkey = this.currentPubkey();
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
}
