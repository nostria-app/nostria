import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { Router } from '@angular/router';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApplicationService } from '../../services/application.service';
import { RelayService } from '../../services/relay.service';
import { NostrService } from '../../services/nostr.service';
import { kinds } from 'nostr-tools';

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
    MatTooltipModule
  ],
  templateUrl: './badges.component.html',
  styleUrl: './badges.component.scss'
})
export class BadgesComponent {
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private readonly app = inject(ApplicationService);
  private readonly relay = inject(RelayService);
  private readonly nostr = inject(NostrService);

  // Badge lists for each category
  acceptedBadges = signal<Badge[]>([]);
  awardedBadges = signal<Badge[]>([]);
  createdBadges = signal<Badge[]>([]);

  constructor() {
    // Populate with mock data for now
    this.loadMockData();

    console.log('Badges component initialized.');

    effect(async () => {
      const appInitialized = this.app.initialized();
      const appAuthenticated = this.app.authenticated();

      debugger;

      if (appInitialized && appAuthenticated) {
        console.log('appInitialized && appAuthenticated');
        try {
          const profileBagesEvent = await this.relay.getEventByPubkeyAndKind(this.nostr.pubkey(), kinds.ProfileBadges);
          console.log('Profile Badges Event:', profileBagesEvent);
        } catch (err) {
          console.error('Error fetching profile badges:', err);
        }
      }
    });
  }

  openBadgeEditor(): void {
    this.router.navigate(['/badges/create']);
  }

  viewBadgeDetails(badge: Badge): void {
    this.router.navigate(['/badges/details', badge.id]);
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
