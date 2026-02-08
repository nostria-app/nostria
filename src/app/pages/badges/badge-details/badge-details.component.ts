import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BadgeService } from '../../../services/badge.service';
import { Event } from 'nostr-tools';
import { AccountStateService } from '../../../services/account-state.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { UtilitiesService } from '../../../services/utilities.service';
import { LayoutService } from '../../../services/layout.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { LoggerService } from '../../../services/logger.service';

interface BadgeDisplayData {
  id: string;
  name: string;
  description: string;
  image: string;
  thumbnail?: string;
  slug: string;
  tags?: string[];
  creator: string;
  created: number;
  event?: Event;
}

@Component({
  selector: 'app-badge-details',
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule,
    MatDialogModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    UserProfileComponent,
  ],
  templateUrl: './badge-details.component.html',
  styleUrl: './badge-details.component.scss',
})
export class BadgeDetailsComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private readonly badgeService = inject(BadgeService);
  private readonly accountState = inject(AccountStateService);
  private readonly utilities = inject(UtilitiesService);
  private readonly layout = inject(LayoutService);
  private readonly panelNav = inject(PanelNavigationService);
  private readonly logger = inject(LoggerService);

  badge = signal<BadgeDisplayData | null>(null);
  isCreator = signal(false);
  loading = signal(true);
  error = signal<string | null>(null);

  // For badge rewarding
  issuingBadge = signal(false);
  recipientPubkeys = new FormControl('');

  // Store the tab index from the query parameter
  returnTabIndex = signal<number | null>(null);

  constructor() {
    // Get the tab index from query parameters
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    if (tabParam) {
      this.returnTabIndex.set(parseInt(tabParam, 10));
    }

    effect(() => {
      const id = this.route.snapshot.paramMap.get('id');

      if (!id) {
        this.error.set('No badge ID provided');
        this.loading.set(false);
        return;
      }

      // Parse the id format: "kind:pubkey:slug"
      const parts = id.split(':');
      if (parts.length < 3) {
        this.error.set('Invalid badge ID format. Expected: kind:pubkey:slug');
        this.loading.set(false);
        return;
      }

      const [, pubkey, slug] = parts;
      this.fetchBadge(pubkey, slug);
    });
  }

  private async fetchBadge(pubkey: string, slug: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      // Check if we have the badge definition in memory first
      let badgeDefinition = this.badgeService.getBadgeDefinition(pubkey, slug);

      // If not found in memory, try to load it
      if (!badgeDefinition) {
        await this.badgeService.loadBadgeDefinitions(pubkey);
        badgeDefinition = this.badgeService.getBadgeDefinition(pubkey, slug);
      }

      if (!badgeDefinition) {
        this.error.set('Badge definition not found');
        this.loading.set(false);
        return;
      }

      // Extract badge information from the definition event
      const badgeInfo = this.extractBadgeInfo(badgeDefinition);

      // Check if current user is the creator
      this.isCreator.set(badgeDefinition.pubkey === this.accountState.pubkey());

      this.badge.set(badgeInfo);
    } catch (err) {
      this.logger.error('Error fetching badge:', err);
      this.error.set('Failed to load badge details');
    } finally {
      this.loading.set(false);
    }
  }

  private extractBadgeInfo(badgeEvent: Event): BadgeDisplayData {
    const tags = badgeEvent.tags || [];

    // Extract information from tags
    const nameTag = tags.find(tag => tag[0] === 'name');
    const descTag = tags.find(tag => tag[0] === 'description');
    const imageTag = tags.find(tag => tag[0] === 'image');
    const thumbTag = tags.find(tag => tag[0] === 'thumb');
    const slugTag = tags.find(tag => tag[0] === 'd');

    // Extract additional tags for display (excluding system tags)
    const systemTags = ['name', 'description', 'image', 'thumb', 'd'];
    const displayTags = tags
      .filter(tag => !systemTags.includes(tag[0]) && tag[1])
      .map(tag => tag[1]);

    return {
      id: badgeEvent.id,
      name: nameTag?.[1] || 'Unnamed Badge',
      description: descTag?.[1] || 'No description available',
      image: imageTag?.[1] || '',
      thumbnail: thumbTag?.[1] || imageTag?.[1] || '',
      slug: slugTag?.[1] || '',
      tags: displayTags.length > 0 ? displayTags : undefined,
      creator: badgeEvent.pubkey,
      created: badgeEvent.created_at * 1000, // Convert to milliseconds
      event: badgeEvent,
    };
  }

  editBadge(): void {
    if (this.badge()) {
      const badge = this.badge()!;
      // Construct the badge id in the format: kind:pubkey:slug
      const badgeId = `30009:${badge.creator}:${badge.slug}`;
      // Pass the tab index so we return to the correct tab
      const tabIndex = this.returnTabIndex();
      this.layout.openBadgeEditor(badgeId, tabIndex !== null ? tabIndex : undefined);
    }
  }

  toggleIssueBadge(): void {
    this.issuingBadge.update(value => !value);
  }

  async publishBadgeReward(): Promise<void> {
    const recipients = this.recipientPubkeys.value;
    if (!recipients || !recipients.trim()) {
      this.snackBar.open('Please enter at least one recipient', 'Close', {
        duration: 3000,
      });
      return;
    }

    const badge = this.badge();
    if (!badge) {
      this.snackBar.open('Badge information not available', 'Close', {
        duration: 3000,
      });
      return;
    }

    try {
      // Parse recipient pubkeys
      const pubkeys = recipients
        .split(/[\s,\n]+/)
        .map(key => key.trim())
        .filter(key => key !== '');

      if (pubkeys.length === 0) {
        this.snackBar.open('No valid recipients found', 'Close', {
          duration: 3000,
        });
        return;
      }

      // TODO: Implement actual badge award publishing through NostrService

      this.snackBar.open(`Badge awarded to ${pubkeys.length} recipients`, 'Close', {
        duration: 3000,
      });

      // Reset form
      this.recipientPubkeys.reset();
      this.issuingBadge.set(false);
    } catch (err) {
      this.logger.error('Error publishing badge reward:', err);
      this.snackBar.open('Failed to publish badge reward', 'Close', {
        duration: 3000,
      });
    }
  }

goBack(): void {
    // Use panel navigation to go back in the right panel history
    // This will return to whatever badges page the user came from
    this.panelNav.goBackRight();
  }
}
