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
import { kinds } from 'nostr-tools';
import { BadgeComponent } from './badge/badge.component';

interface Badge {
  id: string;
  name: string;
  description: string;
  image: string;
  thumbnail?: string;
  slug: string;
  tags?: string[];
  creator: string;
  created: number; // Unix timestamp
}

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

  // Badge lists for each category
  acceptedBadges = signal<Badge[]>([]);
  awardedBadges = signal<Badge[]>([]);
  createdBadges = signal<Badge[]>([]);

  profileBagesEvent = signal<any>(null);
  badgePairs = signal<{ aTag: string[], eTag: string[] }[]>([]);

  issuedAwardsEvent = signal<any[] | null>([]);
  badgeDefinitionsEvent = signal<any[] | null>([]);

  // Active tab index
  activeTabIndex = signal<number>(0);

  constructor() {
    // Populate with mock data for now
    this.loadMockData();

    console.log('Badges component initialized.');

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
          this.profileBagesEvent.set(profileBadgesEvent);

          if (profileBadgesEvent && profileBadgesEvent.tags) {
            this.parseBadgeTags(profileBadgesEvent.tags);
          }

          const badgeAwardsEvent = await this.relay.getEventsByPubkeyAndKind(this.nostr.pubkey(), kinds.BadgeAward);
          console.log('badgeAwardsEvent:', badgeAwardsEvent);
          this.issuedAwardsEvent.set(badgeAwardsEvent);

          const badgeDefinitionsEvent = await this.relay.getEventsByPubkeyAndKind(this.nostr.pubkey(), kinds.BadgeDefinition);
          console.log('badgeAwardsEvent:', badgeDefinitionsEvent);
          this.badgeDefinitionsEvent.set(badgeDefinitionsEvent);

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
    this.badgePairs.set(pairs);
  }

  openBadgeEditor(): void {
    this.router.navigate(['/badges/create']);
  }

  viewBadgeDetails(badge: Badge): void {
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

  private loadMockData(): void {
    const mockBadges: Badge[] = [
      {
        id: '1',
        name: 'Early Adopter',
        description: 'Awarded to early users of the platform',
        image: 'https://placehold.co/1024x1024',
        slug: 'early-adopter',
        tags: ['early', 'adopter'],
        creator: 'npub1xxxxxxxxxx',
        created: Date.now() - 1000000
      },
      {
        id: '2',
        name: 'Content Creator',
        description: 'For exceptional content creation',
        image: 'https://placehold.co/1024x1024',
        slug: 'content-creator',
        tags: ['content', 'creator'],
        creator: 'npub1xxxxxxxxxx',
        created: Date.now() - 2000000
      },
      {
        id: '3',
        name: 'Verified Developer',
        description: 'Awarded to verified developers',
        image: 'https://placehold.co/1024x1024',
        slug: 'verified-developer',
        tags: ['developer', 'verified'],
        creator: 'npub1xxxxxxxxxx',
        created: Date.now() - 3000000
      }
    ];

    this.acceptedBadges.set(mockBadges);
    this.awardedBadges.set(mockBadges.slice(0, 2));
    this.createdBadges.set([mockBadges[2]]);
  }
}
