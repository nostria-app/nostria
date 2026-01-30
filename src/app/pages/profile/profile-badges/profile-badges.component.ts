import { Component, inject, computed, signal, effect } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { LayoutService } from '../../../services/layout.service';
import { BadgeService, AcceptedBadge } from '../../../services/badge.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { BadgeComponent } from '../../badges/badge/badge.component';

@Component({
  selector: 'app-profile-badges',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    RouterModule,
    BadgeComponent,
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

  getBadgeDetailRoute(badge: AcceptedBadge): string[] {
    return ['/badges', 'details', `${badge.pubkey}:${badge.slug}`];
  }
}
