import { Component, effect, inject, input, signal, untracked, computed, OnDestroy } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { MatListModule } from '@angular/material/list';
import { LayoutService } from '../../../services/layout.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { NostrRecord } from '../../../interfaces';
import { isNip05, queryProfile } from 'nostr-tools/nip05';
import { nip19, kinds } from 'nostr-tools';
import { AccountStateService } from '../../../services/account-state.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { QrCodeComponent } from '../../../components/qr-code/qr-code.component';
import { FavoritesService } from '../../../services/favorites.service';
import { MatDialog } from '@angular/material/dialog';
import { AccountService } from '../../../api/services';
import { PublicAccount } from '../../../api/models';
import { firstValueFrom } from 'rxjs';
import {
  PublishDialogComponent,
  PublishDialogData,
} from '../../../components/publish-dialog/publish-dialog.component';
import { DatabaseService } from '../../../services/database.service';
import type { ReportTarget } from '../../../services/reporting.service';
import { ReportingService } from '../../../services/reporting.service';
import { ZapButtonComponent } from '../../../components/zap-button/zap-button.component';
import { ZapService } from '../../../services/zap.service';
import { BioContentComponent } from '../../../components/bio-content/bio-content.component';
import {
  ZapDialogComponent,
  ZapDialogData,
} from '../../../components/zap-dialog/zap-dialog.component';
import { UserRelayService } from '../../../services/relays/user-relay';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { BadgeService } from '../../../services/badge.service';
import { BadgeHoverCardService } from '../../../services/badge-hover-card.service';
import { DataService } from '../../../services/data.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { SettingsService } from '../../../services/settings.service';
import { stripImageProxy } from '../../../utils/strip-image-proxy';

import { Router } from '@angular/router';
import type { Event as NostrEvent } from 'nostr-tools';
import { TrustService } from '../../../services/trust.service';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { CreateListDialogComponent, CreateListDialogResult } from '../../../components/create-list-dialog/create-list-dialog.component';

interface MutualFollowProfile {
  pubkey: string;
  picture?: string;
  displayName?: string;
}

@Component({
  selector: 'app-profile-header',
  imports: [
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    RouterModule,
    MatButtonModule,
    MatDividerModule,
    MatTooltipModule,
    QrCodeComponent,
    ZapButtonComponent,
    BioContentComponent,
  ],
  templateUrl: './profile-header.component.html',
  styleUrl: './profile-header.component.scss',
})
export class ProfileHeaderComponent implements OnDestroy {
  profile = input<NostrRecord | undefined>(undefined);
  pubkey = input<string>(''); // Add pubkey input for cases where no profile exists
  layout = inject(LayoutService);
  nostr = inject(NostrService);
  npub = signal<string | undefined>(undefined);
  logger = inject(LoggerService);
  profileState = inject(PROFILE_STATE);
  accountState = inject(AccountStateService);
  utilities = inject(UtilitiesService);
  layoutService = inject(LayoutService);
  private snackBar = inject(MatSnackBar);
  private favoritesService = inject(FavoritesService);
  private dialog = inject(MatDialog);
  private database = inject(DatabaseService);
  private accountService = inject(AccountService);
  private reportingService = inject(ReportingService);
  private zapService = inject(ZapService);
  private userRelayService = inject(UserRelayService);
  private accountRelay = inject(AccountRelayService);
  badgeService = inject(BadgeService);
  private badgeHoverCardService = inject(BadgeHoverCardService);
  private router = inject(Router);
  private trustService = inject(TrustService);
  private followSetsService = inject(FollowSetsService);
  private dataService = inject(DataService);
  private imageCacheService = inject(ImageCacheService);
  readonly settingsService = inject(SettingsService);

  // Mutual followers ("Followers you know")
  mutualFollowing = signal<string[]>([]);
  mutualFollowingProfiles = signal<MutualFollowProfile[]>([]);

  mutualFollowingText = computed(() => {
    const count = this.mutualFollowing().length;
    if (count === 0) return '';

    const profiles = this.mutualFollowingProfiles();
    const names = profiles
      .map(p => p.displayName)
      .filter((n): n is string => !!n && n !== 'Unknown');

    if (count === 1) {
      return names.length > 0 ? `Followed by ${names[0]}` : '1 follower in common';
    } else if (count === 2) {
      return names.length === 2
        ? `Followed by ${names[0]} and ${names[1]}`
        : `${count} followers in common`;
    } else {
      const remaining = count - names.length;
      if (names.length === 0) {
        return `${count} followers in common`;
      } else if (names.length === 1) {
        return `Followed by ${names[0]} and ${remaining} other${remaining !== 1 ? 's' : ''} you follow`;
      } else {
        return `Followed by ${names[0]}, ${names[1]} and ${remaining} other${remaining !== 1 ? 's' : ''} you follow`;
      }
    }
  });

  // Add signal for QR code visibility
  showQrCode = signal<boolean>(false);
  showProfileQrCode = signal<boolean>(false);

  // Add signal for bio expansion
  isBioExpanded = signal<boolean>(false);

  // Computed for top 3 accepted badges
  topBadges = computed(() => {
    const accepted = this.badgeService.acceptedBadges();
    return accepted.slice(0, 3);
  });

  // Computed to check if user has accepted badges
  hasAcceptedBadges = computed(() => {
    return this.badgeService.acceptedBadges().length > 0;
  });

  // Computed for badge count
  badgeCount = computed(() => {
    return this.badgeService.acceptedBadges().length;
  });

  // No longer need hasMoreBadges since all badges link to badges page

  // Memoized parsed badges to prevent NG0100 error
  // Need to also track badgeDefinitions signal to react to async loading
  parsedBadges = computed(() => {
    // Include badgeDefinitions in the dependency graph so computed re-runs when definitions load
    this.badgeService.badgeDefinitions();
    // Also include failedBadgeDefinitions to react when badges fail to load
    this.badgeService.failedBadgeDefinitions();
    // Include loadingBadgeDefinitions to react to loading state changes
    this.badgeService.loadingBadgeDefinitions();

    return this.topBadges().map(badge => {
      const badgeDefinition = this.getBadgeDefinition(badge);

      // Return partial data immediately if definition is not loaded yet
      if (!badgeDefinition) {
        return {
          slug: badge.slug,
          name: 'Loading...',
          description: '',
          image: '',
          thumb: '',
          tags: [],
        };
      }

      return this.parseBadgeDefinition(badgeDefinition);
    });
  });

  // Computed to check if a badge failed to load
  isBadgeFailed = computed(() => {
    return this.topBadges().map(badge =>
      this.badgeService.isBadgeDefinitionFailed(badge.pubkey, badge.slug)
    );
  });

  // Computed to check if a badge is currently loading
  isBadgeLoading = computed(() => {
    return this.topBadges().map(badge =>
      this.badgeService.isBadgeDefinitionLoading(badge.pubkey, badge.slug)
    );
  });

  // Track badges that have timed out (3 second timeout)
  private timedOutBadges = signal<Set<string>>(new Set());
  private badgeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  // Computed to check if a badge has timed out
  isBadgeTimedOut = computed(() => {
    const timedOut = this.timedOutBadges();
    return this.topBadges().map(badge => {
      const badgeKey = `${badge.pubkey}:${badge.slug}`;
      return timedOut.has(badgeKey);
    });
  });

  // Computed property to check if bio needs expansion
  shouldShowExpander = computed(() => {
    const about = this.profile()?.data.about;
    if (!about) return false;

    // Split by actual newlines to count lines
    const lines = about.split('\n');

    // If there are more than 3 newline-separated lines, show expander
    if (lines.length > 3) return true;

    // Check if any of the first 3 lines are very long (more than 80 chars)
    // which would likely wrap to multiple lines
    const firstThreeLines = lines.slice(0, 3);
    const hasLongLine = firstThreeLines.some((line: string) => line.length > 80);

    // Estimate total character count that would fit in 3 lines
    // Using conservative estimate of ~80 chars per line = 240 chars total
    const totalLength = firstThreeLines.reduce((sum: number, line: string) => sum + line.length, 0);

    return hasLongLine && totalLength > 240;
  });

  // Computed property for displayed bio text
  displayedBio = computed(() => {
    const about = this.profile()?.data.about;
    if (!about || this.isBioExpanded() || !this.shouldShowExpander()) {
      return about;
    }

    // Truncate to approximately 3 lines worth of text
    const lines = about.split('\n');
    if (lines.length <= 3) {
      return about.length > 240 ? about.substring(0, 240) + '...' : about;
    }

    return lines.slice(0, 3).join('\n') + '...';
  });

  // Computed to get website URL with protocol prefix
  websiteUrl = computed(() => {
    const website = this.profile()?.data.website;
    if (!website) {
      return '';
    }

    return this.getWebsiteUrl(website);
  });

  // Add signal for verified identifier
  verifiedIdentifier = signal<{
    value: string;
    valid: boolean;
    status: string;
  }>({ value: '', valid: false, status: '' });

  // Computed favicon URL for verified NIP-05 identifier
  verifiedFaviconUrl = computed(() => {
    const value = this.verifiedIdentifier().value;
    if (!value) return '';

    // Extract domain from possible formats like 'user@domain.com' or 'domain.com'
    const domain = value.includes('@') ? value.split('@')[1] : value;
    if (!domain) return '';

    // Normalize domain and remove any path fragments
    const clean = domain.replace(/^https?:\/\//, '').replace(/\/.*/, '');
    return this.getFaviconUrl(clean);
  });

  // Track favicon state
  faviconTriedPng = signal<boolean>(false);
  faviconFailed = signal<boolean>(false);

  name = computed(() => {
    const profileData = this.profile();
    if (!profileData) {
      // Fallback to truncated pubkey when no profile exists
      return this.utilities.getTruncatedNpub(this.pubkey());
    }

    if (profileData.data.display_name) {
      return profileData.data.display_name;
    } else if (profileData.data.name) {
      return profileData.data.name;
    } else {
      return this.utilities.getTruncatedNpub(profileData.event.pubkey);
    }
  });

  isOwnProfile = computed(() => {
    return this.accountState.pubkey() === this.pubkey();
  });

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

  isFavorite = computed(() => {
    return this.favoritesService.isFavorite(this.pubkey());
  });

  // Use ProfileState.relayList() directly - this is populated from local database cache first
  // for instant display, then updated from discovery relay if a newer version is found
  getUserRelays = computed(() => {
    return this.profileState.relayList() || [];
  });

  // Check if we're still loading cached events (relay list is loaded as part of cached events)
  isLoadingRelays = computed(() => {
    return !this.profileState.cachedEventsLoaded();
  });

  // Check if the current user is blocked
  isUserBlocked = computed(() => {
    const pubkey = this.pubkey();
    if (!pubkey || this.isOwnProfile()) return false;
    return this.reportingService.isUserBlocked(pubkey);
  });

  // Signal to track if the profile being viewed has muted the current user
  hasMutedMe = signal<boolean>(false);

  // Signal to track if we're loading the mute list
  isLoadingMuteStatus = signal<boolean>(false);

  // Signal to track the premium status
  premiumTier = signal<string | null>(null);

  // Signal to track the username of the profile being viewed
  profileUsername = signal<string | null>(null);

  // Signal for trust rank
  trustRank = signal<number | undefined>(undefined);

  // Computed to check if trust is enabled
  trustEnabled = computed(() => this.trustService.isEnabled());

  // Computed to get available follow sets (sorted alphabetically)
  availableFollowSets = computed(() => {
    return [...this.followSetsService.followSets()].sort((a, b) => a.title.localeCompare(b.title));
  });

  // Computed to check if user has premium subscription
  isPremium = computed(() => {
    const tier = this.premiumTier();
    return tier === 'premium' || tier === 'premium_plus';
  });

  // Computed to check if user has premium plus subscription
  isPremiumPlus = computed(() => {
    const tier = this.premiumTier();
    return tier === 'premium_plus';
  });

  // Computed to check if the profile has a Lightning Address configured
  hasLightningAddress = computed(() => {
    const profileData = this.profile()?.data;
    if (!profileData) return false;
    return this.zapService.getLightningAddress(profileData) !== null;
  });

  // Computed to get the count of external identities (NIP-39 `i` tags)
  identityCount = computed(() => {
    const event = this.profile()?.event;
    if (!event?.tags) return 0;
    return event.tags.filter(tag => tag[0] === 'i' && tag[1]).length;
  });

  // Computed to get the primary lightning address
  lightningAddress = computed(() => {
    const profileData = this.profile()?.data;
    if (!profileData) return null;

    const lud16 = profileData.lud16;
    const lud06 = profileData.lud06;

    // lud16 takes priority over lud06
    if (lud16) {
      return lud16;
    }
    return lud06 || null;
  });

  constructor() {
    effect(() => {
      const currentPubkey = this.pubkey();
      if (currentPubkey) {
        this.npub.set(this.utilities.getNpubFromPubkey(currentPubkey));
      }
    });

    // Add effect to fetch premium status when pubkey changes
    effect(async () => {
      const currentPubkey = this.pubkey();
      if (currentPubkey) {
        await this.fetchPremiumStatus(currentPubkey);
      }
    });

    // Add effect to check if the profile being viewed has muted the current user
    // DEFERRED: This is non-critical information, load after cached events
    effect(async () => {
      const profilePubkey = this.pubkey();
      const myPubkey = this.accountState.pubkey();
      const cachedLoaded = this.profileState.cachedEventsLoaded();

      // Reset state when profile changes
      untracked(() => {
        this.hasMutedMe.set(false);
        this.isLoadingMuteStatus.set(false);
      });

      // Don't check for own profile or if no pubkeys available
      // Wait for cached events to load before making this query
      if (!profilePubkey || !myPubkey || profilePubkey === myPubkey || !cachedLoaded) {
        return;
      }

      // Add delay to avoid competing with more important queries
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify we're still on the same profile
      if (this.pubkey() !== profilePubkey) return;

      untracked(() => {
        this.isLoadingMuteStatus.set(true);
      });

      try {
        // Fetch the mute list (kind 10000) for the profile being viewed
        const muteListEvent = await this.userRelayService.getEventByPubkeyAndKind(profilePubkey, kinds.Mutelist);

        if (muteListEvent && muteListEvent.tags) {
          // Check if my pubkey is in their mute list (p tags)
          const mutedPubkeys = muteListEvent.tags
            .filter(tag => tag[0] === 'p')
            .map(tag => tag[1]);

          untracked(() => {
            this.hasMutedMe.set(mutedPubkeys.includes(myPubkey));
          });
        }
      } catch (error) {
        this.logger.debug('Error fetching mute list for profile:', error);
      } finally {
        untracked(() => {
          this.isLoadingMuteStatus.set(false);
        });
      }
    });

    // Add effect to verify identifier when profile changes
    effect(async () => {
      const currentProfile = this.profile();
      if (currentProfile?.data.nip05) {
        const result = await this.getVerifiedIdentifier();
        untracked(() => {
          this.verifiedIdentifier.set(result);
        });
      } else {
        untracked(() => {
          this.verifiedIdentifier.set({ value: '', valid: false, status: '' });
        });
      }
    });

    // Load badges when pubkey changes - DEFERRED: badges are lowest priority
    // Wait for cachedEventsLoaded signal to be true before loading badges
    effect(async () => {
      const currentPubkey = this.pubkey();
      const cachedLoaded = this.profileState.cachedEventsLoaded();

      if (currentPubkey && cachedLoaded) {
        // Clear badges first to prevent showing stale data from previous profile
        this.badgeService.clear();
        // Clear timed out badges and cancel any pending timeouts
        this.clearBadgeTimeouts();

        // Add a small delay to ensure timeline queries complete first
        // This prevents badge queries from competing with more important data
        await new Promise(resolve => setTimeout(resolve, 500));

        // Double-check we're still on the same profile after delay
        if (this.pubkey() === currentPubkey) {
          await this.badgeService.loadAcceptedBadges(currentPubkey);

          // Prefetch only the small set used in the header UI.
          // Avoid preloading every accepted badge definition here.
          this.badgeService.preloadBadgeDefinitionsInBackground(
            this.badgeService.acceptedBadges().slice(0, 3)
          ).catch(() => {
            // Best-effort only
          });
        }
      }
    });

    // Start timeout when badges start loading
    effect(() => {
      const loadingBadges = this.badgeService.loadingBadgeDefinitions();
      const badges = this.topBadges();

      for (const badge of badges) {
        const badgeKey = `${badge.pubkey}:${badge.slug}`;

        // If badge is loading and we haven't started a timeout yet
        if (loadingBadges.has(badgeKey) && !this.badgeTimeouts.has(badgeKey)) {
          const timeout = setTimeout(() => {
            // Mark badge as timed out after 3 seconds
            this.timedOutBadges.update(timedOut => {
              const newSet = new Set(timedOut);
              newSet.add(badgeKey);
              return newSet;
            });
            this.badgeTimeouts.delete(badgeKey);
          }, 3000);
          this.badgeTimeouts.set(badgeKey, timeout);
        }

        // If badge finished loading (no longer in loading set), clear the timeout
        if (!loadingBadges.has(badgeKey) && this.badgeTimeouts.has(badgeKey)) {
          clearTimeout(this.badgeTimeouts.get(badgeKey)!);
          this.badgeTimeouts.delete(badgeKey);
        }
      }
    });

    // Load trust metrics when pubkey changes and trust is enabled
    // DEFERRED: Trust metrics are supplementary info, load after main content
    effect(async () => {
      const currentPubkey = this.pubkey();
      const enabled = this.trustService.isEnabled();
      const cachedLoaded = this.profileState.cachedEventsLoaded();

      if (currentPubkey && enabled && cachedLoaded) {
        // Add delay to avoid competing with more important queries
        await new Promise(resolve => setTimeout(resolve, 400));

        // Verify we're still on the same profile
        if (this.pubkey() !== currentPubkey) return;

        const metrics = await this.trustService.fetchMetrics(currentPubkey);
        untracked(() => {
          this.trustRank.set(metrics?.rank);
        });
      } else {
        untracked(() => {
          this.trustRank.set(undefined);
        });
      }
    });

    // Reset favicon state whenever the verified identifier changes
    effect(() => {
      // Touch the signal so the effect depends on it
      this.verifiedIdentifier();
      // Reset favicon fallback states when profile changes
      this.faviconTriedPng.set(false);
      this.faviconFailed.set(false);
    });

    // Load mutual followers ("Followers you know") when profile's following list is available
    // DEFERRED: Wait for cached events to load before computing mutual followers
    effect(() => {
      const profilePubkey = this.pubkey();
      const myPubkey = this.accountState.pubkey();
      const theirFollowingList = this.profileState.followingList();
      const cachedLoaded = this.profileState.cachedEventsLoaded();

      // Reset when profile changes
      untracked(() => {
        this.mutualFollowing.set([]);
        this.mutualFollowingProfiles.set([]);
      });

      // Don't compute for own profile, when not logged in, or before data is ready
      if (!profilePubkey || !myPubkey || profilePubkey === myPubkey || !cachedLoaded) {
        return;
      }

      if (theirFollowingList.length === 0) {
        return;
      }

      untracked(() => {
        this.computeMutualFollowing(theirFollowingList);
      });
    });

    // Load favorites from localStorage
    // No need to load favorites here as the service handles it automatically
  }

  /**
   * Compute mutual followers: people the current user follows who also follow the viewed profile.
   * Uses the profile's following list (already loaded via profileState) to find overlap with
   * the current user's following list.
   */
  private async computeMutualFollowing(theirFollowingList: string[]): Promise<void> {
    try {
      const myFollowing = this.accountState.followingList();
      if (myFollowing.length === 0) {
        return;
      }

      const theirFollowingSet = new Set(theirFollowingList);
      const mutual = myFollowing.filter(p => theirFollowingSet.has(p));
      this.mutualFollowing.set(mutual);

      // Load profile data for the first 3 mutual followers for avatar display
      if (mutual.length > 0) {
        const profilesToLoad = mutual.slice(0, 3);
        const profiles = await Promise.all(
          profilesToLoad.map(async pubkey => {
            try {
              const profile = await this.dataService.getProfile(pubkey);
              return {
                pubkey,
                picture: profile?.data?.picture,
                displayName: profile?.data?.display_name || profile?.data?.name || undefined,
              } as MutualFollowProfile;
            } catch {
              return { pubkey } as MutualFollowProfile;
            }
          })
        );
        this.mutualFollowingProfiles.set(profiles);
      }
    } catch (error) {
      this.logger.debug('Error computing mutual following:', error);
    }
  }

  getOptimizedImageUrl(url: string): string {
    if (!this.settingsService.settings().imageCacheEnabled) {
      return stripImageProxy(url);
    }
    return this.imageCacheService.getOptimizedImageUrl(url);
  }

  /**
   * Strip third-party image proxy wrappers from a URL.
   * Used for images loaded directly (not through our image proxy).
   */
  cleanImageUrl(url: string): string {
    return stripImageProxy(url);
  }

  onMutualAvatarError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
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
        const { ConfirmDialogComponent } = await import('../../../components/confirm-dialog/confirm-dialog.component');

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

    const displayName = this.profile()?.data.display_name || this.profile()?.data.name || '';

    const reportTarget: ReportTarget = {
      type: 'user',
      pubkey: pubkey,
    };

    this.layout.showReportDialog(reportTarget, displayName);
  }

  /**
   * Follows the user
   */
  async followUser() {
    this.logger.debug('Follow requested for:', this.pubkey());
    await this.accountState.follow(this.pubkey());
  }

  async unfollowUser() {
    this.logger.debug('Unfollow requested for:', this.pubkey());
    await this.accountState.unfollow(this.pubkey());
  }

  /**
   * Opens the zap dialog for the user
   */
  zapUser(): void {
    const pubkey = this.pubkey();
    const profileData = this.profile()?.data;

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
      recipientName: this.name(),
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
    const profileData = this.profile()?.event?.content
      ? JSON.parse(this.profile()!.event!.content)
      : null;

    this.layout.openGiftPremiumDialog(
      pubkey,
      this.name(),
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

  copyProfileData(): void {
    this.layout.copyToClipboard(this.profile()?.event.content, 'profile data');
  }

  copyFollowingList(): void {
    const followingList = this.profileState.followingList();
    if (!followingList || followingList.length === 0) {
      this.snackBar.open('No following list available', 'Close', { duration: 2000 });
      return;
    }

    // Copy the following list as formatted JSON
    const followingData = JSON.stringify(followingList, null, 2);
    this.layout.copyToClipboard(followingData, 'following list');
  }

  copyRelayList(): void {
    // Placeholder for actual implementation that would fetch the relay list
    this.logger.debug('Copy relay list requested for:', this.pubkey());
    this.layout.copyToClipboard('Relay list not implemented yet', 'relay list');
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
      const inviteUrl = `${window.location.origin}/invite/${nprofile}`;

      // Use Web Share API if available
      if (navigator.share) {
        navigator
          .share({
            title: `Join me on Nostria!`,
            text: `${this.name()} invited you to join Nostria - Your Social Network, Your Control`,
            url: inviteUrl,
          })
          .then(() => {
            this.logger.debug('Invite link shared successfully');
          })
          .catch(err => {
            this.logger.error('Error sharing invite link:', err);
            // Fallback to copying
            this.copyInviteLink();
          });
      } else {
        // Fallback to copying
        this.copyInviteLink();
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
   * Copy invite link to clipboard
   */
  copyInviteLink(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open('You must be logged in to generate an invite link', 'Dismiss', {
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
      const inviteUrl = `${window.location.origin}/invite/${nprofile}`;

      navigator.clipboard.writeText(inviteUrl).then(
        () => {
          this.snackBar.open('Invite link copied to clipboard!', 'Dismiss', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });
        },
        err => {
          this.logger.error('Failed to copy invite link:', err);
          this.snackBar.open('Failed to copy invite link', 'Dismiss', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });
        }
      );
    } catch (err) {
      this.logger.error('Failed to generate invite link', err);
      this.snackBar.open('Failed to generate invite link', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
  }

  getDefaultBanner(): string {
    // Return a default gradient for users without a banner
    return 'linear-gradient(135deg, #8e44ad, #3498db)';
  }

  // Helper to get favicon URL - uses Google API when enabled, direct server request otherwise
  getFaviconUrl(domain: string, usePng = false): string {
    if (!domain) return '';
    // Remove port if present and normalize
    const host = domain.split(':')[0].toLowerCase();

    // Use Google's favicon service when enabled (better reliability, but privacy tradeoff)
    if (this.settingsService.settings().googleFaviconEnabled) {
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
    }

    // Direct server request (better privacy, but may fail for some sites)
    const extension = usePng ? 'png' : 'ico';
    return `https://${host}/favicon.${extension}`;
  }

  /**
   * Get website URL with protocol prefix
   */
  getWebsiteUrl(website: string): string {
    if (!website) {
      return '';
    }

    // Check if the website already has a protocol prefix
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(website)) {
      return website;
    }

    // If no protocol prefix, add https:// as default
    return `https://${website}`;
  }

  /**
   * Verify the NIP-05 identifier for the profile
   */
  private async getVerifiedIdentifier(): Promise<{
    value: string;
    valid: boolean;
    status: string;
  }> {
    const metadata = this.profile();
    if (!metadata || !metadata.data.nip05) {
      return { value: '', valid: false, status: '' };
    }

    const nip05 = metadata.data.nip05;
    if (!nip05 || typeof nip05 !== 'string') {
      return { value: '', valid: false, status: '' };
    }

    const value = this.utilities.parseNip05(nip05);
    if (!value) return { value: '', valid: false, status: '' };

    if (isNip05(nip05)) {
      try {
        const profile = await queryProfile(nip05);

        if (profile) {
          if (profile.pubkey === metadata.event.pubkey) {
            return { value, valid: true, status: 'Verified valid' };
          } else {
            this.logger.warn(
              'NIP-05 profile pubkey mismatch:',
              profile.pubkey,
              metadata.event.pubkey
            );
            return { value, valid: false, status: 'Pubkey mismatch' };
          }
        } else {
          return { value, valid: false, status: 'Profile not found' };
        }
      } catch (error) {
        this.logger.warn('Error verifying NIP-05:', nip05, error);
        return { value, valid: false, status: 'Verification failed' };
      }
    } else {
      return { value, valid: false, status: 'Invalid NIP-05 format' };
    }
  }

  // Add methods for QR code visibility
  showQrCodeHandler(): void {
    this.showQrCode.set(true);
  }

  hideQrCodeHandler(): void {
    this.showQrCode.set(false);
  }

  toggleQrCodeHandler(): void {
    this.showQrCode.set(!this.showQrCode());
  }

  showProfileQrCodeHandler(): void {
    this.showProfileQrCode.set(true);
  }

  hideProfileQrCodeHandler(): void {
    this.showProfileQrCode.set(false);
  }

  toggleProfileQrCodeHandler(): void {
    this.showProfileQrCode.set(!this.showProfileQrCode());
  }

  copyNpubToClipboard(): void {
    const npubValue = this.npub();
    if (npubValue) {
      this.layout.copyToClipboard(npubValue, 'npub');
    }
  }

  copyLightningAddressToClipboard(): void {
    const profile = this.profile();
    const lud16 = profile?.data.lud16;
    const lud06 = profile?.data.lud06;
    // Get lightning address (lud16 takes priority)
    const lightningAddress = lud16 || lud06;
    if (lightningAddress) {
      this.layout.copyToClipboard(lightningAddress, 'lightning address');
    }
  }

  copyNip05ToClipboard(): void {
    const nip05Value = this.verifiedIdentifier().value;
    if (nip05Value) {
      this.layout.copyToClipboard(nip05Value, 'NIP-05');
    }
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
        this.snackBar.open('Removed from favorites', 'Close', {
          duration: 2000,
        });
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
        this.layout.toast('Removed from list');
      } else {
        // Add to set
        await this.followSetsService.addToFollowSet(dTag, pubkey);
        this.layout.toast('Added to list');
      }
    } catch {
      this.layout.toast('Failed to update list');
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
        this.layout.toast(`Created ${privacyLabel} "${result.title}" and added user`);
      } else {
        this.layout.toast('Failed to create list');
      }
    } catch {
      this.layout.toast('Failed to create list');
    }
  }

  async publishProfileEvent(): Promise<void> {
    const currentProfile = this.profile();
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
   * Toggles the bio expansion state
   */
  toggleBioExpansion(): void {
    this.isBioExpanded.update(expanded => !expanded);
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
   * Gets badge definition for display
   */
  getBadgeDefinition(badge: { aTag: string[]; pubkey: string; slug: string }) {
    return this.badgeService.getBadgeDefinition(badge.pubkey, badge.slug);
  }

  /**
   * Parses badge definition for display data
   */
  parseBadgeDefinition(badgeEvent: NostrEvent | undefined) {
    if (!badgeEvent) return null;
    return this.badgeService.parseDefinition(badgeEvent);
  }

  /**
     * Navigates to the badges page
     */
  viewAllBadges(): void {
    this.layout.openBadgesPage(this.npub() || this.pubkey());
  }

  // Badge hover card
  private badgeHoverElement?: HTMLElement;

  /**
   * Hides badge image when it fails to load
   */
  onBadgeImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    // Hide the image element
    img.style.display = 'none';
  }

  /**
   * Handle favicon load error - try .png fallback first, then hide if that fails too
   */
  onFaviconError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img) return;

    // If we haven't tried .png yet and Google favicon is not enabled, try it
    if (!this.faviconTriedPng() && !this.settingsService.settings().googleFaviconEnabled) {
      // Mark that we're trying .png
      this.faviconTriedPng.set(true);

      // Get domain from verified identifier
      const value = this.verifiedIdentifier().value;
      if (value) {
        const domain = value.includes('@') ? value.split('@')[1] : value;
        if (domain) {
          const clean = domain.replace(/^https?:\/\//, '').replace(/\/.*/, '');
          img.src = this.getFaviconUrl(clean, true);
          return; // Don't hide yet, let it try to load .png
        }
      }
    }

    // Both .ico and .png failed (or Google API failed) - hide this favicon
    this.faviconFailed.set(true);
    img.style.display = 'none';
  }

  /**
   * Shows badge hover card on mouse enter
   */
  onBadgeMouseEnter(event: Event, badge: { pubkey: string; slug: string }): void {
    const element = event.currentTarget as HTMLElement;
    this.badgeHoverElement = element;
    this.badgeHoverCardService.showHoverCard(element, badge.pubkey, badge.slug);
  }

  /**
   * Navigate to badges page in right panel
   */
  navigateToBadges(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const currentPubkey = this.pubkey();

    if (currentPubkey) {
      // Use the user-badges route which is specifically for viewing a user's badges
      this.layout.openBadgesPage(currentPubkey);
    }
  }

  /**
   * Navigate to following page in right panel
   */
  navigateToFollowing(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const currentPubkey = this.pubkey();

    if (currentPubkey) {
      this.layout.openFollowingPage(currentPubkey);
    }
  }

  /**
   * Navigate to relays page in right panel
   */
  navigateToRelays(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const currentPubkey = this.pubkey();

    if (currentPubkey) {
      this.layout.openRelaysPage(currentPubkey);
    }
  }

  /**
   * Navigate to links page in right panel
   */
  navigateToLinks(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const currentPubkey = this.pubkey();

    if (currentPubkey) {
      this.layout.openLinksPage(currentPubkey);
    }
  }

  /**
   * Clears all badge loading timeouts and resets timed out badges
   */
  private clearBadgeTimeouts(): void {
    for (const timeout of this.badgeTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.badgeTimeouts.clear();
    this.timedOutBadges.set(new Set());
  }

  /**
   * Hides badge hover card on mouse leave
   */
  onBadgeMouseLeave(): void {
    this.badgeHoverElement = undefined;
    this.badgeHoverCardService.hideHoverCard();
  }

  ngOnDestroy(): void {
    this.clearBadgeTimeouts();
  }
}
