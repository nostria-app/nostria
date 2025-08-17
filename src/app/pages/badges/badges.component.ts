import { Component, effect, inject, signal } from '@angular/core';
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
import { StorageService } from '../../services/storage.service';
import { BadgeService } from '../../services/badge.service';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { UnsignedEvent } from 'nostr-tools/pure';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { RelayService } from '../../services/relays/relay';
import { CommonModule } from '@angular/common';

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
    CommonModule,
  ],
  templateUrl: './badges.component.html',
  styleUrl: './badges.component.scss',
})
export class BadgesComponent {
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly app = inject(ApplicationService);
  private readonly relay = inject(RelayService);
  private readonly nostr = inject(NostrService);
  private readonly storage = inject(StorageService);
  private readonly badgeService = inject(BadgeService);
  private readonly layout = inject(LayoutService);
  readonly utilities = inject(UtilitiesService);
  private readonly accountState = inject(AccountStateService);

  isUpdating = signal<boolean>(false);
  isInitialLoading = signal<boolean>(true);
  activeTabIndex = signal<number>(0);

  constructor() {
    // Get the active tab from query params if available
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    if (tabParam) {
      this.activeTabIndex.set(parseInt(tabParam, 10));
    }

    effect(async () => {
      const appInitialized = this.app.initialized();
      const appAuthenticated = this.app.authenticated();

      if (appInitialized && appAuthenticated) {
        console.log('appInitialized && appAuthenticated');
        this.isInitialLoading.set(true);

        try {
          await this.badgeService.loadAllBadges(this.accountState.pubkey());
        } catch (err) {
          console.error('Error loading badges:', err);
        } finally {
          this.isInitialLoading.set(false);
        }
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
      const existingIndex = tags.findIndex(
        tag => tag[0] === 'a' && tag[1] === aTag
      );
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
      await this.relay.publish(signedEvent);
      await this.storage.saveEvent(signedEvent);

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
}
