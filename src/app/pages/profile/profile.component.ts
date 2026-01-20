import {
  Component,
  inject,
  signal,
  effect,
  untracked,
  PLATFORM_ID,
  DOCUMENT,
  computed,
  input,
} from '@angular/core';
import { isPlatformBrowser, Location } from '@angular/common';
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
import { CustomDialogService } from '../../services/custom-dialog.service';
import { ProfileViewOptionsInlineComponent } from './profile-view-options/profile-view-options-inline.component';
import { PanelNavigationService } from '../../services/panel-navigation.service';

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
    ProfileViewOptionsInlineComponent,
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
  host: {
    '[class.in-right-panel]': 'isInRightPanel()',
    'class': 'panel-with-sticky-header',
  },
})
export class ProfileComponent {
  // Input for two-column layout mode - when provided, uses this instead of route params
  twoColumnPubkey = input<string | undefined>(undefined);

  private data = inject(DataService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
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
  private readonly customDialog = inject(CustomDialogService);
  private readonly panelNav = inject(PanelNavigationService);

  pubkey = signal<string>('');

  // Computed signal for profile display name (for toolbar title)
  profileDisplayName = computed(() => {
    const metadata = this.userMetadata();
    if (!metadata) return 'Profile';

    // Priority: display_name > name > nip05 > 'Profile'
    if (metadata.data.display_name) return metadata.data.display_name;
    if (metadata.data.name) return metadata.data.name;
    if (metadata.data.nip05) return this.utilities.parseNip05(metadata.data.nip05) || 'Profile';
    return 'Profile';
  });
  userMetadata = signal<NostrRecord | undefined>(undefined);
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);

  // Detect if profile is rendered in the right panel outlet
  isInRightPanel = computed(() => {
    return this.route.outlet === 'right';
  });

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

  // Convert route params to a signal
  private routeParams = toSignal<ParamMap>(this.route.paramMap);
  private routeData = toSignal<Data>(this.route.data);
  // private userRelayFactory = inject(UserRelayFactoryService);
  // private userRelay: UserRelayService | undefined = undefined;

  // Track the previous profile pubkey to detect actual profile changes
  private previousProfilePubkey: string | null = null;

  constructor() {
    // Log if running in SSR context
    if (!this.app.isBrowser()) {
      this.logger.info('[ProfileComponent] Running in SSR context');
    }

    // Check for router navigation state (browser only)
    const navigation = this.app.isBrowser() ? this.router.currentNavigation() : null;
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

    // React to changes in route parameters, input parameter, and app initialization
    effect(async () => {
      // During SSR, we don't need full app initialization (storage/nostr)
      // In browser, wait for full initialization
      const canProceed = this.app.isBrowser() ? this.app.initialized() : true;

      // Get pubkey from either input (two-column mode) or route params
      const inputPubkey = this.twoColumnPubkey();
      const routeParams = this.routeParams();
      // We only need routeParams to be available. routeData might be empty or undefined initially but isn't strictly required for basic ID lookup
      const hasRouteParams = !!routeParams;

      // Only proceed if conditions are met and we have either input or route params
      if (canProceed && (inputPubkey || hasRouteParams)) {
        untracked(async () => {
          let id, username;

          // If we have a direct pubkey input (two-column mode), use it
          if (inputPubkey) {
            id = inputPubkey;
            this.logger.debug('[ProfileComponent] Using pubkey from input:', id);
          } else {
            // Otherwise, use route params (normal navigation mode)
            // For username routes (/u/:username), get username from params and resolve to pubkey
            username = routeParams?.get('username');
            if (username) {
              // Check if UsernameResolver already resolved the pubkey (handles NIP-05 and premium usernames)
              const resolvedUser = this.routeData()?.['user'] as { id: string | undefined; username: string } | undefined;
              if (resolvedUser?.id) {
                id = resolvedUser.id;
                this.logger.info('[ProfileComponent] Using resolved user from UsernameResolver:', { username, id });
              } else if (this.app.isBrowser()) {
                // Fallback: resolve username to pubkey (shouldn't normally happen if resolver works)
                id = await this.username.getPubkey(username);
                this.logger.info('[ProfileComponent] Resolved username in browser (fallback):', { username, id });
              } else {
                // During SSR, we don't have the id here, but the component will still render
                // and the metadata is already loaded by DataResolver
                this.logger.info('[ProfileComponent] Username route in SSR:', username);
              }
            } else {
              // For /p/:id routes, get id directly from params
              id = this.routeParams()?.get('id');
            }
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

            // Preserve the original npub if present
            const originalNpub = id.startsWith('npub') ? id : null;

            // Only update the URL when profile is NOT in the right panel (pane navigation)
            // When in right panel, we want to preserve the main route (e.g., /people) for bookmarking
            const shouldUpdateUrl = this.route.outlet !== 'right';

            if (id.startsWith('npub')) {
              id = this.utilities.getPubkeyFromNpub(id);

              // First update URL to have npub in URL.
              if (shouldUpdateUrl) {
                if (username) {
                  this.url.updatePathSilently(['/u', username]);
                } else {
                  // username = await this.username.getUsername(id);
                  const identifier: string = id;
                  this.username.getUsername(id).then(username => {
                    if (username) {
                      this.url.updatePathSilently(['/u', username]);
                    } else {
                      // If we already have npub in URL, keep it; otherwise encode the hex pubkey
                      const encoded = originalNpub || nip19.npubEncode(identifier);
                      this.url.updatePathSilently(['/p', encoded]);
                    }
                  });
                }
              }
            } else {
              if (shouldUpdateUrl && !username) {
                const identifier: string = id;
                this.username.getUsername(id).then(username => {
                  if (username) {
                    this.url.updatePathSilently(['/u', username]);
                  } else {
                    // If we find event only by ID, we should update the URL to include the NIP-19 encoded value that includes the pubkey.
                    const encoded = nip19.npubEncode(identifier);
                    this.url.updatePathSilently(['/p', encoded]);
                  }
                });
              }
            }

            // Check if this is the same profile being reloaded (e.g., browser back)
            const currentProfilePubkey = this.profileState.pubkey();
            const isSameProfile = currentProfilePubkey === id;

            // Always set the profile pubkey first
            this.profileState.setCurrentProfilePubkey(id);

            // Tell ProfileStateService which panel we're in for scroll signal handling
            this.profileState.isInRightPanel.set(this.route.outlet === 'right');

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

            // Browser-only: Track metrics and profile views
            if (this.app.isBrowser()) {
              await this.metrics.incrementMetric(this.pubkey(), 'viewed');

              // Track profile view (but not for own profile)
              if (!this.isOwnProfile()) {
                await this.profileTracking.trackProfileView(this.pubkey());
              }
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
        // Check if we're navigating to a profile route (supports both root and named outlets)
        const currentUrl = event.urlAfterRedirects;
        const isProfileRoute = currentUrl.match(/(?:\/|\(|:)(p|u)\//);
        if (isProfileRoute) {
          // Extract the profile ID from the URL
          const profileMatch = currentUrl.match(/(?:\/|\(|:)(?:p|u)\/([^/\)]+)/);
          const urlProfileId = profileMatch ? profileMatch[1] : null;

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
  }

  goBack(): void {
    if (this.isInRightPanel()) {
      // Use panel navigation for right panel back navigation
      this.panelNav.goBackRight();
    } else {
      // Use browser history for primary outlet
      this.location.back();
    }
  }

  /**
   * Prevent menu from closing when clicking on toggle
   */
  preventMenuClose(event: MouseEvent): void {
    event.stopPropagation();
  }

  /**
   * Safely access window object in browser context
   * @returns Window object or null if not in browser
   */
  private getWindow(): Window | null {
    return isPlatformBrowser(this.platformId) ? this.document.defaultView : null;
  }

  private async loadUserProfile(pubkey: string): Promise<void> {
    // Skip profile loading during SSR as it requires browser-specific storage
    if (!this.app.isBrowser()) {
      this.logger.info('[ProfileComponent] Skipping profile loading in SSR');
      this.isLoading.set(false);
      return;
    }

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

        // Only scroll when not in right panel - right panel profiles don't need scrolling
        // as the banner is already at the top
        if (!this.isInRightPanel()) {
          setTimeout(() => this.layoutService.scrollToOptimalProfilePosition(), 100);
        }
      }

      // Then force refresh profile data from relays to ensure it's up to date
      // Using forceRefresh to bypass cache and get the latest from relays
      // Enable deepResolve to search all observed relays if not found on user's relays
      this.logger.debug('Force refreshing profile data from relays for:', hexPubkey);
      const refreshedMetadata = await this.data.getProfile(hexPubkey, { forceRefresh: true, deepResolve: true });

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
      // Skip scrolling in right panel mode as banner is already visible at top
      if (!cachedMetadata && !this.isInRightPanel()) {
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
        width: '100vw',
        height: '100vh',
        panelClass: 'image-dialog-panel',
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
