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
  OnDestroy,
  TemplateRef,
  viewChild,
  AfterViewInit,
  DestroyRef,
} from '@angular/core';
import { isPlatformBrowser, Location, NgTemplateOutlet } from '@angular/common';
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
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApplicationStateService } from '../../services/application-state.service';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatListModule } from '@angular/material/list';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { nip19, kinds } from 'nostr-tools';
import { ProfileState } from '../../services/profile-state';
import { ProfileStateFactory, PROFILE_STATE } from '../../services/profile-state-factory.service';
import { ProfileTrackingService } from '../../services/profile-tracking.service';
import { LayoutService } from '../../services/layout.service';
import { ProfileHeaderComponent } from './profile-header/profile-header.component';
import { ApplicationService } from '../../services/application.service';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { AccountStateService } from '../../services/account-state.service';
import { NostrRecord } from '../../interfaces';
import { DataService, DeepDiscoveryStatus } from '../../services/data.service';
import { UtilitiesService } from '../../services/utilities.service';
import { UrlUpdateService } from '../../services/url-update.service';
import { UsernameService } from '../../services/username';
import { Metrics } from '../../services/metrics';
import { AccountRelayService } from '../../services/relays/account-relay';
import { ReportingService, ReportTarget } from '../../services/reporting.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { ProfileViewOptionsInlineComponent } from './profile-view-options/profile-view-options-inline.component';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { RightPanelHeaderService } from '../../services/right-panel-header.service';
import { LeftPanelHeaderService } from '../../services/left-panel-header.service';
import { ZapButtonComponent } from '../../components/zap-button/zap-button.component';
import { ZapService } from '../../services/zap.service';
import { ZapDialogComponent, ZapDialogData } from '../../components/zap-dialog/zap-dialog.component';
import { FavoritesService } from '../../services/favorites.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { CreateListDialogComponent, CreateListDialogResult } from '../../components/create-list-dialog/create-list-dialog.component';
import { PublishDialogComponent, PublishDialogData } from '../../components/publish-dialog/publish-dialog.component';
import { DatabaseService } from '../../services/database.service';
import { UserRelayService } from '../../services/relays/user-relay';
import { AccountService } from '../../api/services';
import { PublicAccount } from '../../api/models';
import { firstValueFrom } from 'rxjs';
import { ProfileHomeComponent } from './profile-home/profile-home.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../components/share-article-dialog/share-article-dialog.component';
import { stripImageProxy } from '../../utils/strip-image-proxy';

@Component({
  selector: 'app-profile',
  imports: [
    RouterModule,
    RouterOutlet,
    NgTemplateOutlet,
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
    ZapButtonComponent,
    ProfileHomeComponent,
    OverlayModule,
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
  host: {
    '[class.in-right-panel]': 'isInRightPanel()',
  },
  providers: [
    {
      provide: PROFILE_STATE,
      useFactory: (factory: ProfileStateFactory) => factory.create(),
      deps: [ProfileStateFactory],
    },
  ],
})
export class ProfileComponent implements OnDestroy, AfterViewInit {
  // Input for two-column layout mode - when provided, uses this instead of route params
  twoColumnPubkey = input<string | undefined>(undefined);

  // Template reference for the header (used when in right panel)
  readonly headerTemplate = viewChild<TemplateRef<unknown>>('headerTemplate');

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
  profileState = inject(PROFILE_STATE);
  accountState = inject(AccountStateService);
  readonly utilities = inject(UtilitiesService);
  private readonly url = inject(UrlUpdateService);
  private readonly username = inject(UsernameService);
  private readonly profileTracking = inject(ProfileTrackingService);
  private readonly metrics = inject(Metrics);
  private readonly reportingService = inject(ReportingService);
  private readonly customDialog = inject(CustomDialogService);
  private readonly panelNav = inject(PanelNavigationService);
  private readonly rightPanelHeader = inject(RightPanelHeaderService);
  private readonly leftPanelHeader = inject(LeftPanelHeaderService);
  private readonly zapService = inject(ZapService);
  private readonly favoritesService = inject(FavoritesService);
  private readonly followSetsService = inject(FollowSetsService);
  private readonly database = inject(DatabaseService);
  private readonly userRelayService = inject(UserRelayService);
  private readonly accountService = inject(AccountService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly destroyRef = inject(DestroyRef);

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

  // Computed to expose deep discovery status for this profile
  deepDiscoveryStatus = computed(() => {
    const status = this.data.deepDiscoveryStatus();
    // Only show status if it's for the current profile
    if (status && status.pubkey === this.pubkey()) {
      return status;
    }
    return null;
  });

  // Detect if profile is rendered in the right panel outlet
  isInRightPanel = computed(() => {
    return this.route.outlet === 'right';
  });

  isOwnProfile = computed(() => {
    return this.accountState.pubkey() === this.pubkey();
  });

  // Check if current profile user is blocked
  // Checks both pubkey-based muting AND profile muted words (name, display_name, nip05)
  isProfileBlocked = computed(() => {
    const currentPubkey = this.pubkey();
    if (!currentPubkey || this.isOwnProfile()) return false;

    // Check pubkey-based blocking
    const isBlocked = this.reportingService.isUserBlocked(currentPubkey);
    if (isBlocked) {
      this.logger.debug('Profile blocked (pubkey):', { currentPubkey });
      return true;
    }

    // Check if profile fields match any muted words
    const isBlockedByWord = this.reportingService.isProfileBlockedByMutedWord(currentPubkey);
    if (isBlockedByWord) {
      this.logger.debug('Profile blocked (word match):', { currentPubkey });
      return true;
    }

    return false;
  });

  // Signal to control whether blocked profile is revealed
  isBlockedProfileRevealed = signal(false);

  // Track previous blocked state to detect changes
  private previousBlockedState = signal(false);

  showLightningQR = signal(false);
  lightningQrCode = signal<string>('');
  followingList = signal<string[]>([]); // This would be dynamically updated with real data

  // Filter panel state for view options
  filterPanelOpen = signal(false);
  filterPanelPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ];

  // Signal to track the premium status
  premiumTier = signal<string | null>(null);

  // Signal to track the username of the profile being viewed
  profileUsername = signal<string | null>(null);

  // Computed to check if user has premium subscription
  isPremium = computed(() => {
    const tier = this.premiumTier();
    return tier === 'premium' || tier === 'premium_plus';
  });

  // Computed to check if the profile has a Lightning Address configured
  hasLightningAddress = computed(() => {
    const profileData = this.userMetadata()?.data;
    if (!profileData) return false;
    return this.zapService.getLightningAddress(profileData) !== null;
  });

  // Computed for following status
  isFollowing = computed(() => {
    const followingList = this.accountState.followingList();
    return followingList.includes(this.pubkey());
  });

  // Check if the profile being viewed is following the logged-in user
  isFollowingMe = computed(() => {
    const myPubkey = this.accountState.pubkey();
    const theirFollowingList = this.profileState.followingList();
    return myPubkey ? theirFollowingList.includes(myPubkey) : false;
  });

  // Computed for favorite status
  isFavorite = computed(() => {
    return this.favoritesService.isFavorite(this.pubkey());
  });

  // Check if the current user is blocked
  isUserBlocked = computed(() => {
    const pubkey = this.pubkey();
    if (!pubkey || this.isOwnProfile()) return false;
    return this.reportingService.isUserBlocked(pubkey);
  });

  // Computed to get available follow sets (sorted alphabetically)
  availableFollowSets = computed(() => {
    return [...this.followSetsService.followSets()].sort((a, b) => a.title.localeCompare(b.title));
  });

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

    // Fetch premium status when pubkey changes
    effect(async () => {
      const currentPubkey = this.pubkey();
      if (currentPubkey && this.app.isBrowser()) {
        untracked(() => {
          this.fetchPremiumStatus(currentPubkey);
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

            if (id.startsWith('nprofile')) {
              try {
                const decoded = nip19.decode(id);
                if (decoded.type === 'nprofile') {
                  const profileData = decoded.data as { pubkey: string };
                  id = profileData.pubkey;
                }
              } catch (e) {
                this.logger.warn('Failed to decode nprofile:', e);
                this.error.set('Invalid profile identifier');
                this.isLoading.set(false);
                return;
              }

              // Update URL to use npub or username
              if (shouldUpdateUrl) {
                const identifier: string = id;
                this.username.getUsername(id).then(username => {
                  if (username) {
                    this.url.updatePathSilently(['/u', username]);
                  } else {
                    const encoded = nip19.npubEncode(identifier);
                    this.url.updatePathSilently(['/p', encoded]);
                  }
                });
              }
            } else if (id.startsWith('npub')) {
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

            // Tell ProfileState which panel we're in for scroll signal handling
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
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => {
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
      return;
    }

    // In primary outlet - check if there's left panel history to go back to
    if (this.panelNav.canGoBackLeft()) {
      this.panelNav.goBackLeft();
    } else {
      // No history - navigate to feeds as the default destination
      this.router.navigate(['/f']);
    }
  }

  /**
   * Prevent menu from closing when clicking on toggle
   */
  preventMenuClose(event: MouseEvent): void {
    event.stopPropagation();
  }

  /**
   * Toggle the filter panel open/closed
   */
  toggleFilterPanel(): void {
    this.filterPanelOpen.update(v => !v);
  }

  /**
   * Close the filter panel
   */
  closeFilterPanel(): void {
    this.filterPanelOpen.set(false);
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
      // Always set loading to false when done - the profile may have been found
      // via deep discovery and userMetadata was already set
      this.isLoading.set(false);
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
      this.logger.warn('Invalid pubkey in getTruncatedPubkey:', pubkey);
      return this.utilities.formatInvalidPubkey(pubkey);
    }
    return this.utilities.getTruncatedNpub(pubkey);
  }

  getFormattedNpub(): string {
    const pubkey = this.pubkey();

    // Validate pubkey first
    if (!this.utilities.isValidPubkey(pubkey)) {
      this.logger.warn('Invalid pubkey in getFormattedNpub:', pubkey);
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
      this.logger.warn('Failed to copy npub:', error);
      this.snackBar.open('Unable to copy invalid pubkey', 'Close', { duration: 3000 });
    }
  }

  copyNprofile(): void {
    try {
      const pubkey = this.pubkey();
      if (!this.utilities.isValidPubkey(pubkey)) {
        throw new Error('Invalid pubkey');
      }

      const hexPubkey = this.utilities.safeGetHexPubkey(pubkey);
      if (!hexPubkey) {
        throw new Error('Failed to get hex pubkey');
      }

      // Get relay hints for the profile being viewed (not the current user's relays)
      const relays = this.userRelayService.getRelaysForPubkey(hexPubkey);

      // Encode nprofile with pubkey and relay hints
      const nprofile = nip19.nprofileEncode({
        pubkey: hexPubkey,
        relays: relays.slice(0, 1), // Include 1 relay hint for the profile
      });

      this.copyToClipboard(nprofile, 'nprofile');
    } catch (error) {
      this.logger.warn('Failed to copy nprofile:', error);
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
          url: this.getCanonicalProfileUrl(),
        })
        .then(() => {
          this.logger.debug('Profile shared successfully');
        })
        .catch(error => {
          this.logger.error('Error sharing profile:', error);
        });
    } else {
      // Fallback if Web Share API is not available
      this.copyToClipboard(this.getCanonicalProfileUrl(), 'profile URL');
    }
  }

  /**
   * Opens the share dialog for the current profile with multiple sharing options
   */
  openShareProfileDialog(): void {
    const pubkey = this.pubkey();
    if (!pubkey) {
      return;
    }

    const metadata = this.userMetadata();
    const displayName = this.getFormattedName();

    const dialogData: ShareArticleDialogData = {
      title: `${displayName}'s Profile`,
      summary: metadata?.data?.about || undefined,
      image: metadata?.data?.picture || undefined,
      url: this.getCanonicalProfileUrl(),
      eventId: metadata?.event?.id || '',
      pubkey: pubkey,
      kind: kinds.Metadata, // Profile is kind 0
    };

    this.customDialog.open(ShareArticleDialogComponent, {
      title: 'Share',
      data: dialogData,
      width: '450px',
      maxWidth: '95vw',
    });
  }

  /**
   * Get the canonical URL for the profile (using username or nprofile with relays)
   */
  private getCanonicalProfileUrl(): string {
    const pubkey = this.pubkey();
    const username = this.profileUsername();

    // If user has a username, use that
    if (username) {
      return `https://nostria.app/u/${username}`;
    }

    // Otherwise, use nprofile with relay hints for better discoverability
    // Use the profile's relays (not the current user's) for the hint
    const relays = this.userRelayService.getRelaysForPubkey(pubkey);
    const nprofile = nip19.nprofileEncode({
      pubkey: pubkey,
      relays: relays.slice(0, 1), // Include 1 relay hint for the profile
    });

    return `https://nostria.app/p/${nprofile}`;
  }

  shareProfileUrl(): void {
    this.copyToClipboard(this.getCurrentUrl(), 'profile URL');
  }

  muteUser(): void {
    this.logger.debug('Mute requested for:', this.pubkey());
    // TODO: Implement actual mute functionality
  }

  async blockUser(): Promise<void> {
    const pubkey = this.pubkey();
    if (!pubkey) return;

    if (this.isUserBlocked()) {
      // User is already blocked, so unblock them
      this.reportingService.unblockUser(pubkey);
    } else {
      // Check if we're currently following this user
      const isFollowing = this.isFollowing();

      if (isFollowing) {
        // Import ConfirmDialogComponent dynamically to show confirmation dialog
        const { ConfirmDialogComponent } = await import('../../components/confirm-dialog/confirm-dialog.component');

        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: 'Unfollow and Block User?',
            message: 'You are currently following this user. Would you like to unfollow them before blocking?',
            confirmText: 'Unfollow and Block',
            cancelText: 'Just Block',
            confirmColor: 'warn'
          },
          width: '400px',
        });

        const shouldUnfollow = await firstValueFrom(dialogRef.afterClosed());

        if (shouldUnfollow) {
          // Unfollow first, then block
          await this.accountState.unfollow(pubkey);
        }
      }

      // User is not blocked, so block them
      await this.reportingService.muteUser(pubkey);
    }
  }

  reportUser(): void {
    const pubkey = this.pubkey();
    if (!pubkey) {
      return;
    }

    const displayName = this.userMetadata()?.data.display_name || this.userMetadata()?.data.name || '';

    const reportTarget: ReportTarget = {
      type: 'user',
      pubkey: pubkey,
    };

    this.layoutService.showReportDialog(reportTarget, displayName);
  }

  /**
   * Follows the user
   */
  async followUser(): Promise<void> {
    this.logger.debug('Follow requested for:', this.pubkey());
    await this.accountState.follow(this.pubkey());
  }

  async unfollowUser(): Promise<void> {
    this.logger.debug('Unfollow requested for:', this.pubkey());
    await this.accountState.unfollow(this.pubkey());
  }

  /**
   * Opens the zap dialog for the user
   */
  zapUser(): void {
    const pubkey = this.pubkey();
    const profileData = this.userMetadata()?.data;

    if (!pubkey) {
      this.snackBar.open('Unable to determine user for zap', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    if (!profileData || !this.hasLightningAddress()) {
      this.snackBar.open('This user has no lightning address configured for zaps', 'Dismiss', {
        duration: 4000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    const dialogData: ZapDialogData = {
      recipientPubkey: pubkey,
      recipientName: this.getFormattedName(),
      recipientMetadata: profileData,
      eventId: undefined, // This is for zapping a user, not a specific event
    };

    this.dialog.open(ZapDialogComponent, {
      data: dialogData,
      width: '500px',
      disableClose: true,
      panelClass: 'responsive-dialog',
    });
  }

  giftPremium(): void {
    const pubkey = this.pubkey();
    const profileData = this.userMetadata()?.event?.content
      ? JSON.parse(this.userMetadata()!.event!.content)
      : null;

    this.layoutService.openGiftPremiumDialog(
      pubkey,
      this.getFormattedName(),
      profileData
    ).then(dialogRef => {
      dialogRef.afterClosed$.subscribe(result => {
        if (result?.result && (result.result as { success?: boolean }).success) {
          // Wait 2 seconds for backend to process the gift, then refresh premium status
          setTimeout(() => {
            this.fetchPremiumStatus(pubkey);
          }, 2000);
        }
      });
    });
  }

  openSendMessage(): void {
    this.layoutService.openSendMessage(this.pubkey());
  }

  toggleFavorite(): void {
    const currentPubkey = this.pubkey();
    if (!currentPubkey) return;

    const success = this.favoritesService.toggleFavorite(currentPubkey);
    if (success) {
      const isFavorite = this.favoritesService.isFavorite(currentPubkey);
      if (isFavorite) {
        this.snackBar.open('Added to favorites', 'Close', { duration: 2000 });
      } else {
        this.snackBar.open('Removed from favorites', 'Close', { duration: 2000 });
      }
    }
  }

  isInFollowSet(dTag: string): boolean {
    const set = this.followSetsService.getFollowSetByDTag(dTag);
    return set ? set.pubkeys.includes(this.pubkey()) : false;
  }

  async addToFollowSet(dTag: string): Promise<void> {
    const pubkey = this.pubkey();
    const isCurrentlyInSet = this.isInFollowSet(dTag);

    try {
      if (isCurrentlyInSet) {
        // Remove from set
        await this.followSetsService.removeFromFollowSet(dTag, pubkey);
        this.layoutService.toast('Removed from list');
      } else {
        // Add to set
        await this.followSetsService.addToFollowSet(dTag, pubkey);
        this.layoutService.toast('Added to list');
      }
    } catch (error) {
      this.layoutService.toast('Failed to update list');
    }
  }

  async createNewFollowSet(): Promise<void> {
    const dialogRef = this.dialog.open(CreateListDialogComponent, {
      data: {
        initialPrivate: false,
      },
      width: '450px',
    });

    const result: CreateListDialogResult | null = await firstValueFrom(dialogRef.afterClosed());

    if (!result || !result.title.trim()) {
      return;
    }

    try {
      const pubkey = this.pubkey();
      const newSet = await this.followSetsService.createFollowSet(
        result.title.trim(),
        [pubkey],
        result.isPrivate
      );

      if (newSet) {
        const privacyLabel = result.isPrivate ? 'private list' : 'list';
        this.layoutService.toast(`Created ${privacyLabel} "${result.title}" and added user`);
      } else {
        this.layoutService.toast('Failed to create list');
      }
    } catch (error) {
      this.layoutService.toast('Failed to create list');
    }
  }

  copyHex(): void {
    this.copyToClipboard(this.pubkey(), 'hex');
  }

  copyProfileUrl(): void {
    this.copyToClipboard(this.getCanonicalProfileUrl(), 'profile URL');
  }

  /**
   * Generate and share an invite link to Nostria
   */
  shareInviteLink(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open('Unable to generate invite link', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    try {
      // Get the logged-in user's account relays (not the profile being viewed)
      const relays = this.accountRelay.getRelayUrls();

      // Encode nprofile with pubkey and relays
      const nprofile = nip19.nprofileEncode({
        pubkey: pubkey,
        relays: relays.slice(0, 5), // Include up to 5 relays
      });

      // Generate the invite URL
      const inviteUrl = `${this.getWindow()?.location?.origin}/invite/${nprofile}`;

      // Use Web Share API if available
      const window = this.getWindow();
      if (window?.navigator?.share) {
        window.navigator
          .share({
            title: `Join me on Nostria!`,
            text: `${this.getFormattedName()} invited you to join Nostria - Your Social Network, Your Control`,
            url: inviteUrl,
          })
          .then(() => {
            this.logger.debug('Invite link shared successfully');
          })
          .catch(err => {
            this.logger.error('Error sharing invite link:', err);
            // Fallback to copying
            this.copyToClipboard(inviteUrl, 'invite link');
          });
      } else {
        // Fallback to copying
        this.copyToClipboard(inviteUrl, 'invite link');
      }
    } catch (err) {
      this.logger.error('Failed to generate invite link', err);
      this.snackBar.open('Failed to generate invite link', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
  }

  /**
   * Opens the share dialog for invitation link with multiple sharing options
   */
  openShareInviteDialog(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open('Unable to generate invite link', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    try {
      const metadata = this.userMetadata();
      const displayName = this.getFormattedName();

      // Get the logged-in user's account relays
      const relays = this.accountRelay.getRelayUrls();

      // Encode nprofile with pubkey and relays
      const nprofile = nip19.nprofileEncode({
        pubkey: pubkey,
        relays: relays.slice(0, 5), // Include up to 5 relays
      });

      // Generate the invite URL
      const inviteUrl = `https://nostria.app/invite/${nprofile}`;

      const dialogData: ShareArticleDialogData = {
        title: `Join ${displayName} on Nostria!`,
        summary: `${displayName} invited you to join Nostria - Your Social Network, Your Control`,
        image: metadata?.data?.picture || undefined,
        url: inviteUrl,
        eventId: '',
        pubkey: pubkey,
        kind: kinds.Metadata,
      };

      this.customDialog.open(ShareArticleDialogComponent, {
        title: 'Share',
        data: dialogData,
        width: '450px',
        maxWidth: '95vw',
      });
    } catch (err) {
      this.logger.error('Failed to open invite dialog', err);
      this.snackBar.open('Failed to generate invite link', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
  }

  async publishProfileEvent(): Promise<void> {
    const currentProfile = this.userMetadata();
    if (!currentProfile) {
      this.snackBar.open('Profile not found', 'Close', { duration: 2000 });
      return;
    }

    const dialogData: PublishDialogData = {
      event: currentProfile.event,
    };

    this.dialog.open(PublishDialogComponent, {
      data: dialogData,
      width: '600px',
      disableClose: false,
    });
  }

  async publishRelayListEvent(): Promise<void> {
    const currentPubkey = this.pubkey();
    if (!currentPubkey) {
      this.snackBar.open('Profile not found', 'Close', { duration: 2000 });
      return;
    }

    try {
      // Get the relay list event (kind 10002)
      const relayListEvent = await this.database.getEventByPubkeyAndKind(
        currentPubkey,
        kinds.RelayList
      );

      if (!relayListEvent) {
        this.snackBar.open('Relay list not found', 'Close', {
          duration: 2000,
        });
        return;
      }

      const dialogData: PublishDialogData = {
        event: relayListEvent,
      };

      this.dialog.open(PublishDialogComponent, {
        data: dialogData,
        width: '600px',
        disableClose: false,
      });
    } catch (error) {
      this.logger.error('Error getting relay list event:', error);
      this.snackBar.open('Error loading relay list', 'Close', {
        duration: 2000,
      });
    }
  }

  async publishFollowingListEvent(): Promise<void> {
    const currentPubkey = this.pubkey();
    if (!currentPubkey) {
      this.snackBar.open('Profile not found', 'Close', { duration: 2000 });
      return;
    }

    try {
      // Get the following list event (kind 3) from user relay service
      const followingListEvent = await this.userRelayService.getEventByPubkeyAndKind(
        currentPubkey,
        kinds.Contacts
      );

      if (!followingListEvent) {
        this.snackBar.open('Following list not found', 'Close', {
          duration: 2000,
        });
        return;
      }

      const dialogData: PublishDialogData = {
        event: followingListEvent,
      };

      this.dialog.open(PublishDialogComponent, {
        data: dialogData,
        width: '600px',
        disableClose: false,
      });
    } catch (error) {
      this.logger.error('Error getting following list event:', error);
      this.snackBar.open('Error loading following list', 'Close', {
        duration: 2000,
      });
    }
  }

  /**
   * Fetches the premium status for a given pubkey
   */
  private async fetchPremiumStatus(pubkey: string): Promise<void> {
    try {
      // Check if this is the current user
      if (this.isOwnProfile()) {
        // For current user, get tier from account state
        const subscription = this.accountState.subscription();
        this.premiumTier.set(subscription?.tier || null);
        this.profileUsername.set(subscription?.username || null);
      } else {
        // For other users, fetch public account information
        const result = await firstValueFrom(
          this.accountService.getPublicAccount({
            pubkeyOrUsername: pubkey,
          })
        );

        if (result?.result) {
          const publicAccount: PublicAccount = result.result;
          this.premiumTier.set(publicAccount?.tier || null);
          this.profileUsername.set(publicAccount?.username || null);
        } else {
          this.premiumTier.set(null);
          this.profileUsername.set(null);
        }
      }
    } catch (error) {
      this.logger.debug('Error fetching premium status:', error);
      this.premiumTier.set(null);
      this.profileUsername.set(null);
    }
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
      // Strip third-party image proxy wrappers to load the original image directly
      const cleanUrl = stripImageProxy(metadata.data.picture);
      const dialogRef = this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaUrl: cleanUrl,
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

  ngAfterViewInit(): void {
    // Register header template with the appropriate panel header service
    const template = this.headerTemplate();
    if (template) {
      if (this.isInRightPanel()) {
        this.rightPanelHeader.setHeaderTemplate(template);
      } else {
        this.leftPanelHeader.setHeaderTemplate(template);
      }
    }
  }

  ngOnDestroy(): void {
    // Clean up the ProfileState instance to prevent memory leaks
    this.profileState.destroy();

    // Clear the panel header when component is destroyed
    if (this.isInRightPanel()) {
      this.rightPanelHeader.clear();
    } else {
      this.leftPanelHeader.clear();
    }
  }
}
