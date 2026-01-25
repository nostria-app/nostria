import { Component, inject, computed, signal, effect } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { RouterModule } from '@angular/router';
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { LayoutService } from '../../../services/layout.service';
import { BadgeService } from '../../../services/badge.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';

interface ParsedBadge {
  slug: string;
  name: string;
  description: string;
  image: string;
  thumb: string;
  pubkey: string;
}

@Component({
  selector: 'app-profile-badges',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    ScrollingModule,
    RouterModule,
  ],
  templateUrl: './profile-badges.component.html',
  styleUrl: './profile-badges.component.scss',
})
export class ProfileBadgesComponent {
  private panelNav = inject(PanelNavigationService);
  layout = inject(LayoutService);
  profileState = inject(PROFILE_STATE);
  private badgeService = inject(BadgeService);

  isLoading = signal(true);

  // Get all accepted badges for this profile
  acceptedBadges = computed(() => this.badgeService.acceptedBadges());

  // Parse badge definitions for display
  parsedBadges = computed(() => {
    // Include dependencies to react to async loading
    this.badgeService.badgeDefinitions();
    this.badgeService.failedBadgeDefinitions();
    this.badgeService.loadingBadgeDefinitions();

    return this.acceptedBadges().map(badge => {
      const definition = this.badgeService.getBadgeDefinition(badge.pubkey, badge.slug);
      
      if (!definition) {
        return {
          slug: badge.slug,
          name: 'Loading...',
          description: '',
          image: '',
          thumb: '',
          pubkey: badge.pubkey,
        };
      }

      const tags = definition.tags || [];
      const nameTag = tags.find((t: string[]) => t[0] === 'name');
      const descTag = tags.find((t: string[]) => t[0] === 'description');
      const imageTag = tags.find((t: string[]) => t[0] === 'image');
      const thumbTag = tags.find((t: string[]) => t[0] === 'thumb');

      return {
        slug: badge.slug,
        name: nameTag?.[1] || badge.slug,
        description: descTag?.[1] || '',
        image: imageTag?.[1] || '',
        thumb: thumbTag?.[1] || '',
        pubkey: badge.pubkey,
      };
    });
  });

  // Check if badges are still loading
  isBadgeLoading = computed(() => {
    return this.acceptedBadges().map(badge =>
      this.badgeService.isBadgeDefinitionLoading(badge.pubkey, badge.slug)
    );
  });

  // Check if badge failed to load
  isBadgeFailed = computed(() => {
    return this.acceptedBadges().map(badge =>
      this.badgeService.isBadgeDefinitionFailed(badge.pubkey, badge.slug)
    );
  });

  // Item size for virtual scrolling
  readonly itemSize = 88;

  constructor() {
    // Track loading state
    effect(() => {
      const badges = this.acceptedBadges();
      // If we have badges or badgeService finished loading, we're done
      if (badges.length > 0 || !this.badgeService.isLoadingAccepted()) {
        this.isLoading.set(false);
      }
    });
  }

  goBack(): void {
    this.panelNav.goBackRight();
  }

  getBadgeDetailRoute(badge: ParsedBadge): string[] {
    return ['/badges', 'details', `${badge.pubkey}:${badge.slug}`];
  }
}
