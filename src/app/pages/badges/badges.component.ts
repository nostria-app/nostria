import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { Router, ActivatedRoute } from '@angular/router';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApplicationService } from '../../services/application.service';
import { RelayService } from '../../services/relay.service';
import { NostrService } from '../../services/nostr.service';
import { kinds, NostrEvent } from 'nostr-tools';
import { BadgeComponent } from './badge/badge.component';
import { StorageService } from '../../services/storage.service';
import { DataService } from '../../services/data.service';
import { BadgeService } from '../../services/badge.service';

// interface Badge {
//   id: string;
//   name: string;
//   description: string;
//   image: string;
//   thumbnail?: string;
//   kind?: number;
//   slug: string;
//   tags?: string[];
//   creator: string;
//   created: number; // Unix timestamp
// }

@Component({
  selector: 'app-badges',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatDialogModule,
    MatTooltipModule,
    BadgeComponent
  ],
  templateUrl: './badges.component.html',
  styleUrl: './badges.component.scss'
})
export class BadgesComponent {
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly app = inject(ApplicationService);
  private readonly relay = inject(RelayService);
  private readonly nostr = inject(NostrService);
  private readonly storage = inject(StorageService);
  private readonly data = inject(DataService);
  private readonly badgeService = inject(BadgeService);

  profileBadgesEvent = signal<any>(null);
  accepted = signal<{ aTag: string[], eTag: string[] }[]>([]);
  issued = signal<any[] | null>([]);
  definitions = signal<any[] | null>([]);
  received = signal<any[] | null>([]);

  // Active tab index
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
        try {
          const profileBadgesEvent = await this.relay.getEventByPubkeyAndKind(this.nostr.pubkey(), kinds.ProfileBadges);
          console.log('Profile Badges Event:', profileBadgesEvent);
          

          if (profileBadgesEvent && profileBadgesEvent.tags) {
            this.parseBadgeTags(profileBadgesEvent.tags);

            await this.storage.saveEvent(profileBadgesEvent);
          }

          const badgeAwardEvents = await this.relay.getEventsByPubkeyAndKind(this.nostr.pubkey(), kinds.BadgeAward);
          console.log('badgeAwardsEvent:', badgeAwardEvents);

          for (const event of badgeAwardEvents) {
            await this.storage.saveEvent(event);
          }

          const badgeDefinitionEvents = await this.relay.getEventsByPubkeyAndKind(this.nostr.pubkey(), kinds.BadgeDefinition);
          console.log('badgeAwardsEvent:', badgeDefinitionEvents);
          this.definitions.set(badgeDefinitionEvents);

          for (const event of badgeDefinitionEvents) {
            await this.storage.saveEvent(event);
            await this.badgeService.putBadgeDefinition(event);
          }

          const receivedAwardsEvents = await this.relay.getEventsByKindAndPubKeyTag(this.nostr.pubkey(), kinds.BadgeAward);
          console.log('receivedAwardsEvents:', receivedAwardsEvents);

          // Make sure we set these after we've loaded the definitions.
          this.profileBadgesEvent.set(profileBadgesEvent);
          this.issued.set(badgeAwardEvents);
          this.received.set(receivedAwardsEvents);

        } catch (err) {
          console.error('Error fetching profile badges:', err);
        }
      }
    });
  }

  private parseBadgeTags(tags: string[][]): void {
    // Find the 'a' tags
    const aTags = tags.filter(tag => tag[0] === 'a');
    // Find the 'e' tags
    const eTags = tags.filter(tag => tag[0] === 'e');

    // Match them together based on their position
    // Assuming 'a' and 'e' tags are in the same order
    const pairs = aTags.map((aTag, index) => {
      // If there's a corresponding eTag at the same index, pair them
      const eTag = index < eTags.length ? eTags[index] : null;
      return {
        aTag,
        eTag: eTag || []
      };
    });

    console.log('Parsed badge pairs:', pairs);
    this.accepted.set(pairs);
  }

  openBadgeEditor(): void {
    this.router.navigate(['/badges/create']);
  }

  viewBadgeDetails(badge: NostrEvent): void {
    console.log('Viewing badge details:', badge);

    if (badge.kind)


    // Include the active tab index as a query parameter
    this.router.navigate(['/badges/details', badge.id], {
      queryParams: { tab: this.activeTabIndex() }
    });
  }

  // Track tab changes and update URL
  onTabChange(index: number): void {
    this.activeTabIndex.set(index);

    // Update the URL with the new tab index without navigating
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: index },
      queryParamsHandling: 'merge', // keep any existing query params
      replaceUrl: false // add to browser history stack
    });
  }
}
