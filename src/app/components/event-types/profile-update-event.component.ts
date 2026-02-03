import { Component, computed, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event as NostrEvent, nip19 } from 'nostr-tools';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { ContentComponent } from '../content/content.component';
import { UtilitiesService } from '../../services/utilities.service';

/**
 * Profile metadata structure for kind 0 events
 * Supports both single values and arrays for multi-value fields
 */
interface ProfileMetadata {
  name?: string;
  display_name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string | string[];
  nip05?: string | string[];
  lud16?: string | string[];
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
})
export class ProfileUpdateEventComponent {
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);
  private utilities = inject(UtilitiesService);

  event = input.required<NostrEvent>();

  // Parse the profile metadata from the event content, checking tags first
  profile = computed<ProfileMetadata | null>(() => {
    const nostrEvent = this.event();
    if (!nostrEvent || nostrEvent.kind !== 0) return null;

    try {
      // Check if event has profile tags (new format)
      if (this.utilities.hasProfileTags(nostrEvent.tags)) {
        const fromTags = this.utilities.parseProfileFromTags(nostrEvent.tags);

        // Try to parse JSON content as well for fallback/merge
        let fromContent: Record<string, unknown> = {};
        try {
          if (nostrEvent.content) {
            fromContent = JSON.parse(nostrEvent.content);
          }
        } catch {
          // Content parsing failed, use tags only
        }

        // Merge with tags taking priority
        return this.utilities.mergeProfileData(fromTags, fromContent) as ProfileMetadata;
      }

      // Fall back to traditional JSON content parsing
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

  // Get NIP-05 identifiers as array (supports multiple values)
  nip05List = computed<string[]>(() => {
    const profile = this.profile();
    if (!profile?.nip05) return [];

    const nip05Data = profile.nip05;
    const values = Array.isArray(nip05Data) ? nip05Data : [nip05Data];

    // Clean up each NIP-05 value
    return values.map(nip05 => {
      if (nip05.startsWith('_@')) {
        return nip05.substring(2); // Remove leading _@ for root identifiers
      }
      return nip05;
    }).filter(v => v && v.trim() !== '');
  });

  // Get first NIP-05 for backwards compatibility
  nip05 = computed(() => {
    const list = this.nip05List();
    return list.length > 0 ? list[0] : null;
  });

  // Get lightning address (first value only, as per requirements)
  lightningAddress = computed(() => {
    const profile = this.profile();
    if (!profile?.lud16) return null;
    const lud16Data = profile.lud16;
    return Array.isArray(lud16Data) ? lud16Data[0] || null : lud16Data;
  });

  // Get websites as array (supports multiple values)
  websiteList = computed<string[]>(() => {
    const profile = this.profile();
    if (!profile?.website) return [];
    const websiteData = profile.website;
    const values = Array.isArray(websiteData) ? websiteData : [websiteData];
    return values.filter(v => v && v.trim() !== '');
  });

  // Get first website for backwards compatibility
  website = computed(() => {
    const list = this.websiteList();
    return list.length > 0 ? list[0] : null;
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
