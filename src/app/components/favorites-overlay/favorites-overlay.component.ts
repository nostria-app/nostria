import { Component, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { FavoritesService } from '../../services/favorites.service';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';
import { LayoutService } from '../../services/layout.service';

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
  layout = inject(LayoutService);

  // Signal to track if overlay is visible
  isVisible = signal(false);

  // Get favorites from the service
  favorites = this.favoritesService.favorites;

  // Preload profiles for favorites
  favoritesWithProfiles = signal<{ pubkey: string; profile?: NostrRecord }[]>([]);

  constructor() {
    // Effect to load profiles when favorites change
    effect(async () => {
      const favs = this.favorites();
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
  }

  // Computed to get top 5 favorites
  topFavorites = computed(() => {
    return this.favoritesWithProfiles().slice(0, 5);
  });

  // Computed to check if there are more than 5 favorites
  hasMoreFavorites = computed(() => {
    return this.favorites().length > 5;
  });

  toggleOverlay(): void {
    this.isVisible.update(v => !v);
  }

  showOverlay(): void {
    this.isVisible.set(true);
  }

  hideOverlay(): void {
    this.isVisible.set(false);
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
