import {
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
  ElementRef,
  OnDestroy,
  AfterViewInit,
  computed,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { MatListModule } from '@angular/material/list';
import { LayoutService } from '../../services/layout.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ViewMode } from '../../interfaces';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { InfoRecord, TrustMetrics } from '../../services/database.service';
import { Event, nip19 } from 'nostr-tools';
import { UtilitiesService } from '../../services/utilities.service';
import { DataService } from '../../services/data.service';
import { SettingsService } from '../../services/settings.service';
import { SharedRelayService } from '../../services/relays/shared-relay';
import { ImageCacheService } from '../../services/image-cache.service';
import { ProfileDisplayNameComponent } from './display-name/profile-display-name.component';
import { ProfileHoverCardService } from '../../services/profile-hover-card.service';
import { TrustService } from '../../services/trust.service';
import { MatBadgeModule } from '@angular/material/badge';

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [
    ProfileDisplayNameComponent,
    CommonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatTooltipModule,
    MatMenuModule,
    MatButtonModule,
    MatBadgeModule,
  ],
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.scss',
  host: {
    '[style.width]': 'hostWidthAuto() ? "auto" : "100%"',
  },
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserProfileComponent implements AfterViewInit, OnDestroy {
  private nostrService = inject(NostrService);
  private data = inject(DataService);
  private logger = inject(LoggerService);
  private elementRef = inject(ElementRef);
  private platformId = inject(PLATFORM_ID);
  readonly utilities = inject(UtilitiesService);
  settingsService = inject(SettingsService);
  private readonly sharedRelay = inject(SharedRelayService);
  private readonly imageCacheService = inject(ImageCacheService);
  private hoverCardService = inject(ProfileHoverCardService);
  private trustService = inject(TrustService);
  layout = inject(LayoutService);

  publicKey = '';
  pubkey = input<string>('');
  npub = signal<string | undefined>(undefined);
  event = input<Event | undefined>(undefined);
  info = input<InfoRecord | undefined>(undefined);
  trust = input<TrustMetrics | undefined>(undefined);
  profile = signal<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  // Optional prefetched profile passed from parent to avoid duplicate fetches
  prefetchedProfile = input<unknown | null>(null);
  isLoading = signal(false);
  error = signal<string>('');
  view = input<ViewMode>('list');
  imageLoadError = signal(false);

  /**
   * If true, the host width will be set to auto instead of 100% (default).
   * Use this for grid/flow layouts (e.g. in people component).
   */
  hostWidthAuto = input<boolean>(false);

  /**
   * If true, the trust rank will be displayed (default: true).
   */
  showRank = input<boolean>(true);

  /**
   * If true, clicking the avatar/name will not navigate to the profile page.
   * Hover cards will still work. Useful when the profile is used in a selectable context.
   */
  disableLink = input<boolean>(false);

  /**
   * Custom route prefix to use instead of '/p'. For example, '/people' for contact cards.
   */
  routePrefix = input<string>('/p');

  // Trust rank - computed from trust input
  trustRank = computed(() => this.trust()?.rank);
  trustEnabled = computed(() => this.trustService.isEnabled());

  // Flag to track if component is visible
  private isVisible = signal(false);
  private intersectionObserver?: IntersectionObserver;

  // Debounce control variables
  private debouncedLoadTimer?: number;
  private readonly DEBOUNCE_TIME = 100; // milliseconds - reduced for faster display

  /**
   * Normalized hex pubkey - handles both hex and npub inputs
   */
  private normalizedPubkey = computed<string>(() => {
    const pubkey = this.pubkey();
    if (!pubkey) {
      return '';
    }

    // If it's already a valid hex pubkey, return it
    if (this.utilities.isValidHexPubkey(pubkey)) {
      return pubkey;
    }

    // If it's an npub, convert to hex
    if (pubkey.startsWith('npub1')) {
      try {
        const hexPubkey = this.utilities.getPubkeyFromNpub(pubkey);
        if (this.utilities.isValidHexPubkey(hexPubkey)) {
          return hexPubkey;
        }
      } catch {
        // Fall through to return empty
      }
    }

    return '';
  });

  npubValue = computed<string>(() => {
    const pubkey = this.normalizedPubkey();
    if (!pubkey) {
      return '';
    }

    try {
      return nip19.npubEncode(pubkey);
    } catch {
      return '';
    }
  });

  /**
   * Computed URL for the profile link - used for href attribute for accessibility
   */
  profileUrl = computed(() => {
    const npub = this.npubValue();
    const prefix = this.routePrefix();
    return npub ? `${prefix}/${npub}` : '';
  });

  constructor() {
    // If a prefetched profile is provided, initialize local profile with it
    // This prevents redundant fetches when parent has already loaded the profile
    effect(() => {
      const pref = this.prefetchedProfile();
      if (pref) {
        this.profile.set(pref as unknown as Record<string, unknown>);
        // Mark as loaded to prevent redundant fetches
        this.isLoading.set(false);
      }
    });
    // Set up an effect to watch for changes to pubkey input
    effect(() => {
      const pubkey = this.normalizedPubkey();

      if (pubkey) {
        // If the pubkey changed, reset the profile data to force reload
        if (this.publicKey && this.publicKey !== pubkey) {
          untracked(() => {
            this.profile.set(null);
            this.isLoading.set(false);
            this.error.set('');
            this.imageLoadError.set(false);
          });
        }

        this.publicKey = pubkey;

        untracked(() => {
          // Use the already computed npubValue instead of calling getNpubFromPubkey
          const npub = this.npubValue();
          this.npub.set(npub);

          // Try to get cached profile synchronously first for instant display
          const cachedProfile = this.data.getCachedProfile(pubkey);
          if (cachedProfile) {
            this.profile.set(cachedProfile);
            this.isLoading.set(false);
          } else {
            // Only load profile data when the component is visible and not scrolling
            if (this.isVisible() && !this.layout.isScrolling() && !this.profile()) {
              this.debouncedLoadProfileData(pubkey);
            }
          }
        });
      }
    });

    effect(() => {
      const event = this.event();

      if (event) {
        untracked(() => {
          this.profile.set({
            data: JSON.parse(event.content),
            event,
          });

          this.publicKey = event.pubkey;

          const npub = this.utilities.getNpubFromPubkey(event.pubkey);
          this.npub.set(npub);
        });
      }
    });

    // Effect to trigger load when scrolling stops if the component is visible but not loaded
    effect(() => {
      const isScrolling = this.layout.isScrolling();
      const isVisible = this.isVisible();
      const profile = this.profile();
      const isLoading = this.isLoading();
      const pubkey = this.pubkey();

      if (!isScrolling && isVisible && !profile && !isLoading && pubkey) {
        untracked(() => {
          this.debouncedLoadProfileData(pubkey);
        });
      }
    });

    // Additional effect to watch for visibility changes and scrolling status
    // effect(() => {
    //     if (this.isVisible() && !this.isScrolling() && this.pubkey() && !this.profile()) {
    //         untracked(() => {
    //             this.debouncedLoadProfileData(this.pubkey());
    //         });
    //     }
    // });
  }

  getInfoClass() {
    if (this.info()) {
      if (
        this.info()!['hasRelayList'] &&
        this.info()!['foundOnDiscoveryRelays'] &&
        this.info()!['foundMetadataOnUserRelays']
      ) {
        return 'user-info-status-good';
      } else if (this.info()!['foundMetadataOnAccountRelays']) return 'user-info-status-medium';
      else {
        return 'user-info-status-bad';
      }
    }

    return '';
  }

  ngAfterViewInit(): void {
    // Set up intersection observer to detect when component is visible
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    // Clean up the observer and timers when component is destroyed
    this.disconnectObserver();
    this.clearDebounceTimer();
  }

  /**
   * Load trust rank for the user
   */




  private setupIntersectionObserver(): void {
    this.disconnectObserver(); // Ensure any existing observer is disconnected

    // Create IntersectionObserver instance
    // Using rootMargin to trigger slightly before element enters viewport for seamless UX
    this.intersectionObserver = new IntersectionObserver(
      entries => {
        // Update visibility state
        const isVisible = entries.some(entry => entry.isIntersecting);
        this.isVisible.set(isVisible);

        if (isVisible && !this.layout.isScrolling()) {
          // Using the debounced load function to prevent rapid loading during scroll
          if (!this.profile() && !this.isLoading()) {
            this.debouncedLoadProfileData(this.pubkey());
          }
        }
      },
      {
        threshold: 0.01, // Trigger when at least 1% is visible
        root: null, // Use viewport as root
        rootMargin: '200px', // Start loading 200px before entering viewport
      }
    );

    // Start observing this component
    this.intersectionObserver.observe(this.elementRef.nativeElement);
  }

  private disconnectObserver(): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = undefined;
    }
  }

  /**
   * Debounces the profile data loading to prevent excessive API calls during scrolling
   */
  private debouncedLoadProfileData(pubkeyValue: string): void {
    // Clear any existing timer
    this.clearDebounceTimer();

    // Set a new timer
    this.debouncedLoadTimer = window.setTimeout(() => {
      // Only proceed if we're visible and not currently scrolling
      if (this.isVisible() && !this.layout.isScrolling()) {
        this.loadProfileData(pubkeyValue);
      }
    }, this.DEBOUNCE_TIME);
  }

  private clearDebounceTimer(): void {
    if (this.debouncedLoadTimer) {
      window.clearTimeout(this.debouncedLoadTimer);
      this.debouncedLoadTimer = undefined;
    }
  }

  copyEventData(): void {
    this.layout.copyToClipboard(this.event()?.content, 'event data');
  }

  private async loadProfileData(npubValue: string): Promise<void> {
    // Don't reload if we already have data
    if (this.profile()) {
      this.logger.debug('Profile data already loaded, skipping reload');
      return;
    }

    // Don't start new request if already loading
    if (this.isLoading()) {
      this.logger.debug('Profile data is already loading, skipping reload');
      return;
    }

    this.isLoading.set(true);
    this.error.set('');

    try {
      this.logger.debug('Loading profile data for:', npubValue);
      this.logger.time('Loading profile data in user profile' + npubValue);

      const data = await this.data.getProfile(npubValue);
      this.logger.timeEnd('Loading profile data in user profile' + npubValue);

      this.logger.debug('Profile data loaded:', data);

      // Only update if we're still loading the same pubkey
      if (this.publicKey === npubValue) {
        // Set profile to an empty object if no data was found
        // This will distinguish between "not loaded yet" and "loaded but empty"
        this.profile.set(data || { isEmpty: true });
      }
    } catch (error) {
      this.logger.error('Failed to load profile data:', error);

      // Only update error if we're still loading the same pubkey
      if (this.publicKey === npubValue) {
        this.error.set('Failed to load profile data: ' + error);
        // Set profile to empty object to indicate we tried loading but failed
        this.profile.set({ isEmpty: true });
      }
    } finally {
      // Only update loading state if we're still loading the same pubkey
      if (this.publicKey === npubValue) {
        this.isLoading.set(false);
      }
    }
  }

  /**
   * Returns the appropriate spinner diameter based on the current view
   */
  getSpinnerSize(): number {
    switch (this.view()) {
      case 'large':
        return 256;
      case 'medium':
        return 128;
      case 'small':
        return 48;
      case 'details':
        return 40;
      case 'grid':
        return 36;
      case 'icon':
        return 48;
      default: // 'list'
        return 40;
    }
  }

  /**
   * Returns the appropriate default avatar icon size based on the current view
   */
  getDefaultAvatarSize(): string {
    switch (this.view()) {
      case 'large':
        return '256px';
      case 'medium':
        return '128px';
      case 'small':
        return '48px';
      case 'details':
        return '40px';
      case 'grid':
        return '36px';
      case 'compact':
        return '24px';
      default: // 'list'
        return '40px';
    }
  }

  /**
   * Handles image load errors by setting the imageLoadError signal to true
   */
  onImageLoadError(): void {
    this.imageLoadError.set(true);
  }

  /**
   * Gets the optimized image URL using the image cache service
   */
  getOptimizedImageUrl(originalUrl: string): string {
    if (!originalUrl) return '';

    return this.imageCacheService.getOptimizedImageUrl(originalUrl);
  }

  getInfoTooltip() {
    let tooltip = '';

    const info = this.info();

    if (info) {
      if (info['hasRelayList']) {
        tooltip = '+1: Has relay list';
      } else if (info['hasFollowingListRelays']) tooltip = '-1: Has following list relays';
      else {
        tooltip = '-1: No relay list';
      }

      if (info['foundOnDiscoveryRelays']) {
        tooltip += '\r\n+1: Found on discovery relays';
      } else if (info['foundOnAccountRelays']) {
        tooltip += '\r\n-1: Found on account relays';
      }

      if (info['foundZeroRelaysOnAccountRelays']) {
        tooltip += '\r\n-1: Found zero relays on account relays';
      }

      if (info['foundMetadataOnAccountRelays']) {
        tooltip += '\r\n-1: Found profile on account relays';
      }

      if (info['foundMetadataOnUserRelays']) {
        tooltip += '\r\n+1: Found profile on user relays';
      }
    }

    return tooltip;
  }

  aliasOrNpub = computed(() => {
    const profile = this.profile();

    if (!profile || !profile.data) {
      return this.npub();
    }

    // Show NIP-05 if available (first priority)
    if (profile.data.nip05) {
      return this.utilities.parseNip05(profile.data.nip05);
    }

    // Show LUD16 if available and no NIP-05 (second priority)
    if (profile.data.lud16) {
      return profile.data.lud16;
    }

    // Fallback to npub if neither NIP-05 nor LUD16 is available
    return this.npub();
  });

  /**
   * Gets the tooltip content for the profile avatar
   */
  getTooltipContent(): string {
    if (this.isLoading()) {
      return 'Loading...';
    }

    if (!this.profile() || this.profile().isEmpty || !this.profile().data) {
      return 'Profile not found';
    }

    const content = this.profile().data;
    let tooltipText = '';

    // Add display name or name
    if (content.display_name) {
      tooltipText += content.display_name;
    } else if (content.name) {
      tooltipText += content.name;
    } else {
      tooltipText += '[No name]';
    }

    // Add about text if available (limited to 50 characters)
    if (content.about) {
      const truncatedAbout =
        content.about.length > 50 ? content.about.substring(0, 50) + '...' : content.about;
      tooltipText += '\n\n' + truncatedAbout;
    }

    if (this.imageLoadError()) {
      tooltipText += '\n\nFailed to load profile image';
    }

    return tooltipText;
  }

  /**
   * Checks if the profile is not found (empty or missing)
   */
  isProfileNotFound(): boolean {
    return this.profile() && (this.profile().isEmpty || !this.profile().data);
  }

  /**
   * Shows tooltip briefly on touch devices without interfering with scrolling
   */
  showTooltipOnTouch(event: TouchEvent): void {
    // Only handle if it's a single touch (not a gesture)
    if (event.touches.length === 1) {
      const element = event.currentTarget as HTMLElement;

      // Add a temporary class to show the tooltip
      element.classList.add('show-tooltip');

      // Remove the class after 2 seconds
      setTimeout(() => {
        element.classList.remove('show-tooltip');
      }, 2000);
    }
  }

  /**
   * Shows the profile hover card (for desktop mouse hover)
   */
  onMouseEnter(event: MouseEvent, triggerElement: HTMLElement): void {
    // Don't show hover card for tiny/name-only views
    if (this.view() === 'tiny' || this.view() === 'name') {
      return;
    }

    this.hoverCardService.showHoverCard(triggerElement, this.pubkey());
  }

  /**
   * Hides the profile hover card
   */
  onMouseLeave(): void {
    this.hoverCardService.hideHoverCard();
  }

  /**
   * Handles navigation to profile - uses layout.openProfile to support two-column view
   */
  onProfileClick(event: MouseEvent): void {
    if (this.disableLink()) {
      event.preventDefault();
      return;
    }

    // Prevent default router navigation
    event.preventDefault();
    event.stopPropagation();

    // Use layout service to handle navigation (supports two-column view)
    this.layout.openProfile(this.pubkey());
  }
}
