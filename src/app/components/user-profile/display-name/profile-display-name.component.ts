import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  untracked,
} from '@angular/core';
import { nip19, type Event } from 'nostr-tools';
import { DataService } from '../../../services/data.service';
import { LoggerService } from '../../../services/logger.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { ProfileHoverCardService } from '../../../services/profile-hover-card.service';
import { SettingsService } from '../../../services/settings.service';
import { LayoutService } from '../../../services/layout.service';
import { IntersectionObserverService } from '../../../services/intersection-observer.service';

@Component({
  selector: 'app-profile-display-name',
  imports: [],
  templateUrl: './profile-display-name.component.html',
  styleUrl: './profile-display-name.component.scss',
})
export class ProfileDisplayNameComponent implements AfterViewInit, OnDestroy {
  private data = inject(DataService);
  private logger = inject(LoggerService);
  private elementRef = inject(ElementRef);
  private hoverCardService = inject(ProfileHoverCardService);
  readonly utilities = inject(UtilitiesService);
  private settingsService = inject(SettingsService);
  private layout = inject(LayoutService);
  private readonly intersectionObserverService = inject(IntersectionObserverService);

  private linkElement: HTMLElement | null = null;

  publicKey = '';
  pubkey = input<string>('');
  event = input<Event | undefined>(undefined);
  // Optional prefetched profile passed from parent to avoid duplicate fetches
  prefetchedProfile = input<unknown | null>(null);
  disableLink = input<boolean>(false);
  profile = signal<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  isLoading = signal(false);
  error = signal<string>('');

  // Flag to track if component is visible
  private isVisible = signal(false);

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

  /**
   * Computed npub value from pubkey
   */
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
    return npub ? `/p/${npub}` : '';
  });

  constructor() {
    // Set up an effect to watch for changes to pubkey input
    // This must run BEFORE the prefetchedProfile effect so that when both inputs
    // change simultaneously (e.g., CDK virtual scroll recycling), the pubkey effect
    // clears old data first, then the prefetchedProfile effect sets the new data.
    effect(() => {
      const pubkey = this.normalizedPubkey();

      if (pubkey) {
        // If the pubkey changed, reset the profile data to force reload
        if (this.publicKey && this.publicKey !== pubkey) {
          untracked(() => {
            // Clear old profile immediately so we don't show stale data
            this.profile.set(null);
            this.isLoading.set(false);
            this.error.set('');
          });
        }

        // Update publicKey AFTER the comparison but BEFORE trying to load
        this.publicKey = pubkey;

        untracked(() => {
          // Check prefetched profile first (passed from parent, e.g., batch-loaded)
          // This is critical for virtual scroll recycling where both pubkey and
          // prefetchedProfile inputs change at the same time
          const prefetched = this.prefetchedProfile();
          if (prefetched) {
            this.profile.set(prefetched as unknown as Record<string, unknown>);
            this.isLoading.set(false);
            return;
          }

          // Try to get cached profile synchronously first for instant display
          const cachedProfile = this.data.getCachedProfile(pubkey);
          if (cachedProfile) {
            this.profile.set(cachedProfile);
            this.isLoading.set(false);
          } else if (this.isVisible()) {
            // Load profile data when the component is visible
            this.debouncedLoadProfileData(pubkey);
          }
        });
      }
    });

    // If a prefetched profile is provided (or updated later after batch load),
    // initialize local profile with it. This runs AFTER the pubkey effect so it
    // won't be overwritten when both inputs change simultaneously.
    effect(() => {
      const pref = this.prefetchedProfile();
      if (pref) {
        this.profile.set(pref as unknown as Record<string, unknown>);
        // Mark as loaded to prevent redundant fetches
        this.isLoading.set(false);
      }
    });

    // Effect to trigger load when the component becomes visible and profile is not loaded
    effect(() => {
      const isVisible = this.isVisible();
      const profile = this.profile();
      const isLoading = this.isLoading();
      const pubkey = this.normalizedPubkey();

      if (isVisible && !profile && !isLoading && pubkey) {
        untracked(() => {
          this.debouncedLoadProfileData(pubkey);
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
        });
      }
    });
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



  private setupIntersectionObserver(): void {
    this.disconnectObserver(); // Ensure any existing observer is disconnected

    // Use the shared IntersectionObserver service instead of creating per-component observer
    // This ensures callbacks run inside NgZone for proper change detection,
    // which is critical for components inside CDK virtual scroll viewports
    this.intersectionObserverService.observe(
      this.elementRef.nativeElement,
      (isIntersecting) => {
        // Update visibility state
        this.isVisible.set(isIntersecting);

        if (isIntersecting) {
          // Using the debounced load function to prevent rapid loading during scroll
          if (!this.profile() && !this.isLoading()) {
            this.debouncedLoadProfileData(this.normalizedPubkey());
          }
        }
      },
      {
        threshold: 0.01, // Trigger when at least 1% is visible
        rootMargin: '200px', // Start loading 200px before entering viewport
      }
    );
  }

  private disconnectObserver(): void {
    this.intersectionObserverService.unobserve(this.elementRef.nativeElement);
  }

  /**
   * Truncated npub value (first 8 characters) for display when profile is not found
   */
  truncatedNpubValue = computed<string>(() => {
    const npub = this.npubValue();
    if (!npub || npub.length <= 8) {
      return npub;
    }

    // Return first 8 characters for concise display
    return npub.substring(0, 8);
  });

  /**
   * Debounces the profile data loading to prevent excessive API calls during scrolling
   */
  private debouncedLoadProfileData(pubkeyValue: string): void {
    // Clear any existing timer
    this.clearDebounceTimer();

    // Set a new timer
    this.debouncedLoadTimer = window.setTimeout(() => {
      // Only proceed if we're visible
      if (this.isVisible()) {
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
  private async loadProfileData(pubkeyToLoad: string): Promise<void> {
    // Don't reload if we already have data for THIS pubkey
    if (this.profile() && this.publicKey === pubkeyToLoad) {
      this.logger.debug('Profile data already loaded, skipping reload');
      return;
    }

    // Don't start new request if already loading
    if (this.isLoading()) {
      this.logger.debug('Profile data is already loading, skipping reload');
      return;
    }

    // Capture the current pubkey - this is what we're loading for
    // We'll check against this after the async operation completes
    const targetPubkey = pubkeyToLoad;

    this.isLoading.set(true);
    this.error.set('');

    try {
      this.logger.debug('Loading profile data for:', targetPubkey);
      this.logger.time('Loading profile data in user profile' + targetPubkey);

      const data = await this.data.getProfile(targetPubkey);
      this.logger.timeEnd('Loading profile data in user profile' + targetPubkey);

      this.logger.debug('Profile data loaded:', data);

      // Only update if the component is still showing the same pubkey we loaded for
      // Use normalizedPubkey() signal to get the CURRENT pubkey value
      if (this.normalizedPubkey() === targetPubkey) {
        // Set profile to an empty object if no data was found
        // This will distinguish between "not loaded yet" and "loaded but empty"
        this.profile.set(data || { isEmpty: true });
      } else {
        this.logger.debug('Pubkey changed during load, discarding result for:', targetPubkey);
      }
    } catch (error) {
      this.logger.error('Failed to load profile data:', error);

      // Only update error if the component is still showing the same pubkey
      if (this.normalizedPubkey() === targetPubkey) {
        this.error.set('Failed to load profile data: ' + error);
        // Set profile to empty object to indicate we tried loading but failed
        this.profile.set({ isEmpty: true });
      }
    } finally {
      // Only update loading state if the component is still showing the same pubkey
      if (this.normalizedPubkey() === targetPubkey) {
        this.isLoading.set(false);
      }
    }
  }

  /**
   * Checks if the profile is not found (empty or missing)
   */
  isProfileNotFound(): boolean {
    return this.profile() && (this.profile().isEmpty || !this.profile().data);
  }

  /**
   * Handles mouse enter event to show hover card
   */
  onMouseEnter(event: MouseEvent): void {
    this.linkElement = event.currentTarget as HTMLElement;
    if (this.linkElement) {
      this.hoverCardService.showHoverCard(this.linkElement, this.pubkey());
    }
  }

  /**
   * Handles mouse leave event to hide hover card
   */
  onMouseLeave(): void {
    this.linkElement = null;
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

    // Prevent default browser navigation
    event.preventDefault();
    event.stopPropagation();

    // Use layout service to handle navigation (supports two-column view)
    this.layout.openProfile(this.pubkey());
  }
}
