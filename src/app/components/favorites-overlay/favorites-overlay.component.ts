import { Component, inject, computed, signal, effect, untracked, OnDestroy } from '@angular/core';

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
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { FollowingService } from '../../services/following.service';
import { UtilitiesService } from '../../services/utilities.service';

@Component({
  selector: 'app-favorites-overlay',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule
  ],
  templateUrl: './favorites-overlay.component.html',
  styleUrl: './favorites-overlay.component.scss',
})
export class FavoritesOverlayComponent implements OnDestroy {
  private router = inject(Router);
  private favoritesService = inject(FavoritesService);
  private data = inject(DataService);
  private timelineHoverCardService = inject(TimelineHoverCardService);
  private accountState = inject(AccountStateService);
  private imageCacheService = inject(ImageCacheService);
  private accountLocalState = inject(AccountLocalStateService);
  private followingService = inject(FollowingService);
  private utilities = inject(UtilitiesService);
  layout = inject(LayoutService);

  // Signal to track if overlay is visible
  isVisible = signal(false);

  // Signal to track if overlay is docked/pinned
  isDocked = signal(false);

  // Signal to track if overlay is collapsed (minimized)
  isCollapsed = signal(false);

  // Signal to track if currently dragging
  isDragging = signal(false);

  // Track drag state for custom drag-and-drop
  draggedIndex = signal<number | null>(null);
  dropTargetIndex = signal<number | null>(null);

  // Signal to track visible favorites count based on screen width
  visibleFavoritesCount = signal(5);

  // Track touch drag state
  private touchStartY = 0;
  private touchStartX = 0;
  private touchCurrentY = 0;
  private touchCurrentX = 0;
  private touchDragTimer: ReturnType<typeof setTimeout> | null = null;

  // Resize handler reference for cleanup
  private resizeHandler = () => this.updateVisibleFavoritesCount();

  // Get favorites from the service
  favorites = this.favoritesService.favorites;

  // Get all following from account state
  following = this.accountState.followingList;

  // Preload profiles for favorites - signal that gets updated by effect
  favoritesWithProfiles = signal<{ pubkey: string; profile?: NostrRecord }[]>([]);

  // Additional profiles fetched for following users not in FollowingService cache
  private additionalProfiles = signal<Map<string, NostrRecord>>(new Map());

  // Computed signal for following profiles - uses FollowingService.profiles() directly for reactivity
  // This ensures the UI updates when profiles are loaded
  followingWithProfiles = computed(() => {
    const followingList = this.following();
    // Track the profiles signal to ensure reactivity when profiles are loaded
    const allProfiles = this.followingService.profiles();
    // Also track additional profiles that were fetched separately
    const additionalProfilesMap = this.additionalProfiles();

    if (followingList.length === 0) {
      return [];
    }

    // Filter out invalid pubkeys to prevent rendering errors
    const validFollowingList = followingList.filter(pubkey => this.utilities.isValidPubkey(pubkey));

    // Map following list to profiles, using the reactive profiles array
    return validFollowingList.map((pubkey) => {
      const followingProfile = allProfiles.find(p => p.pubkey === pubkey);
      // Use FollowingService profile first, then fall back to additionally fetched profiles
      const profile = followingProfile?.profile || additionalProfilesMap.get(pubkey) || undefined;
      return { pubkey, profile };
    });
  });

  constructor() {
    // Initialize visible favorites count based on screen width
    this.updateVisibleFavoritesCount();
    
    // Listen for window resize to update visible count
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeHandler);
    }

    // Load docked preference from account local state
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const savedDocked = this.accountLocalState.getFollowingSidebarDocked(pubkey);
      if (savedDocked && !this.layout.isHandset()) {
        // Only restore docked state on desktop
        this.isDocked.set(true);
        this.isVisible.set(true);
      }
    }

    // Monitor screen size changes and auto-undock if screen becomes small
    effect(() => {
      const isHandset = this.layout.isHandset();
      if (isHandset && this.isDocked()) {
        // Auto-undock when screen becomes small
        this.isDocked.set(false);
        const pubkey = this.accountState.pubkey();
        if (pubkey) {
          this.accountLocalState.setFollowingSidebarDocked(pubkey, false);
        }
      }
    });

    // Effect to load profiles when favorites change - use cached profiles when available
    effect(() => {
      const favs = this.favorites();
      // Track FollowingService profiles to re-run when profiles are loaded
      // This ensures the effect re-runs when profiles become available
      const allProfiles = this.followingService.profiles();

      // Run untracked for the async operations to avoid re-triggering loops
      untracked(async () => {
        if (favs.length === 0) {
          this.favoritesWithProfiles.set([]);
          return;
        }

        // Filter out invalid pubkeys to prevent rendering errors
        const validFavs = favs.filter(pubkey => this.utilities.isValidPubkey(pubkey));

        if (validFavs.length === 0) {
          this.favoritesWithProfiles.set([]);
          return;
        }

        // Use profiles from FollowingService cache, only fetch if not available
        const profilesPromises = validFavs.map(async (pubkey) => {
          // First try to find in the already-loaded profiles array
          const followingProfile = allProfiles.find(p => p.pubkey === pubkey);
          if (followingProfile?.profile) {
            return { pubkey, profile: followingProfile.profile };
          }
          // Fallback to fetching if not in cache (e.g., favorited user not in following list)
          const profile = await this.data.getProfile(pubkey);
          return { pubkey, profile };
        });

        const profiles = await Promise.all(profilesPromises);
        this.favoritesWithProfiles.set(profiles);
      });
    });

    // Effect to fetch profiles for following users that don't have profile data yet
    // This fixes "Unknown" profiles that appear when FollowingService hasn't loaded all profiles
    effect(() => {
      const profiles = this.followingWithProfiles();
      // Also track the additional profiles to avoid fetching already-fetched ones
      const additionalProfilesMap = this.additionalProfiles();

      // Find profiles that are still missing (showing as "Unknown")
      const missingProfiles = profiles
        .filter(p => !p.profile)
        .map(p => p.pubkey)
        // Don't re-fetch profiles we've already tried to fetch
        .filter(pubkey => !additionalProfilesMap.has(pubkey))
        // Limit to avoid too many parallel requests
        .slice(0, 50);

      if (missingProfiles.length === 0) {
        return;
      }

      // Fetch missing profiles in the background
      untracked(async () => {
        const fetchedProfiles = await Promise.all(
          missingProfiles.map(async (pubkey) => {
            try {
              const profile = await this.data.getProfile(pubkey);
              return { pubkey, profile };
            } catch {
              return { pubkey, profile: undefined };
            }
          })
        );

        // Update the additional profiles map with newly fetched profiles
        const newMap = new Map(this.additionalProfiles());
        fetchedProfiles.forEach(({ pubkey, profile }) => {
          if (profile) {
            newMap.set(pubkey, profile);
          }
        });

        // Only update if we actually fetched new profiles
        if (newMap.size > additionalProfilesMap.size) {
          this.additionalProfiles.set(newMap);
        }
      });
    });
  }

  // Calculate visible favorites based on screen height (vertical sidebar)
  private updateVisibleFavoritesCount(): void {
    if (typeof window === 'undefined') {
      this.visibleFavoritesCount.set(5);
      return;
    }
    
    const height = window.innerHeight;
    // Each avatar takes approximately 48px (32px avatar + 8px gap + padding)
    // Reserve space for the "more" button (48px) and top/bottom padding (24px)
    // Available height for avatars = height - reserved space
    // The sidebar is vertically centered, so we use the full height
    
    const reservedSpace = 72; // more button + padding
    const avatarHeight = 48;
    const availableHeight = height - reservedSpace;
    const maxAvatars = Math.floor(availableHeight / avatarHeight);
    
    // Clamp between 3 and 15 avatars
    const count = Math.max(3, Math.min(15, maxAvatars));
    this.visibleFavoritesCount.set(count);
  }

  // Computed to get visible favorites based on screen size
  topFavorites = computed(() => {
    return this.favoritesWithProfiles().slice(0, this.visibleFavoritesCount());
  });

  // Computed to check if there are more favorites than shown
  hasMoreFavorites = computed(() => {
    return this.favorites().length > this.visibleFavoritesCount();
  });

  // Check if we should show the more button (has following beyond favorites)
  hasFollowing = computed(() => {
    return this.following().length > 0;
  });

  // Maximum number of profiles to show in overlay (excluding favorites)
  private readonly MAX_FOLLOWING_IN_OVERLAY = 200;

  // Favorites in the overlay - same as favoritesWithProfiles but matches the name pattern
  favoritesInOverlay = computed(() => {
    return this.favoritesWithProfiles();
  });

  // Non-favorites limited to MAX_FOLLOWING_IN_OVERLAY
  nonFavoritesInOverlay = computed(() => {
    const favPubkeys = this.favorites();
    const nonFavorites = this.followingWithProfiles().filter(item => !favPubkeys.includes(item.pubkey));
    return nonFavorites.slice(0, this.MAX_FOLLOWING_IN_OVERLAY);
  });

  // Check if there are more profiles beyond the overlay limit
  hasMoreFollowing = computed(() => {
    const favPubkeys = this.favorites();
    const nonFavoritesCount = this.followingWithProfiles().filter(item => !favPubkeys.includes(item.pubkey)).length;
    return nonFavoritesCount > this.MAX_FOLLOWING_IN_OVERLAY;
  });

  // Total count of following not shown in overlay
  remainingFollowingCount = computed(() => {
    const favPubkeys = this.favorites();
    const nonFavoritesCount = this.followingWithProfiles().filter(item => !favPubkeys.includes(item.pubkey)).length;
    return Math.max(0, nonFavoritesCount - this.MAX_FOLLOWING_IN_OVERLAY);
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

    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setFollowingSidebarDocked(pubkey, newDocked);
    }

    // If docking, ensure overlay is visible
    if (newDocked) {
      this.isVisible.set(true);
    }
  }

  toggleCollapse(): void {
    this.isCollapsed.update(v => !v);
  }

  onAvatarMouseEnter(event: MouseEvent, pubkey: string): void {
    // Don't show hover card while dragging
    if (this.isDragging()) {
      return;
    }
    const element = event.currentTarget as HTMLElement;
    this.timelineHoverCardService.showHoverCard(element, pubkey);
  }

  onAvatarMouseLeave(): void {
    this.timelineHoverCardService.hideHoverCard();
  }

  navigateToProfile(pubkey: string): void {
    this.hideOverlay();
    this.router.navigate([{ outlets: { right: ['p', pubkey] } }]);
  }

  navigateToPeople(): void {
    this.isVisible.set(false);
    this.router.navigate(['/people']);
  }

  getDisplayName(profile?: NostrRecord): string {
    if (!profile?.data) return 'Unknown';
    return profile.data.display_name || profile.data.name || 'Anonymous';
  }

  getAvatarUrl(profile?: NostrRecord): string | undefined {
    const pictureUrl = profile?.data?.picture;
    if (!pictureUrl) return undefined;

    // Use 96px (standard size for all profile images)
    return this.imageCacheService.getOptimizedImageUrl(pictureUrl);
  }

  getPreviewAvatarUrl(profile?: NostrRecord): string | undefined {
    const pictureUrl = profile?.data?.picture;
    if (!pictureUrl) return undefined;

    // Use 96px (standard size for all profile images)
    return this.imageCacheService.getOptimizedImageUrl(pictureUrl);
  }

  getInitials(profile?: NostrRecord): string {
    const displayName = this.getDisplayName(profile);
    if (displayName === 'Unknown' || displayName === 'Anonymous') return '?';

    const parts = displayName.split(' ').filter(p => p.length > 0);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Native HTML5 drag and drop handlers
  onDragStart(event: DragEvent, index: number): void {
    this.draggedIndex.set(index);
    this.isDragging.set(true);
    this.timelineHoverCardService.hideHoverCard();

    // Create a custom drag image from the entire button element
    if (event.dataTransfer && event.currentTarget) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', index.toString());

      // Clone the button element to use as drag image
      const draggedElement = event.currentTarget as HTMLElement;
      const clone = draggedElement.cloneNode(true) as HTMLElement;

      // Style the clone for better visibility
      clone.style.position = 'absolute';
      clone.style.top = '-9999px';
      clone.style.width = draggedElement.offsetWidth + 'px';
      clone.style.height = draggedElement.offsetHeight + 'px';
      clone.style.opacity = '0.9';
      clone.style.transform = 'rotate(3deg)';
      clone.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.3)';
      clone.style.borderRadius = '12px';
      clone.style.backgroundColor = 'var(--mat-sys-surface-container-high)';

      document.body.appendChild(clone);

      // Set the clone as the drag image
      event.dataTransfer.setDragImage(clone, draggedElement.offsetWidth / 2, draggedElement.offsetHeight / 2);

      // Remove the clone after a short delay
      setTimeout(() => {
        document.body.removeChild(clone);
      }, 0);
    }
  }

  onDragEnd(event: DragEvent): void {
    event.preventDefault();
    this.draggedIndex.set(null);
    this.dropTargetIndex.set(null);
    this.isDragging.set(false);
  }

  onDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    const draggedIdx = this.draggedIndex();
    if (draggedIdx !== null && draggedIdx !== index) {
      this.dropTargetIndex.set(index);
    }
  }

  onDragLeave(event: DragEvent): void {
    // Only clear if we're leaving the grid entirely
    const target = event.relatedTarget as HTMLElement;
    if (!target || !target.closest('.favorite-item')) {
      this.dropTargetIndex.set(null);
    }
  }

  onDrop(event: DragEvent, dropIndex: number): void {
    event.preventDefault();
    event.stopPropagation();

    const draggedIdx = this.draggedIndex();

    if (draggedIdx === null || draggedIdx === dropIndex) {
      this.draggedIndex.set(null);
      this.dropTargetIndex.set(null);
      this.isDragging.set(false);
      return;
    }

    // Get current favorites and reorder
    const currentFavorites = this.favorites();
    const reorderedFavorites = [...currentFavorites];

    // Remove dragged item and insert at drop position
    const [draggedItem] = reorderedFavorites.splice(draggedIdx, 1);
    reorderedFavorites.splice(dropIndex, 0, draggedItem);

    // Update the favorites with the new order
    this.favoritesService.reorderFavorites(reorderedFavorites);

    // Clear drag state
    this.draggedIndex.set(null);
    this.dropTargetIndex.set(null);
    this.isDragging.set(false);
  }

  // Touch event handlers for mobile support
  onTouchStart(event: TouchEvent, index: number): void {
    const touch = event.touches[0];
    this.touchStartY = touch.clientY;
    this.touchStartX = touch.clientX;
    this.touchCurrentY = touch.clientY;
    this.touchCurrentX = touch.clientX;

    // Clear any existing timer
    if (this.touchDragTimer) {
      clearTimeout(this.touchDragTimer);
    }

    // Reduced delay for better responsiveness (150ms instead of 300ms)
    this.touchDragTimer = setTimeout(() => {
      // Check if still touching roughly the same spot (not scrolling)
      const deltaX = Math.abs(this.touchCurrentX - this.touchStartX);
      const deltaY = Math.abs(this.touchCurrentY - this.touchStartY);

      // More lenient threshold to make it easier to trigger
      if (deltaX < 15 && deltaY < 15) {
        this.draggedIndex.set(index);
        this.isDragging.set(true);
        // Initialize drop target to provide immediate visual feedback
        this.dropTargetIndex.set(index);
        this.timelineHoverCardService.hideHoverCard();

        // Add haptic feedback if available
        if ('vibrate' in navigator) {
          navigator.vibrate(50);
        }
      }
    }, 150);
  }

  onTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];
    this.touchCurrentY = touch.clientY;
    this.touchCurrentX = touch.clientX;

    const draggedIdx = this.draggedIndex();

    if (draggedIdx === null) {
      return;
    }

    // Prevent scrolling while dragging - this is critical
    event.preventDefault();
    event.stopPropagation();

    // Find which element we're over
    // The dragged element has pointer-events: none, so this will see through it
    const elementAtPoint = document.elementFromPoint(touch.clientX, touch.clientY);

    if (!elementAtPoint) {
      return;
    }

    // Try to find the favorite-item button (could be the button itself or a child)
    const favoriteItem = elementAtPoint.closest('.favorite-item[data-index]') as HTMLElement;

    if (favoriteItem) {
      const dropIndexStr = favoriteItem.getAttribute('data-index');
      if (dropIndexStr !== null) {
        const dropIndex = parseInt(dropIndexStr, 10);
        if (!isNaN(dropIndex) && dropIndex >= 0) {
          // Always update drop target to provide visual feedback
          const currentDropTarget = this.dropTargetIndex();
          if (currentDropTarget !== dropIndex) {
            this.dropTargetIndex.set(dropIndex);
            // Haptic feedback when crossing into a new drop zone
            if ('vibrate' in navigator) {
              navigator.vibrate(10);
            }
          }
        }
      }
    }
  }

  onTouchEnd(event: TouchEvent): void {
    // Clear the drag timer if touch ends before it fires
    if (this.touchDragTimer) {
      clearTimeout(this.touchDragTimer);
      this.touchDragTimer = null;
    }

    const draggedIdx = this.draggedIndex();

    // If we never started dragging, this was just a tap - let the click handler take over
    if (draggedIdx === null) {
      return;
    }

    // Prevent click event from firing after drag
    event.preventDefault();

    // On touch end, try one more time to find the drop target
    // This handles cases where touchmove didn't fire or was inconsistent
    if (event.changedTouches && event.changedTouches.length > 0) {
      const touch = event.changedTouches[0];
      const elementAtPoint = document.elementFromPoint(touch.clientX, touch.clientY);

      if (elementAtPoint) {
        const favoriteItem = elementAtPoint.closest('.favorite-item[data-index]') as HTMLElement;

        if (favoriteItem) {
          const dropIndexStr = favoriteItem.getAttribute('data-index');
          if (dropIndexStr !== null) {
            const finalDropIndex = parseInt(dropIndexStr, 10);
            if (!isNaN(finalDropIndex) && finalDropIndex >= 0) {
              // Update drop target one final time
              this.dropTargetIndex.set(finalDropIndex);
            }
          }
        }
      }
    }

    // Read drop index after potential update
    const finalDropIdx = this.dropTargetIndex();

    if (finalDropIdx !== null && draggedIdx !== finalDropIdx) {
      // Perform the reorder
      const currentFavorites = this.favorites();
      const reorderedFavorites = [...currentFavorites];

      // Remove dragged item and insert at drop position
      const [draggedItem] = reorderedFavorites.splice(draggedIdx, 1);
      reorderedFavorites.splice(finalDropIdx, 0, draggedItem);

      // Update the favorites with the new order
      this.favoritesService.reorderFavorites(reorderedFavorites);

      // Haptic feedback for successful reorder
      if ('vibrate' in navigator) {
        navigator.vibrate(25);
      }
    }

    // Clear drag state
    this.draggedIndex.set(null);
    this.dropTargetIndex.set(null);
    this.isDragging.set(false);
  }

  onTouchCancel(): void {
    // Clear the drag timer
    if (this.touchDragTimer) {
      clearTimeout(this.touchDragTimer);
      this.touchDragTimer = null;
    }

    this.draggedIndex.set(null);
    this.dropTargetIndex.set(null);
    this.isDragging.set(false);
  }

  ngOnDestroy(): void {
    // Clean up resize listener
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeHandler);
    }
  }
}
