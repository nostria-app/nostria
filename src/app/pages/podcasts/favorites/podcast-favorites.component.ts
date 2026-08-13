import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { PodcastFavoritesService } from '../../../services/podcast-favorites.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import { RssParserService } from '../../../services/rss-parser.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { PodcastShowEventComponent } from '../../../components/event-types/podcast-show-event.component';
import { MediaItem } from '../../../interfaces';

@Component({
  selector: 'app-podcast-favorites',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    PodcastShowEventComponent,
  ],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@podcasts.favorites.title">Favorite podcasts</h2>
    </div>

    <div class="page">
      @if (shows().length > 0) {
        <section>
          <h3 i18n="@@podcasts.favorites.shows">Shows</h3>
          <div class="grid">
            @for (show of shows(); track show.id) {
              <app-podcast-show-event [event]="show" [compact]="true"></app-podcast-show-event>
            }
          </div>
        </section>
      }

      <section>
        <h3 i18n="@@podcasts.favorites.rss">RSS feeds</h3>
        @if (rssUrls().length === 0 && shows().length === 0) {
          <p class="empty" i18n="@@podcasts.favorites.empty">No favorite podcasts yet.</p>
        }
        @for (url of rssUrls(); track url) {
          <div class="rss-row">
            <span>{{ url }}</span>
            <button mat-button (click)="playRss(url)" [disabled]="loadingRss() === url">
              <span i18n="@@podcasts.favorites.playRss">Play feed</span>
            </button>
            <button mat-icon-button type="button" (click)="removeRss(url)" aria-label="Remove RSS favorite">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .panel-header {
      position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 8px;
      min-height: 56px; padding: 0 16px;
      background: color-mix(in srgb, var(--mat-sys-surface) 92%, transparent);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .panel-title { margin: 0; font-size: 1.25rem; }
    .page { padding: 1rem 1rem 120px; display: flex; flex-direction: column; gap: 1.5rem; }
    h3 { margin: 0 0 0.75rem; color: var(--mat-sys-on-surface); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.75rem; }
    .rss-row {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--mat-sys-on-surface); }
    }
    .empty { color: var(--mat-sys-on-surface-variant); }
  `],
})
export class PodcastFavoritesComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private panelNav = inject(PanelNavigationService);
  private favorites = inject(PodcastFavoritesService);
  private podcastData = inject(PodcastDataService);
  private rssParser = inject(RssParserService);
  private mediaPlayer = inject(MediaPlayerService);
  private snackBar = inject(MatSnackBar);

  readonly rssUrls = this.favorites.rssUrls;
  readonly loadingRss = signal<string | null>(null);
  readonly shows = computed(() => {
    const pubkeys = this.favorites.showPubkeys();
    return pubkeys
      .map(pubkey => this.podcastData.getShow(pubkey))
      .filter((show): show is NonNullable<typeof show> => !!show);
  });

  constructor() {
    void this.podcastData.ensureInitialized();
    void this.podcastData.refresh(this.favorites.showPubkeys());
  }

  async playRss(url: string): Promise<void> {
    this.loadingRss.set(url);
    try {
      const feed = await this.rssParser.parse(url);
      const items: MediaItem[] = feed.items
        .filter(item => !!item.mediaUrl)
        .map(item => ({
          source: item.mediaUrl,
          title: item.title,
          artist: feed.author || feed.title,
          artwork: item.image || feed.image || '/icons/icon-192x192.png',
          type: 'Podcast' as const,
        }));
      if (items.length === 0) {
        this.snackBar.open($localize`:@@podcasts.error.noAudio:No audio URL found`, '', { duration: 3000 });
        return;
      }
      this.mediaPlayer.replaceQueue(items, 0);
    } catch {
      this.snackBar.open($localize`:@@podcasts.rss.failed:Failed to load RSS feed`, '', { duration: 3000 });
    } finally {
      this.loadingRss.set(null);
    }
  }

  async removeRss(url: string): Promise<void> {
    await this.favorites.removeRss(url);
  }

  goBack(): void {
    if (this.route.outlet === 'right') {
      this.panelNav.goBackRight();
      return;
    }
    void this.router.navigate(['/podcasts']);
  }
}
