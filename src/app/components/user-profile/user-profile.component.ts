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
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterModule } from '@angular/router';
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
import { InfoRecord } from '../../services/storage.service';
import { Event, nip19 } from 'nostr-tools';
import { UtilitiesService } from '../../services/utilities.service';
import { DataService } from '../../services/data.service';
import { RelaysService } from '../../services/relays/relays';
import { SettingsService } from '../../services/settings.service';
import { SharedRelayService } from '../../services/relays/shared-relay';
import { ImageCacheService } from '../../services/image-cache.service';
import { ProfileDisplayNameComponent } from './display-name/profile-display-name.component';

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
    RouterModule,
  ],
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.scss',
  host: {
    '[style.width]': 'hostWidthAuto() ? "auto" : "100%"',
  },
})
export class UserProfileComponent implements AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private data = inject(DataService);
  private logger = inject(LoggerService);
  private elementRef = inject(ElementRef);
  readonly utilities = inject(UtilitiesService);
  settingsService = inject(SettingsService);
  private relaysService = inject(RelaysService);
  private readonly sharedRelay = inject(SharedRelayService);
  private readonly imageCacheService = inject(ImageCacheService);
  layout = inject(LayoutService);
  publicKey = '';
  pubkey = input<string>('');
  npub = signal<string | undefined>(undefined);
  event = input<Event | undefined>(undefined);
  info = input<InfoRecord | undefined>(undefined);
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

  // Flag to track if component is visible
  private isVisible = signal(false);
  private intersectionObserver?: IntersectionObserver;

  // Debounce control variables
  private debouncedLoadTimer?: number;
  private isScrolling = signal(false);
  private readonly DEBOUNCE_TIME = 350; // milliseconds
  private readonly SCROLL_CHECK_INTERVAL = 100; // milliseconds
  private scrollCheckTimer?: number;

  npubValue = computed<string>(() => {
    const pubkey = this.pubkey();
    if (!pubkey) {
      return '';
    }

    return nip19.npubEncode(pubkey);
  });

  constructor() {
    // If a prefetched profile is provided, initialize local profile with it
    effect(() => {
      const pref = this.prefetchedProfile();
      if (pref) {
        this.profile.set(pref as unknown as Record<string, unknown>);
      }
    });
    // Set up scroll detection
    this.setupScrollDetection(); // Set up an effect to watch for changes to npub input
    effect(() => {
      const pubkey = this.pubkey();

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
          const npub = this.utilities.getNpubFromPubkey(pubkey);
          this.npub.set(npub);

          // Only load profile data when the component is visible and not scrolling
          if (this.isVisible() && !this.isScrolling() && !this.profile()) {
            this.debouncedLoadProfileData(pubkey);
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
    this.clearScrollCheckTimer();
  }

  /**
   * Sets up the scroll detection mechanism
   */
  private setupScrollDetection(): void {
    // Get the scroll container - typically the virtual scroll viewport
    const scrollDetector = () => {
      // We need to determine if scrolling has occurred
      const lastScrollPosition = {
        x: window.scrollX,
        y: window.scrollY,
      };

      this.scrollCheckTimer = window.setInterval(() => {
        const currentPosition = {
          x: window.scrollX,
          y: window.scrollY,
        };

        // If position changed, user is scrolling
        if (
          lastScrollPosition.x !== currentPosition.x ||
          lastScrollPosition.y !== currentPosition.y
        ) {
          this.isScrolling.set(true);

          // Update last position
          lastScrollPosition.x = currentPosition.x;
          lastScrollPosition.y = currentPosition.y;
        } else {
          // No change in position means scrolling has stopped
          this.isScrolling.set(false);
        }
      }, this.SCROLL_CHECK_INTERVAL);
    };

    // Start the scroll detection
    scrollDetector();
  }

  private clearScrollCheckTimer(): void {
    if (this.scrollCheckTimer) {
      window.clearInterval(this.scrollCheckTimer);
      this.scrollCheckTimer = undefined;
    }
  }

  private setupIntersectionObserver(): void {
    this.disconnectObserver(); // Ensure any existing observer is disconnected

    // Create IntersectionObserver instance
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        // Update visibility state
        const isVisible = entries.some((entry) => entry.isIntersecting);
        this.isVisible.set(isVisible);

        if (isVisible && !this.isScrolling()) {
          // Using the debounced load function to prevent rapid loading during scroll
          if (!this.profile() && !this.isLoading()) {
            this.debouncedLoadProfileData(this.pubkey());
          }
        }
      },
      {
        threshold: 0.1, // Trigger when at least 10% is visible
        root: null, // Use viewport as root
      },
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
      if (this.isVisible() && !this.isScrolling()) {
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

    const size = this.getImageSize();
    return this.imageCacheService.getOptimizedImageUrl(originalUrl, size, size);
  }

  /**
   * Returns the appropriate image size based on the current view
   */
  private getImageSize(): number {
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
      case 'compact':
      case 'name':
      case 'tiny':
        return 24;
      default: // 'list'
        return 40;
    }
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

    if (!profile || !profile.data || !profile.data.nip05) {
      return this.npub();
    }

    // Ensure nip05 is a string
    return this.utilities.parseNip05(profile.data.nip05);
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
}
