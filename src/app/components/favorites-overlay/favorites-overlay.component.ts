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
import { ImageCacheService } from '../../services/image-cache.service';

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
  private imageCacheService = inject(ImageCacheService);
  layout = inject(LayoutService);

  // Signal to track if overlay is visible
  isVisible = signal(false);

  // Signal to track if overlay is docked/pinned
  isDocked = signal(false);

  // Get favorites from the service
  favorites = this.favoritesService.favorites;

  // Get all following from account state
  following = this.accountState.followingList;

  // Preload profiles for favorites
  favoritesWithProfiles = signal<{ pubkey: string; profile?: NostrRecord }[]>([]);

  // Preload profiles for all following
  followingWithProfiles = signal<{ pubkey: string; profile?: NostrRecord }[]>([]);

  constructor() {
    // Load docked preference from localStorage
    const savedDocked = localStorage.getItem('followingSidebarDocked');
    if (savedDocked === 'true' && !this.layout.isHandset()) {
      // Only restore docked state on desktop
      this.isDocked.set(true);
      this.isVisible.set(true);
    }

    // Monitor screen size changes and auto-undock if screen becomes small
    effect(() => {
      const isHandset = this.layout.isHandset();
      if (isHandset && this.isDocked()) {
        // Auto-undock when screen becomes small
        this.isDocked.set(false);
        localStorage.setItem('followingSidebarDocked', 'false');
      }
    });

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

  toggleOverlay(): void {
    this.isVisible.update(v => !v);
  }

  showOverlay(): void {
    this.isVisible.set(true);
  }

  hideOverlay(): void {
    // Don't hide if docked
    if (this.isDocked()) {
      return;
    }
    this.isVisible.set(false);
  }

  toggleDock(): void {
    // Prevent docking on mobile
    if (this.layout.isHandset()) {
      return;
    }

    const newDocked = !this.isDocked();
    this.isDocked.set(newDocked);
    localStorage.setItem('followingSidebarDocked', String(newDocked));

    // If docking, ensure overlay is visible
    if (newDocked) {
      this.isVisible.set(true);
    }
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
    const pictureUrl = profile?.data?.picture;
    if (!pictureUrl) return undefined;

    // Always use the same size regardless of dock state to prevent re-downloading
    // Use 144px which works for both docked (56px display) and undocked (72px display)
    // This is 2x for retina displays in both cases
    return this.imageCacheService.getOptimizedImageUrl(pictureUrl, 144, 144);
  }

  getPreviewAvatarUrl(profile?: NostrRecord): string | undefined {
    const pictureUrl = profile?.data?.picture;
    if (!pictureUrl) return undefined;

    // Preview avatars are 36px, use 72px for retina displays
    return this.imageCacheService.getOptimizedImageUrl(pictureUrl, 72, 72);
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
