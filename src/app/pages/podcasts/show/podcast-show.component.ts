import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event as NostrEvent, nip19 } from 'nostr-tools';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import { PodcastFavoritesService } from '../../../services/podcast-favorites.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { PodcastEventComponent } from '../../../components/event-types/podcast-event.component';
import { PodcastShowMenuComponent } from '../../../components/podcast-show-menu/podcast-show-menu.component';
import { EditShowDialogComponent } from '../edit-show-dialog/edit-show-dialog.component';
import { MediaItem } from '../../../interfaces';
import {
  getPodcastAuthors,
  getPodcastDescription,
  getPodcastImage,
  getPodcastTitle,
  getPodcastWebsites,
  getPrimaryPodcastAudioUrl,
} from '../../../utils/podcast';

@Component({
  selector: 'app-podcast-show',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    UserProfileComponent,
    PodcastEventComponent,
    PodcastShowMenuComponent,
    EditShowDialogComponent,
  ],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font">{{ title() }}</h2>
      <span class="panel-header-spacer"></span>
      @if (isAuthenticated()) {
        <button mat-icon-button (click)="toggleFavorite()" [matTooltip]="isFavorite() ? unfavoriteLabel : favoriteLabel">
          <mat-icon>{{ isFavorite() ? 'bookmark' : 'bookmark_border' }}</mat-icon>
        </button>
      }
      @if (show(); as currentShow) {
        <app-podcast-show-menu #showMenu="podcastShowMenu" [event]="currentShow" (editRequested)="openEditShow()" (deleted)="goBack()" />
        <button mat-icon-button [matMenuTriggerFor]="showMenu.menu" aria-label="More options">
          <mat-icon>more_vert</mat-icon>
        </button>
      }
    </div>

    @if (loading()) {
      <div class="empty"><mat-spinner diameter="40"></mat-spinner></div>
    } @else {
      <div class="page">
        <div class="hero">
          <div class="cover">
            @if (image()) {
              <img [src]="image()" [alt]="title()" />
            } @else {
              <mat-icon>podcasts</mat-icon>
            }
          </div>
          <div class="hero-info">
            <h1>{{ title() }}</h1>
            <app-user-profile [pubkey]="pubkey()" mode="list"></app-user-profile>
            @if (description()) {
              <p>{{ description() }}</p>
            }
            @if (website(); as site) {
              <a [href]="site" target="_blank" rel="noopener noreferrer">{{ site }}</a>
            }
            <div class="hero-actions">
              <button mat-flat-button (click)="playAll()" [disabled]="episodes().length === 0">
                <mat-icon>play_arrow</mat-icon>
                <span i18n="@@podcasts.playAll">Play all</span>
              </button>
              <span class="count">{{ episodes().length }} {{ episodes().length === 1 ? 'episode' : 'episodes' }}</span>
            </div>
          </div>
        </div>

        @if (episodes().length === 0) {
          <div class="empty">
            <p i18n="@@podcasts.show.noEpisodes">No episodes from this show yet.</p>
          </div>
        } @else {
          @for (episode of episodes(); track episode.id; let i = $index) {
            <app-podcast-event [event]="episode" mode="row" [queueEpisodes]="episodes()" [queueIndex]="i"></app-podcast-event>
          }
        }
      </div>
    }

    @if (showEditDialog()) {
      <app-edit-show-dialog (closed)="onEditClosed()" />
    }
  `,
  styles: [`
    :host { display: block; }
    .panel-header {
      position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 8px;
      min-height: 56px; padding: 0 16px;
      background: color-mix(in srgb, var(--mat-sys-surface) 92%, transparent);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .panel-title { margin: 0; font-size: 1.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel-header-spacer { flex: 1; }
    .page { padding: 1rem 1rem 120px; }
    .hero { display: flex; gap: 1.25rem; margin-bottom: 1.5rem; }
    .cover {
      width: 160px; height: 160px; border-radius: 16px; overflow: hidden; flex-shrink: 0;
      background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container);
      display: flex; align-items: center; justify-content: center;
      img { width: 100%; height: 100%; object-fit: cover; }
      mat-icon { font-size: 64px; width: 64px; height: 64px; }
    }
    .hero-info { min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    h1 { margin: 0; font-size: 1.75rem; color: var(--mat-sys-on-surface); }
    p, a { color: var(--mat-sys-on-surface-variant); }
    .hero-actions { display: flex; align-items: center; gap: 1rem; }
    .count { color: var(--mat-sys-on-surface-variant); }
    .empty { display: flex; justify-content: center; padding: 3rem 1rem; color: var(--mat-sys-on-surface-variant); }
    @media (max-width: 600px) {
      .hero { flex-direction: column; }
      .cover { width: 100%; height: auto; aspect-ratio: 1; }
    }
  `],
})
export class PodcastShowComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private panelNav = inject(PanelNavigationService);
  private podcastData = inject(PodcastDataService);
  private favorites = inject(PodcastFavoritesService);
  private mediaPlayer = inject(MediaPlayerService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly showEditDialog = signal(false);
  readonly show = signal<NostrEvent | null>(null);
  readonly episodes = signal<NostrEvent[]>([]);
  readonly pubkey = signal('');
  readonly isAuthenticated = computed(() => this.app.authenticated());
  readonly isFavorite = computed(() => this.favorites.isFavoriteShow(this.pubkey()));
  readonly title = computed(() => getPodcastTitle(this.show() ?? { tags: [] } as unknown as NostrEvent) || $localize`:@@podcasts.untitledShow:Untitled podcast`);
  readonly description = computed(() => getPodcastDescription(this.show() ?? { tags: [] } as unknown as NostrEvent) || '');
  readonly image = computed(() => getPodcastImage(this.show() ?? { tags: [] } as unknown as NostrEvent) || '');
  readonly website = computed(() => getPodcastWebsites(this.show() ?? { tags: [] } as unknown as NostrEvent)[0] || '');
  readonly authors = computed(() => getPodcastAuthors(this.show() ?? { tags: [] } as unknown as NostrEvent));
  readonly favoriteLabel = $localize`:@@podcasts.action.favorite:Favorite show`;
  readonly unfavoriteLabel = $localize`:@@podcasts.action.unfavorite:Unfavorite show`;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const raw = this.route.snapshot.paramMap.get('pubkey') || '';
    const pubkey = this.decodePubkey(raw);
    this.pubkey.set(pubkey);
    const result = await this.podcastData.queryShowAndEpisodes(pubkey);
    this.show.set(result.show);
    this.episodes.set(result.episodes);
    this.loading.set(false);
  }

  private decodePubkey(value: string): string {
    if (value.startsWith('npub') || value.startsWith('nprofile')) {
      try {
        const decoded = nip19.decode(value);
        if (decoded.type === 'npub') return decoded.data;
        if (decoded.type === 'nprofile') return decoded.data.pubkey;
      } catch {
        return value;
      }
    }
    return value;
  }

  async playAll(): Promise<void> {
    const items: MediaItem[] = [];
    for (const episode of this.episodes()) {
      const source = getPrimaryPodcastAudioUrl(episode);
      if (!source) continue;
      items.push({
        source,
        title: getPodcastTitle(episode) || $localize`:@@podcasts.untitled:Untitled episode`,
        artist: this.title(),
        artwork: getPodcastImage(episode) || this.image() || '/icons/icon-192x192.png',
        type: 'Podcast',
        eventPubkey: episode.pubkey,
        eventIdentifier: episode.id,
        eventKind: episode.kind,
      });
    }
    if (items.length === 0) {
      this.snackBar.open($localize`:@@podcasts.error.noAudio:No audio URL found`, '', { duration: 3000 });
      return;
    }
    this.mediaPlayer.replaceQueue(items, 0);
  }

  async toggleFavorite(): Promise<void> {
    if (!this.accountState.pubkey()) return;
    await this.favorites.toggleShow(this.pubkey());
  }

  goBack(): void {
    if (this.route.outlet === 'right') {
      this.panelNav.goBackRight();
      return;
    }
    void this.router.navigate(['/podcasts']);
  }

  openEditShow(): void {
    this.showEditDialog.set(true);
  }

  onEditClosed(): void {
    this.showEditDialog.set(false);
    const pubkey = this.pubkey();
    if (pubkey) {
      this.show.set(this.podcastData.getShow(pubkey) ?? this.show());
    }
  }
}
