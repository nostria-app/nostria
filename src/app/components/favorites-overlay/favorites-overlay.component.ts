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

  // Signal to track if currently dragging
  isDragging = signal(false);

  // Track drag state for custom drag-and-drop
  draggedIndex = signal<number | null>(null);
  dropTargetIndex = signal<number | null>(null);

  // Track touch drag state
  private touchStartY = 0;
  private touchStartX = 0;
  private touchCurrentY = 0;
  private touchCurrentX = 0;
  private touchDragTimer: ReturnType<typeof setTimeout> | null = null;

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

  // Favorites in the overlay - same as favoritesWithProfiles but matches the name pattern
  favoritesInOverlay = computed(() => {
    return this.favoritesWithProfiles();
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
}
