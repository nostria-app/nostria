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
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { UnsignedEvent } from 'nostr-tools/pure';
import { UtilitiesService } from '../../services/utilities.service';

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
    BadgeComponent,
    MatListModule,
    MatProgressSpinnerModule
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
  readonly utilities = inject(UtilitiesService);

  profileBadgesEvent = signal<any>(null);
  accepted = signal<{ aTag: string[], eTag: string[], id: string, pubkey: string, slug: string }[]>([]);
  issued = signal<any[] | null>([]);
  definitions = signal<any[] | null>([]);
  received = signal<any[] | null>([]);

  isUpdating = signal<boolean>(false);
  badgeIssuers = signal<{ [key: string]: any }>({});

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

          // Fetch metadata for badge issuers
          await this.fetchBadgeIssuers(receivedAwardsEvents);

          // Make sure we set these after we've loaded the definitions.
          if (profileBadgesEvent && profileBadgesEvent.tags) {
            this.parseBadgeTags(profileBadgesEvent.tags);

            await this.storage.saveEvent(profileBadgesEvent);
          }

          this.profileBadgesEvent.set(profileBadgesEvent);
          this.issued.set(badgeAwardEvents);
          this.received.set(receivedAwardsEvents);

        } catch (err) {
          console.error('Error fetching profile badges:', err);
        }
      }
    });
  }

  private async fetchBadgeIssuers(receivedBadges: NostrEvent[]) {
    const issuers: { [key: string]: any } = {};

    // Get unique issuer pubkeys
    const issuerPubkeys = [...new Set(receivedBadges.map(badge => badge.pubkey))];

    // Fetch metadata for each issuer
    for (const pubkey of issuerPubkeys) {
      try {
        const metadata = await this.nostr.getMetadataForUser(pubkey);

        if (metadata) {
          issuers[pubkey] = metadata.data;
        } else {
          issuers[pubkey] = { name: this.utilities.getTruncatedNpub(pubkey) };
        }
      } catch (err) {
        console.error(`Error fetching metadata for ${pubkey}:`, err);
        issuers[pubkey] = { name: this.utilities.getTruncatedNpub(pubkey) };
      }
    }

    this.badgeIssuers.set(issuers);
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

      const values = aTag[1].split(':')
      const kind = values[0];
      const pubkey = values[1];
      const slug = values[2];

      return {
        pubkey,
        slug,
        kind,
        id: aTag[1], // Assuming the first element is the ID
        eventId: eTag![0],
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

  viewBadgeDetailsById(id: string, slug: string): void {
    console.log('Viewing badge details:', id);

    // Include the active tab index as a query parameter
    this.router.navigate(['/badges/details', id], {
      queryParams: { tab: this.activeTabIndex() }
    });
  }

  viewBadgeDetails(badge: NostrEvent): void {
    console.log('Viewing badge details:', badge);

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

  isBadgeAccepted(badgeAward: NostrEvent): boolean {
    const badgeATag = this.getBadgeATag(badgeAward);
    return this.accepted().some(badge => badge.id === badgeATag);
  }

  getBadgeATag(badgeAward: NostrEvent): string {
    const aTag = badgeAward.tags.find(tag => tag[0] === 'a');
    return aTag ? aTag[1] : '';
  }

  getBadgeDefinition(aTag: string): NostrEvent | undefined {
    if (!aTag) return undefined;

    const parts = aTag.split(':');
    if (parts.length < 3) return undefined;

    const kind = parts[0];
    const pubkey = parts[1];
    const slug = parts[2];

    return this.badgeService.getBadgeDefinition(pubkey, slug);
  }

  getBadgeInfo(badgeAward: NostrEvent): { name: string, description: string, image: string, thumbnail: string } {
    const aTag = this.getBadgeATag(badgeAward);
    const badgeDefinition = this.getBadgeDefinition(aTag);

    if (!badgeDefinition) {
      return {
        name: 'Unknown Badge',
        description: 'Badge definition not found',
        image: '',
        thumbnail: ''
      };
    }

    const nameTag = badgeDefinition.tags.find(tag => tag[0] === 'name');
    const descTag = badgeDefinition.tags.find(tag => tag[0] === 'description');
    const imageTag = badgeDefinition.tags.find(tag => tag[0] === 'image');
    const thumbTag = badgeDefinition.tags.find(tag => tag[0] === 'thumb');

    return {
      name: nameTag ? nameTag[1] : 'Unnamed Badge',
      description: descTag ? descTag[1] : 'No description',
      image: imageTag ? imageTag[1] : '',
      thumbnail: thumbTag ? thumbTag[1] : (imageTag ? imageTag[1] : '')
    };
  }

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
      let currentEvent = this.profileBadgesEvent();
      let tags: string[][] = [];

      if (currentEvent) {
        // Copy existing tags
        tags = [...currentEvent.tags];
      } else {
        // Create with d tag for profile_badges
        tags = [['d', 'profile_badges']];
      }

      // Ensure we're not adding duplicate
      const existingIndex = tags.findIndex(tag => tag[0] === 'a' && tag[1] === aTag);
      if (existingIndex !== -1) {
        // Badge already accepted
        return;
      }

      // Add the a-tag for the badge definition
      tags.push(['a', aTag]);

      // Add the e-tag for the badge award event
      tags.push(['e', badgeAward.id, '']);  // third parameter can be relay URL if known

      // Create the event
      const unsignedEvent: UnsignedEvent = {
        kind: kinds.ProfileBadges,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: '',
        pubkey: this.nostr.pubkey()
      };

      // Sign and publish the event
      const signedEvent = await this.nostr.signEvent(unsignedEvent);

      await this.relay.publish(signedEvent);
      await this.storage.saveEvent(signedEvent);

      // Update the component state
      this.profileBadgesEvent.set(signedEvent);

      // Update the accepted badges
      if (signedEvent.tags) {
        this.parseBadgeTags(signedEvent.tags);
      }

    } catch (err) {
      console.error('Error accepting badge:', err);
    } finally {
      this.isUpdating.set(false);
    }
  }
}
