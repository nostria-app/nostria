import { Component, inject, computed, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { FavoritesService } from '../../services/favorites.service';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';
import { LayoutService } from '../../services/layout.service';
import { TimelineHoverCardService } from '../../services/timeline-hover-card.service';
import { AccountStateService } from '../../services/account-state.service';

@Component({
  selector: 'app-favorites-overlay',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './favorites-overlay.component.html',
  styleUrl: './favorites-overlay.component.scss',
})
export class FavoritesOverlayComponent {
  private router = inject(Router);
  private favoritesService = inject(FavoritesService);
  private data = inject(DataService);
  private timelineHoverCardService = inject(TimelineHoverCardService);
  private accountState = inject(AccountStateService);
  layout = inject(LayoutService);

  // Signal to track if overlay is visible
  isVisible = signal(false);

  // Track mouse position over container and overlay
  private isMouseOverContainer = signal(false);
  private isMouseOverOverlay = signal(false);
  private hideTimeout?: number;

  // Get favorites from the service
  favorites = this.favoritesService.favorites;

  // Get all following from account state
  following = this.accountState.followingList;

  // Preload profiles for favorites
  favoritesWithProfiles = signal<{ pubkey: string; profile?: NostrRecord }[]>([]);

  // Preload profiles for all following
  followingWithProfiles = signal<{ pubkey: string; profile?: NostrRecord }[]>([]);

  constructor() {
    // Effect to load profiles when favorites change
    effect(() => {
      const favs = this.favorites();

      // Run async operations untracked
      untracked(async () => {
        if (favs.length === 0) {
          this.favoritesWithProfiles.set([]);
          return;
        }

        const profilesPromises = favs.map(async (pubkey) => {
          const profile = await this.data.getProfile(pubkey);
          return { pubkey, profile };
        });

        const profiles = await Promise.all(profilesPromises);
        this.favoritesWithProfiles.set(profiles);
      });
    });

    // Effect to load profiles for all following
    effect(() => {
      const followingList = this.following();

      // Run async operations untracked
      untracked(async () => {
        if (followingList.length === 0) {
          this.followingWithProfiles.set([]);
          return;
        }

        const profilesPromises = followingList.map(async (pubkey) => {
          const profile = await this.data.getProfile(pubkey);
          return { pubkey, profile };
        });

        const profiles = await Promise.all(profilesPromises);
        this.followingWithProfiles.set(profiles);
      });
    });
  }

  // Computed to get top 5 favorites
  topFavorites = computed(() => {
    return this.favoritesWithProfiles().slice(0, 5);
  });

  // Computed to check if there are more than 5 favorites
  hasMoreFavorites = computed(() => {
    return this.favorites().length > 5;
  });

  // Check if we should show the more button (has following beyond favorites)
  hasFollowing = computed(() => {
    return this.following().length > 0;
  });

  // Split following into favorites and non-favorites for the overlay
  favoritesInOverlay = computed(() => {
    const favPubkeys = this.favorites();
    return this.followingWithProfiles().filter(item => favPubkeys.includes(item.pubkey));
  });

  nonFavoritesInOverlay = computed(() => {
    const favPubkeys = this.favorites();
    return this.followingWithProfiles().filter(item => !favPubkeys.includes(item.pubkey));
  });

  onContainerMouseEnter(): void {
    this.isMouseOverContainer.set(true);
    if (this.hideTimeout) {
      window.clearTimeout(this.hideTimeout);
      this.hideTimeout = undefined;
    }
  }

  onContainerMouseLeave(): void {
    this.isMouseOverContainer.set(false);
    this.scheduleHide();
  }

  onOverlayMouseEnter(): void {
    this.isMouseOverOverlay.set(true);
    if (this.hideTimeout) {
      window.clearTimeout(this.hideTimeout);
      this.hideTimeout = undefined;
    }
  }

  onOverlayMouseLeave(): void {
    this.isMouseOverOverlay.set(false);
    this.scheduleHide();
  }

  private scheduleHide(): void {
    if (this.hideTimeout) {
      window.clearTimeout(this.hideTimeout);
    }

    // Add 300ms delay before hiding to allow moving to hover card
    this.hideTimeout = window.setTimeout(() => {
      if (!this.isMouseOverContainer() && !this.isMouseOverOverlay()) {
        this.isVisible.set(false);
      }
    }, 300);
  }

  toggleOverlay(): void {
    this.isVisible.update(v => !v);
  }

  showOverlay(): void {
    this.isVisible.set(true);
  }

  hideOverlay(): void {
    this.isVisible.set(false);
  }

  onAvatarMouseEnter(event: MouseEvent, pubkey: string): void {
    const element = event.currentTarget as HTMLElement;
    this.timelineHoverCardService.showHoverCard(element, pubkey);
  }

  onAvatarMouseLeave(): void {
    this.timelineHoverCardService.hideHoverCard();
  }

  navigateToProfile(pubkey: string): void {
    this.hideOverlay();
    this.router.navigate(['/p', pubkey]);
  }

  getDisplayName(profile?: NostrRecord): string {
    if (!profile?.data) return 'Unknown';
    return profile.data.display_name || profile.data.name || 'Anonymous';
  }

  getAvatarUrl(profile?: NostrRecord): string | undefined {
    return profile?.data?.picture;
  }

  getInitials(profile?: NostrRecord): string {
    const displayName = this.getDisplayName(profile);
    if (displayName === 'Unknown' || displayName === 'Anonymous') return '?';

    const parts = displayName.split(' ').filter(p => p.length > 0);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
}
