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
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-profile-display-name',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './profile-display-name.component.html',
  styleUrl: './profile-display-name.component.scss',
})
export class ProfileDisplayNameComponent implements AfterViewInit, OnDestroy {
  private data = inject(DataService);
  private logger = inject(LoggerService);
  private elementRef = inject(ElementRef);
  readonly utilities = inject(UtilitiesService);
  publicKey = '';
  pubkey = input<string>('');
  event = input<Event | undefined>(undefined);
  profile = signal<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  isLoading = signal(false);
  error = signal<string>('');

  // Flag to track if component is visible
  private isVisible = signal(false);
  private intersectionObserver?: IntersectionObserver;

  // Debounce control variables
  private debouncedLoadTimer?: number;
  private isScrolling = signal(false);
  private readonly DEBOUNCE_TIME = 350; // milliseconds
  private readonly SCROLL_CHECK_INTERVAL = 100; // milliseconds
  private scrollCheckTimer?: number;

  constructor() {
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
          });
        }

        this.publicKey = pubkey;

        untracked(() => {
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
      entries => {
        // Update visibility state
        const isVisible = entries.some(entry => entry.isIntersecting);
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

  npubValue = computed<string>(() => {
    const pubkey = this.pubkey();
    if (!pubkey) {
      return '';
    }

    return nip19.npubEncode(pubkey);
  });

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
   * Checks if the profile is not found (empty or missing)
   */
  isProfileNotFound(): boolean {
    return this.profile() && (this.profile().isEmpty || !this.profile().data);
  }
}
