import { Component, inject, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatBadgeModule } from '@angular/material/badge';
import { MatChipsModule } from '@angular/material/chips';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { Router } from '@angular/router';
import { ShoutoutService, Shoutout } from '../../services/shoutout.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { TimelineHoverCardService } from '../../services/timeline-hover-card.service';
import { AccountStateService } from '../../services/account-state.service';
import { ImageCacheService } from '../../services/image-cache.service';
import { FavoritesService } from '../../services/favorites.service';
import { FollowingService } from '../../services/following.service';
import { NostrRecord } from '../../interfaces';
import { DatePipe } from '@angular/common';

interface RecipientOption {
  pubkey: string;
  profile?: NostrRecord;
  displayName: string;
  isFavorite: boolean;
}

@Component({
  selector: 'app-shoutout-overlay',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatBadgeModule,
    MatChipsModule,
    MatAutocompleteModule,
    FormsModule,
    DatePipe,
  ],
  templateUrl: './shoutout-overlay.component.html',
  styleUrl: './shoutout-overlay.component.scss',
})
export class ShoutoutOverlayComponent {
  private router = inject(Router);
  private shoutoutService = inject(ShoutoutService);
  private data = inject(DataService);
  private timelineHoverCardService = inject(TimelineHoverCardService);
  private accountState = inject(AccountStateService);
  private imageCacheService = inject(ImageCacheService);
  private favoritesService = inject(FavoritesService);
  private followingService = inject(FollowingService);
  layout = inject(LayoutService);

  // Signal to track if overlay is visible - now uses LayoutService for global control
  isVisible = this.layout.showShoutoutOverlay;

  // Signal to track if showing only favorites
  showFavoritesOnly = signal(false);

  // Signal for new shoutout input
  newShoutoutContent = signal('');

  // Signal to track if sending
  isSending = signal(false);

  // Signal for selected recipients
  selectedRecipients = signal<RecipientOption[]>([]);

  // Signal for recipient search input
  recipientSearchInput = signal('');

  // Signal to show/hide recipient picker
  showRecipientPicker = signal(false);

  // Signal to track the shoutout whose receivers are being viewed
  viewingReceiversFor = signal<Shoutout | null>(null);

  // Signal to show/hide the info card
  showInfoCard = signal(false);

  // Signal to store loaded receiver profiles
  receiverProfiles = signal<Map<string, NostrRecord | null>>(new Map());

  // Get shoutouts from the service
  allShoutouts = this.shoutoutService.shoutouts;
  shoutoutsFromFavorites = this.shoutoutService.shoutoutsFromFavorites;
  isLoading = this.shoutoutService.isLoading;
  recentCount = this.shoutoutService.recentShoutoutsCount;

  // Get favorites for recipient options
  favorites = this.favoritesService.favorites;

  // Get current user's pubkey to identify sent shoutouts
  currentUserPubkey = this.accountState.pubkey;

  // Computed: all available recipients (favorites first, then following)
  availableRecipients = computed(() => {
    const favPubkeys = this.favorites();
    const selectedPubkeys = this.selectedRecipients().map(r => r.pubkey);
    const currentPubkey = this.accountState.pubkey();
    const allProfiles = this.followingService.profiles();

    const recipients: RecipientOption[] = [];
    const addedPubkeys = new Set<string>();

    // Add favorites first
    for (const pubkey of favPubkeys) {
      if (pubkey === currentPubkey || addedPubkeys.has(pubkey) || selectedPubkeys.includes(pubkey)) continue;
      const profileData = allProfiles.find(p => p.pubkey === pubkey);
      const profile = profileData?.profile ?? undefined;
      const displayName = this.getDisplayNameFromProfile(profile);
      recipients.push({
        pubkey,
        profile,
        displayName,
        isFavorite: true,
      });
      addedPubkeys.add(pubkey);
    }

    // Add all following (non-favorites)
    for (const profileData of allProfiles) {
      const pubkey = profileData.pubkey;
      if (pubkey === currentPubkey || addedPubkeys.has(pubkey) || selectedPubkeys.includes(pubkey)) continue;
      const profile = profileData.profile ?? undefined;
      const displayName = this.getDisplayNameFromProfile(profile);
      recipients.push({
        pubkey,
        profile,
        displayName,
        isFavorite: false,
      });
      addedPubkeys.add(pubkey);
    }

    return recipients;
  });

  // Computed: filtered recipients based on search
  filteredRecipients = computed(() => {
    const search = this.recipientSearchInput().toLowerCase().trim();
    const all = this.availableRecipients();

    if (!search) {
      // Show favorites first when no search, limited to 10
      return all.slice(0, 10);
    }

    // When searching, filter all recipients and show up to 20 results
    return all.filter(r => {
      const profile = r.profile?.data;
      const name = profile?.name?.toLowerCase() || '';
      const displayName = profile?.display_name?.toLowerCase() || '';
      const nip05 = profile?.nip05?.toLowerCase() || '';

      return (
        name.includes(search) ||
        displayName.includes(search) ||
        nip05.includes(search) ||
        r.pubkey.toLowerCase().includes(search)
      );
    }).slice(0, 20);
  });

  // Computed: displayed shoutouts based on filter
  displayedShoutouts = computed(() => {
    if (this.showFavoritesOnly()) {
      return this.shoutoutsFromFavorites();
    }
    return this.allShoutouts();
  });

  // Computed: badge count for the button
  badgeCount = computed(() => {
    const count = this.recentCount();
    return count > 0 ? count : null;
  });

  private getDisplayNameFromProfile(profile?: NostrRecord): string {
    if (!profile?.data) return 'Unknown';
    return profile.data.display_name || profile.data.name || 'Anonymous';
  }

  toggleOverlay(): void {
    const wasVisible = this.isVisible();
    this.layout.toggleShoutouts();
    // Refresh when opening
    if (!wasVisible) {
      this.shoutoutService.refresh();
    }
  }

  showOverlay(): void {
    this.layout.openShoutouts();
    this.shoutoutService.refresh();
  }

  hideOverlay(): void {
    this.layout.closeShoutouts();
  }

  toggleFavoritesFilter(): void {
    this.showFavoritesOnly.update(v => !v);
  }

  toggleRecipientPicker(): void {
    this.showRecipientPicker.update(v => !v);
    if (!this.showRecipientPicker()) {
      this.recipientSearchInput.set('');
    }
  }

  toggleInfoCard(): void {
    this.showInfoCard.update(v => !v);
  }

  addRecipient(recipient: RecipientOption): void {
    const current = this.selectedRecipients();
    if (!current.find(r => r.pubkey === recipient.pubkey)) {
      this.selectedRecipients.set([...current, recipient]);
    }
    this.recipientSearchInput.set('');
  }

  removeRecipient(pubkey: string): void {
    this.selectedRecipients.update(recipients =>
      recipients.filter(r => r.pubkey !== pubkey)
    );
  }

  clearRecipients(): void {
    this.selectedRecipients.set([]);
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

  formatTime(timestamp: number): Date {
    return new Date(timestamp * 1000);
  }

  async sendShoutout(): Promise<void> {
    const content = this.newShoutoutContent().trim();
    if (!content || this.isSending()) {
      return;
    }

    this.isSending.set(true);

    try {
      // Get recipient pubkeys
      const receivers = this.selectedRecipients().map(r => r.pubkey);

      const result = await this.shoutoutService.sendShoutout(content, receivers);
      if (result.success) {
        this.newShoutoutContent.set('');
        this.selectedRecipients.set([]);
        this.showRecipientPicker.set(false);
      }
    } finally {
      this.isSending.set(false);
    }
  }

  replyToShoutout(shoutout: Shoutout): void {
    // Add the sender as a recipient
    const recipient: RecipientOption = {
      pubkey: shoutout.pubkey,
      profile: shoutout.profile,
      displayName: this.getDisplayName(shoutout.profile),
      isFavorite: this.favorites().includes(shoutout.pubkey),
    };

    // Clear existing and add sender
    this.selectedRecipients.set([recipient]);
    // Don't open the picker - just pre-fill the recipient
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendShoutout();
    }
  }

  refresh(): void {
    this.shoutoutService.refresh();
  }

  /**
   * Check if a shoutout was sent by the current user
   */
  isSentByMe(shoutout: Shoutout): boolean {
    return shoutout.pubkey === this.currentUserPubkey();
  }

  /**
   * Get display names of receivers for a sent shoutout
   */
  getReceiverNames(shoutout: Shoutout): string {
    if (shoutout.receivers.length === 0) {
      return 'everyone';
    }
    // For now just show the count, could be enhanced to show actual names
    return shoutout.receivers.length === 1
      ? '1 person'
      : `${shoutout.receivers.length} people`;
  }

  /**
   * Show the receivers view for a shoutout
   */
  showReceivers(shoutout: Shoutout): void {
    if (shoutout.receivers.length === 0) {
      return; // No specific receivers to show
    }
    this.viewingReceiversFor.set(shoutout);
    // Load profiles for receivers
    this.loadReceiverProfiles(shoutout.receivers);
  }

  /**
   * Hide the receivers view and go back to the shoutouts list
   */
  hideReceivers(): void {
    this.viewingReceiversFor.set(null);
  }

  /**
   * Load profiles for a list of pubkeys
   */
  private async loadReceiverProfiles(pubkeys: string[]): Promise<void> {
    const profiles = new Map<string, NostrRecord | null>();

    // Initialize with null for all pubkeys
    for (const pubkey of pubkeys) {
      profiles.set(pubkey, null);
    }
    this.receiverProfiles.set(profiles);

    // Load profiles in parallel
    const profilePromises = pubkeys.map(async (pubkey) => {
      try {
        const profile = await this.data.getProfile(pubkey);
        return { pubkey, profile: profile || null };
      } catch {
        return { pubkey, profile: null };
      }
    });

    const results = await Promise.all(profilePromises);

    // Update the profiles map
    const updatedProfiles = new Map(this.receiverProfiles());
    for (const result of results) {
      updatedProfiles.set(result.pubkey, result.profile);
    }
    this.receiverProfiles.set(updatedProfiles);
  }

  /**
   * Get a receiver's profile from the loaded profiles
   */
  getReceiverProfile(pubkey: string): NostrRecord | undefined {
    return this.receiverProfiles().get(pubkey) || undefined;
  }
}
