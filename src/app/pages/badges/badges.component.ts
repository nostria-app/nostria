import { Component, effect, inject, signal, untracked, computed } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { Router, ActivatedRoute } from '@angular/router';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApplicationService } from '../../services/application.service';
import { NostrService } from '../../services/nostr.service';
import { kinds, NostrEvent } from 'nostr-tools';
import { BadgeComponent } from './badge/badge.component';
import { DatabaseService } from '../../services/database.service';
import { BadgeService, AcceptedBadge } from '../../services/badge.service';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { UnsignedEvent } from 'nostr-tools/pure';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';

import { AccountRelayService } from '../../services/relays/account-relay';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';

@Component({
  selector: 'app-badges',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatDialogModule,
    MatTooltipModule,
    BadgeComponent,
    MatListModule,
    MatProgressSpinnerModule,
    DragDropModule
  ],
  templateUrl: './badges.component.html',
  styleUrl: './badges.component.scss',
})
export class BadgesComponent {
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly app = inject(ApplicationService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly nostr = inject(NostrService);
  private readonly database = inject(DatabaseService);
  private readonly badgeService = inject(BadgeService);
  private readonly layout = inject(LayoutService);
  private readonly dataService = inject(DataService);
  readonly utilities = inject(UtilitiesService);
  private readonly accountState = inject(AccountStateService);

  isUpdating = signal<boolean>(false);
  isInitialLoading = signal<boolean>(true);
  activeTabIndex = signal<number>(0);
  viewingPubkey = signal<string>(''); // Track which pubkey's badges we're viewing
  viewingProfile = signal<NostrRecord | undefined>(undefined); // Profile data for the viewing user

  // Computed signal to get badge definitions for the viewing user
  viewingUserDefinitions = computed(() => {
    const pubkey = this.viewingPubkey();
    return this.badgeService.badgeDefinitions().filter(badge => badge.pubkey === pubkey);
  });

  // Check if we're viewing our own profile
  isViewingOwnProfile = computed(() => {
    return this.viewingPubkey() === this.accountState.pubkey();
  });

  constructor() {
    // Get the active tab from query params if available
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    if (tabParam) {
      this.activeTabIndex.set(parseInt(tabParam, 10));
    }

    // Get pubkey from route params (new: /p/:id/badges) or query params (legacy: /badges?pubkey=xxx)
    let pubkeyParam = this.route.snapshot.queryParamMap.get('pubkey');
    if (!pubkeyParam) {
      // Check if we're under a profile route (parent :id param)
      const parentId = this.route.parent?.snapshot.paramMap.get('id');
      if (parentId) {
        // Convert npub to hex if needed
        pubkeyParam = this.utilities.safeGetHexPubkey(parentId) || parentId;
      }
    }

    effect(() => {
      const appInitialized = this.app.initialized();
      const appAuthenticated = this.app.authenticated();

      if (appInitialized && appAuthenticated) {
        console.log('appInitialized && appAuthenticated');

        // Run the loading logic untracked to prevent infinite loops
        untracked(async () => {
          // Set initial loading to false immediately after getting profile
          // to allow UI to render with loading states per tab
          try {
            // Use pubkey from route/query params if provided, otherwise use current user's pubkey
            const targetPubkey = pubkeyParam || this.accountState.pubkey();
            this.viewingPubkey.set(targetPubkey);

            // Load profile data for the viewing user
            const profile = await this.dataService.getProfile(targetPubkey);
            this.viewingProfile.set(profile);

            // Stop showing initial loading - let individual tabs show their loading states
            this.isInitialLoading.set(false);

            // Load badges in the background (non-blocking for UI)
            await this.badgeService.loadAllBadges(targetPubkey);
          } catch (err) {
            console.error('Error loading badges:', err);
            this.isInitialLoading.set(false);
          }
        });
      }
    });
  }

  // Computed getters for accessing badge service data
  get accepted() {
    return this.badgeService.acceptedBadges;
  }
  get received() {
    return this.badgeService.receivedBadges;
  }
  get issued() {
    return this.badgeService.issuedBadges;
  }
  get definitions() {
    return this.badgeService.badgeDefinitions;
  }
  get createdDefinitions() {
    return this.badgeService.createdDefinitions;
  }
  get badgeIssuers() {
    return this.badgeService.badgeIssuers;
  }
  get badgeRecipients() {
    return this.badgeService.badgeRecipients;
  }
  get profileBadgesEvent() {
    return this.badgeService.profileBadgesEvent;
  }

  // Loading state getters
  get isLoadingAccepted() {
    return this.badgeService.isLoadingAccepted;
  }
  get isLoadingReceived() {
    return this.badgeService.isLoadingReceived;
  }
  get isLoadingIssued() {
    return this.badgeService.isLoadingIssued;
  }
  get isLoadingDefinitions() {
    return this.badgeService.isLoadingDefinitions;
  }

  getProfileIdentifier(): string {
    const profile = this.viewingProfile();
    if (!profile) return '';

    // Prefer NIP-05 if available and valid
    const nip05 = profile.data?.nip05;
    if (nip05 && profile.data?.nip05valid) {
      return nip05;
    }

    // Fall back to truncated npub
    const pubkey = this.viewingPubkey();
    if (pubkey) {
      return this.utilities.getTruncatedNpub(pubkey);
    }

    return '';
  }

  goBack(): void {
    const pubkey = this.viewingPubkey();
    if (pubkey) {
      const npub = this.utilities.getNpubFromPubkey(pubkey);
      this.router.navigate([{ outlets: { right: ['p', npub || pubkey] } }]);
    } else {
      // Fallback to home if no pubkey
      this.router.navigate(['/']);
    }
  }

  openBadgeEditor(): void {
    this.router.navigate(['/badges/create']);
  }

  viewBadgeDetailsById(id: string, slug: string): void {
    console.log('Viewing badge details:', id, slug);
    this.layout.openBadge(id, undefined, {
      queryParams: { tab: this.activeTabIndex() },
    });
  }

  viewBadgeDetails(badge: NostrEvent): void {
    console.log('Viewing badge details:', badge);

    // For BadgeDefinition events (kind 30009), construct the id from pubkey and d-tag
    if (badge.kind === 30009) {
      const dTag = badge.tags.find(tag => tag[0] === 'd');
      if (dTag && dTag[1]) {
        const id = `${badge.kind}:${badge.pubkey}:${dTag[1]}`;
        this.layout.openBadge(id, badge, {
          queryParams: { tab: this.activeTabIndex() },
        });
        return;
      }
    }

    // For BadgeAward events, extract the a-tag reference
    const id = this.utilities.getATagValueFromEvent(badge);

    if (!id) {
      console.error('Badge has no a-tag reference');
      return;
    }

    this.layout.openBadge(id, badge, {
      queryParams: { tab: this.activeTabIndex() },
    });
  }

  onTabChange(index: number): void {
    this.activeTabIndex.set(index);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: index },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  }

  isBadgeAccepted(badgeAward: NostrEvent): boolean {
    return this.badgeService.isBadgeAccepted(badgeAward);
  }

  getBadgeATag(badgeAward: NostrEvent): string {
    return this.badgeService.getBadgeATag(badgeAward);
  }

  getBadgeDefinition(aTag: string): NostrEvent | undefined {
    return this.badgeService.getBadgeDefinitionByATag(aTag);
  }

  getRecipientPubkey(badgeAward: NostrEvent): string | null {
    const pTags = badgeAward.tags.filter(tag => tag[0] === 'p');
    return pTags.length > 0 && pTags[0][1] ? pTags[0][1] : null;
  }

  // getBadgeInfo(badgeAward: NostrEvent): { name: string, description: string, image: string, thumbnail: string } {
  //   return this.badgeService.getBadgeInfo(badgeAward);
  // }

  async acceptBadge(badgeAward: NostrEvent) {
    if (this.isUpdating()) return;

    try {
      this.isUpdating.set(true);

      const aTag = this.getBadgeATag(badgeAward);
      if (!aTag) {
        console.error('Badge has no a-tag reference');
        return;
      }

      // Get current profile badges event or create new one
      const currentEvent = this.profileBadgesEvent();
      let tags: string[][] = [];

      if (currentEvent) {
        tags = [...currentEvent.tags];
      } else {
        tags = [['d', 'profile_badges']];
      }

      // Ensure we're not adding duplicate
      const existingIndex = tags.findIndex(tag => tag[0] === 'a' && tag[1] === aTag);
      if (existingIndex !== -1) {
        return;
      }

      // Add the a-tag for the badge definition
      tags.push(['a', aTag]);
      // Add the e-tag for the badge award event
      tags.push(['e', badgeAward.id, '']);

      // Create the event
      const unsignedEvent: UnsignedEvent = {
        kind: kinds.ProfileBadges,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: '',
        pubkey: this.accountState.pubkey(),
      };

      // Sign and publish the event
      const signedEvent = await this.nostr.signEvent(unsignedEvent);
      await this.accountRelay.publish(signedEvent);
      await this.database.saveEvent(signedEvent);

      // Update the badge service state
      this.badgeService.profileBadgesEvent.set(signedEvent);

      // Reload accepted badges to update the UI
      await this.badgeService.loadAcceptedBadges(this.accountState.pubkey());
    } catch (err) {
      console.error('Error accepting badge:', err);
    } finally {
      this.isUpdating.set(false);
    }
  }

  async removeReceivedBadge(badgeEvent: NostrEvent) {
    // Extract badge information from the NostrEvent
    const aTags = badgeEvent.tags.filter(t => t[0] === 'a');
    if (aTags.length === 0) {
      console.error('Badge event has no a-tag');
      return;
    }

    const aTag = aTags[0];
    const aTagValue = aTag[1]; // e.g., "30009:pubkey:slug"
    const parts = aTagValue.split(':');
    const pubkey = parts[1];
    const slug = parts[2];

    // Convert to AcceptedBadge format
    const acceptedBadge: AcceptedBadge = {
      aTag: aTag,
      eTag: ['e', badgeEvent.id],
      id: aTagValue,
      pubkey: pubkey,
      slug: slug,
    };

    await this.removeBadge(acceptedBadge);
  }

  async removeBadge(badge: AcceptedBadge) {
    if (this.isUpdating()) return;

    console.log('Removing badge:', badge);

    try {
      this.isUpdating.set(true);

      // The aTag is an array, get the identifier from position 1
      const aTagValue = badge.aTag[1];
      if (!aTagValue) {
        console.error('Badge has no a-tag reference');
        return;
      }

      console.log('Looking for a-tag value:', aTagValue);

      // Get current profile badges event
      const currentEvent = this.profileBadgesEvent();
      if (!currentEvent) {
        console.error('No profile badges event found');
        return;
      }

      console.log('Current event tags:', currentEvent.tags);

      // Filter out the badge we want to remove (both a-tag and matching e-tag)
      const aTags = currentEvent.tags.filter(tag => tag[0] === 'a');
      const eTags = currentEvent.tags.filter(tag => tag[0] === 'e');

      // Find the index of the badge to remove
      const aTagIndex = aTags.findIndex(tag => tag[1] === aTagValue);
      if (aTagIndex === -1) {
        console.error('Badge not found in profile badges');
        return;
      }

      // Remove the corresponding a-tag and e-tag
      const newATags = aTags.filter((_, index) => index !== aTagIndex);
      const newETags = eTags.filter((_, index) => index !== aTagIndex);

      // Rebuild tags array with d-tag first, then remaining badges
      const tags: string[][] = [['d', 'profile_badges']];

      // Add remaining badges
      for (let i = 0; i < newATags.length; i++) {
        tags.push(newATags[i]);
        if (i < newETags.length) {
          tags.push(newETags[i]);
        }
      }

      // Create the updated event
      const unsignedEvent: UnsignedEvent = {
        kind: kinds.ProfileBadges,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: '',
        pubkey: this.accountState.pubkey(),
      };

      // Sign and publish the event
      const signedEvent = await this.nostr.signEvent(unsignedEvent);
      await this.accountRelay.publish(signedEvent);
      await this.database.saveEvent(signedEvent);

      // Update the badge service state
      this.badgeService.profileBadgesEvent.set(signedEvent);

      // Reload accepted badges to update the UI
      await this.badgeService.loadAcceptedBadges(this.accountState.pubkey());
    } catch (err) {
      console.error('Error removing badge:', err);
    } finally {
      this.isUpdating.set(false);
    }
  }

  /**
   * Handle drag-and-drop reordering of badges
   */
  async onBadgeDropped(event: CdkDragDrop<unknown>) {
    // If dropped in the same position, do nothing
    if (event.previousIndex === event.currentIndex) {
      console.log('Badge dropped in same position, no change needed');
      return;
    }

    console.log(`Moving badge from position ${event.previousIndex} to ${event.currentIndex}`);

    try {
      this.isUpdating.set(true);

      const currentAccepted = [...this.accepted()];
      console.log('Current badge order:', currentAccepted.map(b => b.slug));

      // Reorder the array based on drag-drop
      moveItemInArray(currentAccepted, event.previousIndex, event.currentIndex);
      console.log('New badge order:', currentAccepted.map(b => b.slug));

      // Get the current profile badges event
      const currentEvent = this.badgeService.profileBadgesEvent();
      if (!currentEvent) {
        console.error('No profile badges event found');
        return;
      }

      // Build new tags array with reordered badges
      const dTag = currentEvent.tags.find((t) => t[0] === 'd');
      const tags: string[][] = [];

      if (dTag) {
        tags.push([...dTag]);
      }

      // Add badges in new order
      // Note: badge.aTag is already an array like ['a', '30009:pubkey:slug']
      // We need to extract the value at index 1
      for (const badge of currentAccepted) {
        const aTagValue = Array.isArray(badge.aTag) ? badge.aTag[1] : badge.aTag;
        const eTagValue = Array.isArray(badge.eTag) ? badge.eTag[1] : badge.eTag;

        tags.push(['a', aTagValue]);
        if (eTagValue) {
          tags.push(['e', eTagValue]);
        }
      }

      console.log('New tags array:', tags);

      // Create and sign the new event
      const unsignedEvent: UnsignedEvent = {
        kind: 30008,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: '',
        pubkey: this.accountState.pubkey(),
      };

      const signedEvent = await this.nostr.signEvent(unsignedEvent);
      console.log('Signed reordered event:', signedEvent);

      await this.accountRelay.publish(signedEvent);
      await this.database.saveEvent(signedEvent);

      // Update badge service state
      this.badgeService.profileBadgesEvent.set(signedEvent);

      // Reload accepted badges
      await this.badgeService.loadAcceptedBadges(this.accountState.pubkey());

      console.log('Badge reordering complete');
    } catch (err) {
      console.error('Error reordering badges:', err);
    } finally {
      this.isUpdating.set(false);
    }
  }
}
