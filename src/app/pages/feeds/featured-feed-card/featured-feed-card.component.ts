import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { FeaturedFeedCard, FeaturedFeedCardsService } from '../../../services/featured-feed-cards.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { AccountStateService } from '../../../services/account-state.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { AiService } from '../../../services/ai.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { LayoutService } from '../../../services/layout.service';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { SupportNostriaComponent } from '../../../components/support-nostria/support-nostria.component';
import {
  FeaturedFeedCardDismissAction,
  FeaturedFeedCardDismissDialogComponent,
} from './featured-feed-card-dismiss-dialog.component';

@Component({
  selector: 'app-featured-feed-card',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ReactiveFormsModule,
    UserProfileComponent,
  ],
  templateUrl: './featured-feed-card.component.html',
  styleUrl: './featured-feed-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturedFeedCardComponent {
  private readonly router = inject(Router);
  private readonly featuredFeedCards = inject(FeaturedFeedCardsService);
  private readonly accountState = inject(AccountStateService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly mediaPlayer = inject(MediaPlayerService);
  private readonly aiService = inject(AiService);
  private readonly customDialog = inject(CustomDialogService);
  private readonly layout = inject(LayoutService);
  private readonly localSettings = inject(LocalSettingsService);

  readonly card = input.required<FeaturedFeedCard>();
  readonly instanceId = input.required<string>();
  readonly aiPromptControl = new FormControl('');
  readonly followInProgress = signal<Record<string, boolean>>({});

  constructor() {
    effect(() => {
      const instanceId = this.instanceId();
      const card = this.card();

      untracked(() => {
        this.featuredFeedCards.markImpression(instanceId, card.id);
      });
    });
  }

  async dismiss(): Promise<void> {
    const card = this.card();
    const dialogRef = this.customDialog.open<FeaturedFeedCardDismissDialogComponent, FeaturedFeedCardDismissAction>(
      FeaturedFeedCardDismissDialogComponent,
      {
        title: 'Hide promotion cards?',
        width: 'min(520px, calc(100vw - 24px))',
        maxWidth: 'calc(100vw - 24px)',
        data: { title: card.title },
      }
    );
    const closeResult = await firstValueFrom(dialogRef.afterClosed$);

    if (closeResult.result === 'disable-all') {
      this.localSettings.setFeaturedFeedCardsEnabled(false);
      return;
    }

    if (closeResult.result === 'hide-one') {
      this.featuredFeedCards.dismiss(this.instanceId(), card.id);
    }
  }

  openPrimary(): void {
    const card = this.card();
    if (card.id === 'support-nostria') {
      this.featuredFeedCards.markClick(card.id);
      this.customDialog.open(SupportNostriaComponent, {
        title: 'Support Nostria Development',
        width: 'min(560px, calc(100vw - 24px))',
        maxWidth: 'calc(100vw - 24px)',
      });
      return;
    }

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

  openProfile(pubkey: string, event: MouseEvent): void {
    // Allow modifier keys (ctrl/cmd/middle-click) to use default browser behavior
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) {
      return;
    }
    event.preventDefault();
    this.featuredFeedCards.markClick(this.card().id);
    // Intentionally omit sourceEvent so the profile opens in the right panel
    // (otherwise the click bubbles from within .left-panel and forces left-panel navigation).
    this.layout.openProfile(pubkey);
  }

  async follow(pubkey: string): Promise<void> {
    const authenticated = !!this.accountState.pubkey();
    if (!authenticated || this.isFollowing(pubkey) || this.followInProgress()[pubkey]) {
      return;
    }

    this.followInProgress.update((current: Record<string, boolean>) => ({ ...current, [pubkey]: true }));
    try {
      await this.accountState.follow(pubkey);
      this.featuredFeedCards.markClick(this.card().id);
      this.snackBar.open('Following account', 'Dismiss', { duration: 2000 });
    } catch {
      this.snackBar.open('Unable to follow account', 'Dismiss', { duration: 2500 });
    } finally {
      this.followInProgress.update((current: Record<string, boolean>) => ({ ...current, [pubkey]: false }));
    }
  }

  isFollowing(pubkey: string): boolean {
    return this.accountState.followingList().includes(pubkey);
  }

  playTrack(index: number): void {
    const track = this.card().musicTracks?.[index];
    if (!track) {
      return;
    }

    this.featuredFeedCards.markClick(this.card().id);
    this.mediaPlayer.replaceQueue([{
      source: track.source,
      title: track.title,
      artist: track.artist,
      artwork: track.imageUrl || '/icons/icon-192x192.png',
      type: 'Music',
      eventPubkey: track.pubkey,
      eventIdentifier: track.identifier,
      eventKind: 36787,
    }]);
  }

  openTrack(naddr: string): void {
    this.featuredFeedCards.markClick(this.card().id);
    void this.router.navigate(['/music/song', naddr]);
  }

  askAi(): void {
    const prompt = this.aiPromptControl.value?.trim();
    if (!prompt) {
      return;
    }

    this.featuredFeedCards.markClick(this.card().id);
    this.aiService.queueStandardPrompt({
      title: 'Feed prompt',
      prompt,
    });
    void this.router.navigate(['/ai']);
  }
}