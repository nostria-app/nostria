import { ChangeDetectionStrategy, Component, effect, inject, input, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { FeaturedFeedCard, FeaturedFeedCardsService } from '../../../services/featured-feed-cards.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';

@Component({
  selector: 'app-featured-feed-card',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    UserProfileComponent,
  ],
  templateUrl: './featured-feed-card.component.html',
  styleUrl: './featured-feed-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturedFeedCardComponent {
  private readonly router = inject(Router);
  private readonly featuredFeedCards = inject(FeaturedFeedCardsService);

  readonly card = input.required<FeaturedFeedCard>();
  readonly instanceId = input.required<string>();

  constructor() {
    effect(() => {
      const instanceId = this.instanceId();
      const card = this.card();

      untracked(() => {
        this.featuredFeedCards.markImpression(instanceId, card.id);
      });
    });
  }

  dismiss(): void {
    const card = this.card();
    this.featuredFeedCards.dismiss(this.instanceId(), card.id);
  }

  openPrimary(): void {
    const card = this.card();
    this.featuredFeedCards.markClick(card.id);
    void this.router.navigate(card.primaryRoute);
  }

  openSecondary(): void {
    const card = this.card();
    if (!card.secondaryRoute) {
      return;
    }

    this.featuredFeedCards.markClick(card.id);
    void this.router.navigate(card.secondaryRoute);
  }

  openArticle(naddr: string): void {
    this.featuredFeedCards.markClick(this.card().id);
    void this.router.navigate(['/a', naddr]);
  }
}