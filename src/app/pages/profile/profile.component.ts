import {
  Component,
  inject,
  signal,
  effect,
  untracked,
  PLATFORM_ID,
  DOCUMENT,
  computed,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  ActivatedRoute,
  ParamMap,
  RouterModule,
  RouterOutlet,
  Router,
  NavigationEnd,
  Data,
} from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApplicationStateService } from '../../services/application-state.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatListModule } from '@angular/material/list';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { nip19 } from 'nostr-tools';
import { StorageService } from '../../services/storage.service';
import { ProfileStateService } from '../../services/profile-state.service';
import { ProfileTrackingService } from '../../services/profile-tracking.service';
import { LayoutService } from '../../services/layout.service';
import { ProfileHeaderComponent } from './profile-header/profile-header.component';
import { ApplicationService } from '../../services/application.service';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { AccountStateService } from '../../services/account-state.service';
import { NostrRecord } from '../../interfaces';
import { DataService } from '../../services/data.service';
import { UtilitiesService } from '../../services/utilities.service';
import { UrlUpdateService } from '../../services/url-update.service';
import { UsernameService } from '../../services/username';
import { Metrics } from '../../services/metrics';
import { AccountRelayService } from '../../services/relays/account-relay';
import { ReportingService } from '../../services/reporting.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    RouterModule,
    RouterOutlet,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatChipsModule,
    MatDividerModule,
    MatMenuModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatListModule,
    MatMenuModule,
    FormsModule,
    MatFormFieldModule,
    ProfileHeaderComponent,
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent {
  private data = inject(DataService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  nostrService = inject(NostrService);
  private app = inject(ApplicationService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private document = inject(DOCUMENT);
  private platformId = inject(PLATFORM_ID);
  layoutService = inject(LayoutService);
  profileState = inject(ProfileStateService);
  accountState = inject(AccountStateService);
  readonly utilities = inject(UtilitiesService);
  private readonly url = inject(UrlUpdateService);
  private readonly username = inject(UsernameService);
  private readonly profileTracking = inject(ProfileTrackingService);
  private readonly metrics = inject(Metrics);
  private readonly reportingService = inject(ReportingService);

  pubkey = signal<string>('');
  userMetadata = signal<NostrRecord | undefined>(undefined);
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);

  isOwnProfile = computed(() => {
    return this.accountState.pubkey() === this.pubkey();
  });

  // Check if current profile user is blocked
  isProfileBlocked = computed(() => {
    const currentPubkey = this.pubkey();
    if (!currentPubkey || this.isOwnProfile()) return false;

    const isBlocked = this.reportingService.isUserBlocked(currentPubkey);
    this.logger.debug('Profile blocked check:', { currentPubkey, isBlocked });

    return isBlocked;
  });

  // Signal to control whether blocked profile is revealed
  isBlockedProfileRevealed = signal(false);

  // Track previous blocked state to detect changes
  private previousBlockedState = signal(false);

  showLightningQR = signal(false);
  lightningQrCode = signal<string>('');
  followingList = signal<string[]>([]); // This would be dynamically updated with real data
  isCompactHeader = signal<boolean>(false); // New signal to track compact header mode

  // Convert route params to a signal
  private routeParams = toSignal<ParamMap>(this.route.paramMap);
  private routeData = toSignal<Data>(this.route.data);
  // private userRelayFactory = inject(UserRelayFactoryService);
  // private userRelay: UserRelayService | undefined = undefined;

  // Track the previous profile pubkey to detect actual profile changes
  private previousProfilePubkey: string | null = null;

  constructor() {
    if (!this.app.isBrowser()) {
      console.warn('Profile component can only be used in browser context');
      return;
    }

    // Check for router navigation state
    const navigation = this.router.getCurrentNavigation();
    if (navigation?.extras.state?.['event']) {
      console.log('Router state event data for profile:', navigation.extras.state['event']);
      // Handle the event data as needed for profile context
    }

    // Whenever profile is edited by user, update the user metadata if it matches the current pubkey
    effect(() => {
      const profile = this.accountState.profile();
      const currentPubkey = this.pubkey();
      const currentUserMetadata = this.userMetadata();

      if (
        profile?.event.pubkey === currentPubkey &&
        currentUserMetadata?.event.id !== profile?.event.id
      ) {
        untracked(() => {
          this.userMetadata.set(profile);
        });
      }
    });

    // Reset blocked profile reveal when block status changes from false to true
    effect(() => {
      const isBlocked = this.isProfileBlocked();
      const previousBlocked = this.previousBlockedState();
      const currentPubkey = this.pubkey();

      this.logger.debug('Block status effect triggered:', {
        pubkey: currentPubkey,
        isBlocked,
        previousBlocked,
        revealed: this.isBlockedProfileRevealed(),
      });

      // Update the previous state
      untracked(() => {
        this.previousBlockedState.set(isBlocked);
      });

      // If user becomes blocked (transition from false to true), reset the reveal state
      if (isBlocked && !previousBlocked) {
        untracked(() => {
          this.logger.debug('User newly blocked, showing overlay for:', currentPubkey);
          this.isBlockedProfileRevealed.set(false);
        });
      }
    });

    // React to changes in route parameters and app initialization
    effect(async () => {
      // Only proceed if app is initialized and route params are available
      if (this.app.initialized() && this.routeParams() && this.routeData()) {
        untracked(async () => {
          let id, username;

          // Check if component renders /u/username and we have pubkey resolved from username
          const pubkeyForUsername = this.routeData()?.['data']?.id;
          if (pubkeyForUsername) {
            id = pubkeyForUsername;
            username = this.routeData()?.['data']?.username;
          } else {
            id = this.routeParams()?.get('id');
          }

          if (id) {
            // Validate the id parameter before proceeding
            if (!id || id === 'undefined' || !id.trim()) {
              this.logger.warn('Profile page opened with invalid id:', id);
              this.error.set('Invalid profile identifier');
              this.isLoading.set(false);
              return;
            }

            this.logger.debug('Profile page opened with pubkey:', id);

            // Reset state when loading a new profile
            this.userMetadata.set(undefined);
            this.lightningQrCode.set('');
            this.error.set(null);
            this.isBlockedProfileRevealed.set(false); // Reset blocked profile reveal state
            this.previousBlockedState.set(false); // Reset previous blocked state tracking

            if (id.startsWith('npub')) {
              id = this.utilities.getPubkeyFromNpub(id);

              // First update URL to have npub in URL.
              if (username) {
                this.url.updatePathSilently(['/u', username]);
              } else {
                // username = await this.username.getUsername(id);
                const identifier: string = id;
                this.username.getUsername(id).then(username => {
                  if (username) {
                    this.url.updatePathSilently(['/u', username]);
                  } else {
                    // If we find event only by ID, we should update the URL to include the NIP-19 encoded value that includes the pubkey.
                    const encoded = nip19.npubEncode(identifier);
                    this.url.updatePathSilently(['/p', identifier]);
                  }
                });
              }
            } else {
              if (!username) {
                const identifier: string = id;
                this.username.getUsername(id).then(username => {
                  if (username) {
                    this.url.updatePathSilently(['/u', username]);
                  } else {
                    // If we find event only by ID, we should update the URL to include the NIP-19 encoded value that includes the pubkey.
                    const encoded = nip19.npubEncode(identifier);
                    this.url.updatePathSilently(['/p', identifier]);
                  }
                });
              }
            }

            // Check if this is the same profile being reloaded (e.g., browser back)
            const currentProfilePubkey = this.profileState.pubkey();
            const isSameProfile = currentProfilePubkey === id;

            // Always set the profile pubkey first
            this.profileState.setCurrentProfilePubkey(id);

            this.pubkey.set(id);

            // Update the tracked profile pubkey for router change detection
            this.previousProfilePubkey = id;

            // If it's the same profile, always force reload to ensure fresh data after navigation
            if (isSameProfile) {
              this.logger.debug('Same profile detected, forcing reload to ensure fresh data');
              // Use a small delay to ensure the component is fully ready
              setTimeout(() => {
                this.profileState.reloadCurrentProfile();
              }, 50);
            }

            // Always attempt to load user profile and check if own profile, regardless of relay status
            await this.loadUserProfile(this.pubkey());

            await this.metrics.incrementMetric(this.pubkey(), 'viewed');

            // Track profile view (but not for own profile)
            if (!this.isOwnProfile()) {
              await this.profileTracking.trackProfileView(this.pubkey());
            }
          } else {
            this.error.set('No user ID provided');
            this.isLoading.set(false);
          }
        });
      }
    });

    // Add effect to monitor router events for sub-route changes
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        // Check if current route is one that should use compact header
        const currentUrl = event.urlAfterRedirects;
        const shouldBeCompact = this.shouldUseCompactHeader(currentUrl);

        // Only update if the value changes to avoid unnecessary renders
        if (this.isCompactHeader() !== shouldBeCompact) {
          this.isCompactHeader.set(shouldBeCompact);
        }

        // Check if we're navigating to a profile route
        const isProfileRoute = currentUrl.match(/^\/(p|u)\//);
        if (isProfileRoute) {
          // Extract the profile ID from the URL
          const profileMatch = currentUrl.match(/^\/(p|u)\/([^/]+)/);
          const urlProfileId = profileMatch ? profileMatch[2] : null;

          // Only trigger reload logic if the profile ID actually changed
          if (urlProfileId && urlProfileId !== this.previousProfilePubkey) {
            this.logger.debug(
              'Profile changed from',
              this.previousProfilePubkey,
              'to',
              urlProfileId
            );
            this.previousProfilePubkey = urlProfileId;

            // Small delay to ensure component is ready
            setTimeout(() => {
              const currentPubkey = this.pubkey();
              const profileStatePubkey = this.profileState.pubkey();

              // If we have a pubkey and it matches the profile state, but we don't have data, reload
              if (currentPubkey && currentPubkey === profileStatePubkey) {
                const hasFollowingData = this.profileState.followingList().length > 0;
                const hasNotesData = this.profileState.notes().length > 0;

                // If we don't have data, force a reload
                if (!hasFollowingData && !hasNotesData) {
                  this.logger.debug('No profile data found after navigation, forcing reload');
                  this.profileState.reloadCurrentProfile();
                }
              }
            }, 100);
          } else {
            this.logger.debug('Profile tab change detected, no reload needed');
          }
        }
      }
    });

    // Also check the current URL on initial load/reload
    const currentUrl = this.router.url;
    const shouldBeCompact = this.shouldUseCompactHeader(currentUrl);
    this.isCompactHeader.set(shouldBeCompact);
  }

  // Helper method to determine if the current route should use compact header
  private shouldUseCompactHeader(url: string): boolean {
    // Check if URL contains these paths that require compact header
    return (
      url.includes('/following') ||
      url.includes('/about') ||
      url.includes('/details') ||
      url.includes('/relays') ||
      url.includes('/media')
    );
  }

  /**
   * Safely access window object in browser context
   * @returns Window object or null if not in browser
   */
  private getWindow(): Window | null {
    return isPlatformBrowser(this.platformId) ? this.document.defaultView : null;
  }

  private async loadUserProfile(pubkey: string): Promise<void> {
    // Validate pubkey parameter
    if (!pubkey || pubkey === 'undefined' || !pubkey.trim()) {
      this.logger.warn('loadUserProfile called with invalid pubkey:', pubkey);
      this.error.set('Invalid profile identifier');
      this.isLoading.set(false);
      return;
    }

    // Additional validation for pubkey format
    if (!this.utilities.isValidPubkey(pubkey)) {
      this.logger.warn('loadUserProfile called with invalid pubkey format:', pubkey);
      this.error.set('Invalid pubkey format. Must be a valid hex pubkey or npub.');
      this.isLoading.set(false);
      return;
    }

    // Ensure we have the hex format for consistency
    const hexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!hexPubkey) {
      this.logger.warn('Unable to convert pubkey to hex format:', pubkey);
      this.error.set('Unable to process pubkey format');
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.error.set(null);

    try {
      // First, try to get cached profile data to show immediately
      const cachedMetadata = await this.data.getProfile(hexPubkey, false);
      if (cachedMetadata) {
        this.logger.debug('Showing cached profile data immediately for:', hexPubkey);
        this.userMetadata.set(cachedMetadata);
        this.isLoading.set(false);

        // Always scroll when we have data to show
        setTimeout(() => this.layoutService.scrollToOptimalProfilePosition(), 100);
      }

      // Then refresh profile data in the background to ensure it's up to date
      this.logger.debug('Refreshing profile data in background for:', hexPubkey);
      const refreshedMetadata = await this.data.getProfile(hexPubkey, true);

      // Only update if we got newer data or if we didn't have cached data
      if (refreshedMetadata && (!cachedMetadata || refreshedMetadata.event.created_at > cachedMetadata.event.created_at)) {
        this.logger.debug('Updated with refreshed profile data for:', hexPubkey);
        this.userMetadata.set(refreshedMetadata);
      }

      // If we didn't have cached data and couldn't get fresh data either
      if (!cachedMetadata && !refreshedMetadata) {
        // Don't set an error - allow the profile page to load without metadata
        this.logger.warn('User profile metadata not found, but continuing to load profile content');
      }

      // If we haven't scrolled yet (no cached data case), scroll now
      if (!cachedMetadata) {
        setTimeout(() => this.layoutService.scrollToOptimalProfilePosition(), 100);
      }

    } catch (err) {
      this.logger.error('Error loading user profile', err);
      this.error.set('Error loading user profile');
    } finally {
      // Only set loading to false if we don't have any data to show
      if (!this.userMetadata()) {
        this.isLoading.set(false);
      }
    }
  }

  getFormattedName(): string {
    const metadata = this.userMetadata();
    if (!metadata) return this.getTruncatedPubkey();

    return metadata.data.name || this.getTruncatedPubkey();
  }

  getVerifiedIdentifier(): string | null {
    const metadata = this.userMetadata();
    if (!metadata || !metadata.data.nip05) return null;

    return this.utilities.parseNip05(metadata.data.nip05);
  }

  getTruncatedPubkey(): string {
    const pubkey = this.pubkey();
    if (!this.utilities.isValidPubkey(pubkey)) {
      console.warn('Invalid pubkey in getTruncatedPubkey:', pubkey);
      return this.utilities.formatInvalidPubkey(pubkey);
    }
    return this.utilities.getTruncatedNpub(pubkey);
  }

  getFormattedNpub(): string {
    const pubkey = this.pubkey();

    // Validate pubkey first
    if (!this.utilities.isValidPubkey(pubkey)) {
      console.warn('Invalid pubkey in getFormattedNpub:', pubkey);
      throw new Error('Cannot format invalid pubkey as npub');
    }

    const hexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!hexPubkey) {
      throw new Error('Failed to get valid hex pubkey');
    }

    return this.utilities.getNpubFromPubkey(hexPubkey);
  }

  /**
   * Safe method to get formatted npub for template use
   */
  getSafeFormattedNpub(): string {
    try {
      return this.getFormattedNpub();
    } catch (error) {
      return this.utilities.formatInvalidPubkey(this.pubkey());
    }
  }

  getDefaultBanner(): string {
    // Return a default gradient for users without a banner
    return 'linear-gradient(135deg, #8e44ad, #3498db)';
  }

  copyToClipboard(text: string, type: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.logger.error('Cannot copy to clipboard in server environment');
      return;
    }

    const navigator = this.getWindow()?.navigator;
    if (!navigator?.clipboard) {
      this.logger.error('Clipboard API not available');
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.logger.debug(`Copied ${type} to clipboard:`, text);
        this.snackBar.open(
          `${type.charAt(0).toUpperCase() + type.slice(1)} copied to clipboard`,
          'Dismiss',
          {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: 'copy-snackbar',
          }
        );
      })
      .catch(error => {
        this.logger.error('Failed to copy to clipboard:', error);
        this.snackBar.open('Failed to copy to clipboard', 'Dismiss', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: 'error-snackbar',
        });
      });
  }

  copyNpub(): void {
    try {
      const npub = this.getFormattedNpub();
      this.copyToClipboard(npub, 'npub');
    } catch (error) {
      console.warn('Failed to copy npub:', error);
      this.snackBar.open('Unable to copy invalid pubkey', 'Close', { duration: 3000 });
    }
  }

  copyNprofile(): void {
    try {
      // For simplicity, just using npub here. In a real implementation,
      // would need to create a proper nprofile URI with relays
      const npub = this.getFormattedNpub();
      this.copyToClipboard(npub, 'nprofile');
    } catch (error) {
      console.warn('Failed to copy nprofile:', error);
      this.snackBar.open('Unable to copy invalid pubkey', 'Close', { duration: 3000 });
    }
  }

  copyProfileData(): void {
    const metadata = this.userMetadata();
    if (metadata) {
      this.copyToClipboard(metadata.event.content, 'profile data');
    }
  }

  copyFollowingList(): void {
    // Placeholder for actual implementation that would fetch the following list
    this.logger.debug('Copy following list requested for:', this.pubkey());
    this.copyToClipboard('Following list not implemented yet', 'following list');
  }

  copyRelayList(): void {
    // Placeholder for actual implementation that would fetch the relay list
    this.logger.debug('Copy relay list requested for:', this.pubkey());
    this.copyToClipboard('Relay list not implemented yet', 'relay list');
  }

  shareProfile(): void {
    // Share profile action using the Web Share API if available
    const window = this.getWindow();

    if (isPlatformBrowser(this.platformId) && window?.navigator?.share) {
      window.navigator
        .share({
          title: `${this.getFormattedName()}'s Nostr Profile`,
          text: `Check out ${this.getFormattedName()} on Nostr`,
          url: this.getCurrentUrl(),
        })
        .then(() => {
          this.logger.debug('Profile shared successfully');
        })
        .catch(error => {
          this.logger.error('Error sharing profile:', error);
        });
    } else {
      // Fallback if Web Share API is not available
      this.copyToClipboard(this.getCurrentUrl(), 'profile URL');
    }
  }

  shareProfileUrl(): void {
    this.copyToClipboard(this.getCurrentUrl(), 'profile URL');
  }

  isFollowing = computed(() => {
    const followingList = this.accountState.followingList();
    return followingList.includes(this.pubkey());
  });

  muteUser(): void {
    this.logger.debug('Mute requested for:', this.pubkey());
    // TODO: Implement actual mute functionality
  }

  blockUser(): void {
    this.logger.debug('Block requested for:', this.pubkey());
    // TODO: Implement actual block functionality
  }

  /**
   * Reveals a blocked profile temporarily
   */
  revealBlockedProfile(): void {
    this.isBlockedProfileRevealed.set(true);
    this.logger.debug('Revealed blocked profile:', this.pubkey());
  }

  /**
   * Opens the profile picture in a larger view dialog
   */
  openProfilePicture(): void {
    const metadata = this.userMetadata();
    if (metadata?.data.picture) {
      const dialogRef = this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaUrl: metadata.data.picture,
          mediaType: 'image',
          mediaTitle: this.getFormattedName() + ' Profile Picture',
        },
        maxWidth: '100vw',
        maxHeight: '100vh',
        panelClass: 'profile-picture-dialog',
      });

      this.logger.debug('Opened profile picture dialog');
    }
  }

  /**
   * Gets the current URL safely in both browser and server environments
   */
  private getCurrentUrl(): string {
    if (isPlatformBrowser(this.platformId)) {
      const window = this.getWindow();
      return window?.location?.href || this.getServerSideUrl();
    }
    return this.getServerSideUrl();
  }

  /**
   * Creates a URL from router state for server-side rendering
   */
  private getServerSideUrl(): string {
    const url = this.router.url;
    // Use configured app URL or fallback
    const baseUrl = isPlatformBrowser(this.platformId)
      ? this.document.location?.origin
      : 'https://nostria.app/';
    return `${baseUrl}${url}`;
  }
}
