import { ChangeDetectionStrategy, Component, computed, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event as NostrEvent, nip19 } from 'nostr-tools';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { ContentComponent } from '../content/content.component';

/**
 * Profile metadata structure for kind 0 events
 */
interface ProfileMetadata {
  name?: string;
  display_name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
  lud06?: string;
}

/**
 * Component for rendering profile update events (kind 0) in the feed.
 * Shows a nice card with the user's updated profile information including
 * banner, picture, name, nip05, and bio.
 */
@Component({
  selector: 'app-profile-update-event',
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    ContentComponent,
  ],
  templateUrl: './profile-update-event.component.html',
  styleUrl: './profile-update-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileUpdateEventComponent {
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);

  event = input.required<NostrEvent>();

  // Parse the profile metadata from the event content
  profile = computed<ProfileMetadata | null>(() => {
    const nostrEvent = this.event();
    if (!nostrEvent || nostrEvent.kind !== 0) return null;

    try {
      return JSON.parse(nostrEvent.content) as ProfileMetadata;
    } catch {
      return null;
    }
  });

  // Get display name with fallbacks
  displayName = computed(() => {
    const profile = this.profile();
    if (!profile) return null;
    return profile.display_name || profile.displayName || profile.name || null;
  });

  // Get username/name
  username = computed(() => {
    const profile = this.profile();
    return profile?.name || null;
  });

  // Get NIP-05 identifier
  nip05 = computed(() => {
    const profile = this.profile();
    if (!profile?.nip05) return null;
    // Parse NIP-05 to show in a cleaner format
    const nip05 = profile.nip05;
    if (nip05.startsWith('_@')) {
      return nip05.substring(2); // Remove leading _@ for root identifiers
    }
    return nip05;
  });

  // Get lightning address
  lightningAddress = computed(() => {
    const profile = this.profile();
    return profile?.lud16 || null;
  });

  // Get website
  website = computed(() => {
    const profile = this.profile();
    return profile?.website || null;
  });

  // Get about/bio
  about = computed(() => {
    const profile = this.profile();
    return profile?.about || null;
  });

  // Get profile picture URL
  picture = computed(() => {
    const profile = this.profile();
    return profile?.picture || null;
  });

  // Get banner image URL
  banner = computed(() => {
    const profile = this.profile();
    return profile?.banner || null;
  });

  // Get the npub for the profile
  npub = computed(() => {
    const nostrEvent = this.event();
    if (!nostrEvent) return null;
    try {
      return nip19.npubEncode(nostrEvent.pubkey);
    } catch {
      return null;
    }
  });

  // Check if the current user is following this profile
  isFollowing = computed(() => {
    const nostrEvent = this.event();
    if (!nostrEvent) return false;
    return this.accountState.isFollowing()(nostrEvent.pubkey);
  });

  // Navigate to the full profile page
  navigateToProfile(): void {
    const nostrEvent = this.event();
    if (nostrEvent) {
      this.layout.openProfile(nostrEvent.pubkey);
    }
  }

  // Follow the user
  async followUser(mouseEvent: MouseEvent): Promise<void> {
    mouseEvent.stopPropagation();
    const nostrEvent = this.event();
    if (nostrEvent) {
      await this.accountState.follow(nostrEvent.pubkey);
    }
  }

  // Unfollow the user
  async unfollowUser(mouseEvent: MouseEvent): Promise<void> {
    mouseEvent.stopPropagation();
    const nostrEvent = this.event();
    if (nostrEvent) {
      await this.accountState.unfollow(nostrEvent.pubkey);
    }
  }

  // Handle image load error for profile picture
  onPictureError(errorEvent: globalThis.Event): void {
    const img = errorEvent.target as HTMLImageElement;
    if (img) {
      img.style.display = 'none';
    }
  }

  // Handle image load error for banner
  onBannerError(errorEvent: globalThis.Event): void {
    const img = errorEvent.target as HTMLImageElement;
    if (img) {
      img.style.display = 'none';
    }
  }
}
