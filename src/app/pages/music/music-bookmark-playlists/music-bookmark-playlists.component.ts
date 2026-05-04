import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApplicationService } from '../../../services/application.service';
import { Event } from 'nostr-tools';
import { MusicBookmarkPlaylistService } from '../../../services/music-bookmark-playlist.service';
import { MusicBookmarkPlaylistCardComponent } from '../../../components/music-bookmark-playlist-card/music-bookmark-playlist-card.component';
import { ReportingService } from '../../../services/reporting.service';
import { LoggerService } from '../../../services/logger.service';
import { CreateMusicBookmarkPlaylistDialogComponent } from '../create-music-bookmark-playlist-dialog/create-music-bookmark-playlist-dialog.component';
import { AccountStateService } from '../../../services/account-state.service';

const PAGE_SIZE = 24;
type PlaylistSourceFilter = 'own' | 'following' | 'public';

@Component({
  selector: 'app-music-bookmark-playlists',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatProgressSpinnerModule, MatTooltipModule, MusicBookmarkPlaylistCardComponent, CreateMusicBookmarkPlaylistDialogComponent],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font">Playlists</h2>
      <span class="panel-header-spacer"></span>
      @if (isAuthenticated()) {
        <button mat-icon-button [matMenuTriggerFor]="sourceMenu" [matTooltip]="'Playlist source: ' + sourceFilterLabel()">
          <mat-icon>filter_alt</mat-icon>
        </button>
      }
      <mat-menu #sourceMenu="matMenu">
        <button mat-menu-item (click)="setSourceFilter('own')">
          <mat-icon>{{ sourceFilter() === 'own' ? 'check' : 'person' }}</mat-icon>
          <span>Your playlists</span>
        </button>
        <button mat-menu-item (click)="setSourceFilter('following')">
          <mat-icon>{{ sourceFilter() === 'following' ? 'check' : 'people' }}</mat-icon>
          <span>Following</span>
        </button>
        <button mat-menu-item (click)="setSourceFilter('public')">
          <mat-icon>{{ sourceFilter() === 'public' ? 'check' : 'public' }}</mat-icon>
          <span>Public</span>
        </button>
      </mat-menu>
    </div>

    <div class="container">
      @if (isAuthenticated()) {
        <div class="source-filter-summary" aria-label="Playlist source filter">
          <button type="button" class="source-filter-chip" [class.active]="sourceFilter() === 'own'"
            [attr.aria-pressed]="sourceFilter() === 'own'" (click)="setSourceFilter('own')">
            Yours
          </button>
          <button type="button" class="source-filter-chip" [class.active]="sourceFilter() === 'following'"
            [attr.aria-pressed]="sourceFilter() === 'following'" (click)="setSourceFilter('following')">
            Following
          </button>
          <button type="button" class="source-filter-chip" [class.active]="sourceFilter() === 'public'"
            [attr.aria-pressed]="sourceFilter() === 'public'" (click)="setSourceFilter('public')">
            Public
          </button>
        </div>
      }

      @if (loading()) {
        <div class="state">
          <mat-spinner diameter="42"></mat-spinner>
          <p>Loading playlists...</p>
        </div>
      } @else if (displayedPlaylists().length === 0) {
        <div class="state">
          <mat-icon>playlist_add</mat-icon>
          <p>{{ emptyStateMessage() }}</p>
          @if (isAuthenticated()) {
            <button mat-flat-button type="button" (click)="openCreatePlaylist()">
              <mat-icon>add</mat-icon>
              <span>Create Playlist</span>
            </button>
          }
        </div>
      } @else {
        <div class="grid">
          @for (playlist of displayedPlaylists(); track playlist.id) {
            <app-music-bookmark-playlist-card [event]="playlist"></app-music-bookmark-playlist-card>
          }
        </div>
        @if (hasMore()) {
          <div #loadMoreSentinel class="load-more">
            <button mat-button (click)="loadMore()">
              <mat-icon>expand_more</mat-icon>
              <span>Load More</span>
            </button>
          </div>
        }
      }
    </div>

    @if (showCreatePlaylistDialog()) {
      <app-create-music-bookmark-playlist-dialog (closed)="onCreatePlaylistDialogClosed($event)" />
    }
  `,
  styles: [`
    :host { display: block; }
    .panel-header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 56px;
      padding: 0 16px;
      background: color-mix(in srgb, var(--mat-sys-surface) 92%, transparent);
      backdrop-filter: blur(20px);
    }
    .panel-title { margin: 0; font-size: 1.25rem; }
    .panel-header-spacer { flex: 1; }
    .container {
      padding: 1rem;
      padding-bottom: 120px;
      max-width: 700px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .source-filter-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .source-filter-chip {
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
      border-radius: var(--mat-sys-corner-full);
      padding: 0.4rem 0.85rem;
      cursor: pointer;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .source-filter-chip.active {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      border-color: var(--mat-sys-primary);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 1rem;
    }
    .state {
      min-height: 240px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      color: var(--mat-sys-on-surface-variant);
      text-align: center;
    }
    .state mat-icon { width: 3rem; height: 3rem; font-size: 3rem; }
    .state button mat-icon { width: 1.25rem; height: 1.25rem; font-size: 1.25rem; }
    .load-more { display: flex; justify-content: center; padding: 2rem 0; }
  `],
})
export class MusicBookmarkPlaylistsComponent implements AfterViewInit {
  private router = inject(Router);
  private app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private playlistService = inject(MusicBookmarkPlaylistService);
  private reporting = inject(ReportingService);
  private logger = inject(LoggerService);

  allPlaylists = signal<Event[]>([]);
  loading = signal(true);
  displayLimit = signal(PAGE_SIZE);
  showCreatePlaylistDialog = signal(false);
  sourceFilter = signal<PlaylistSourceFilter>('public');
  loadMoreSentinel = viewChild<ElementRef>('loadMoreSentinel');

  isAuthenticated = computed(() => this.app.authenticated());
  private currentPubkey = computed(() => this.accountState.pubkey());
  private followingPubkeys = computed(() => this.accountState.followingList() || []);

  filteredPlaylists = computed(() => {
    const playlists = this.allPlaylists();
    const currentPubkey = this.currentPubkey();
    const followingPubkeys = new Set(this.followingPubkeys());

    switch (this.sourceFilter()) {
      case 'own':
        return currentPubkey ? playlists.filter(playlist => playlist.pubkey === currentPubkey) : [];

      case 'following':
        return playlists.filter(playlist => playlist.pubkey !== currentPubkey && followingPubkeys.has(playlist.pubkey));

      case 'public':
      default:
        return playlists.filter(playlist => playlist.pubkey !== currentPubkey && !followingPubkeys.has(playlist.pubkey));
    }
  });

  displayedPlaylists = computed(() => this.filteredPlaylists().slice(0, this.displayLimit()));
  hasMore = computed(() => this.filteredPlaylists().length > this.displayLimit());
  sourceFilterLabel = computed(() => {
    switch (this.sourceFilter()) {
      case 'own':
        return 'Yours';
      case 'following':
        return 'Following';
      case 'public':
      default:
        return 'Public';
    }
  });
  emptyStateMessage = computed(() => {
    switch (this.sourceFilter()) {
      case 'own':
        return 'You have not created any playlists yet.';
      case 'following':
        return 'People you follow have not shared any playlists yet.';
      case 'public':
      default:
        return 'No public playlists found.';
    }
  });

  private intersectionObserver: IntersectionObserver | null = null;

  constructor() {
    void this.loadPlaylists();
  }

  ngAfterViewInit(): void {
    this.intersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && this.hasMore()) {
          this.loadMore();
        }
      });
    }, { rootMargin: '200px' });

    setTimeout(() => {
      const sentinel = this.loadMoreSentinel();
      if (sentinel) {
        this.intersectionObserver?.observe(sentinel.nativeElement);
      }
    }, 100);
  }

  private async loadPlaylists(): Promise<void> {
    try {
      const [publicEvents, ownPlaylists] = await Promise.all([
        this.playlistService.fetchPublicPlaylists(),
        this.playlistService.fetchUserPlaylists(),
      ]);

      const latestByKey = new Map<string, Event>();
      const ownEvents = ownPlaylists
        .map(playlist => playlist.event)
        .filter((event): event is Event => event !== undefined);
      const mergedEvents = [...publicEvents, ...ownEvents];

      for (const event of mergedEvents) {
        if (this.reporting.isUserBlocked(event.pubkey) || this.reporting.isContentBlocked(event)) {
          continue;
        }

        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const key = `${event.pubkey}:${dTag}`;
        const existing = latestByKey.get(key);
        if (!existing || existing.created_at < event.created_at) {
          latestByKey.set(key, event);
        }
      }

      this.allPlaylists.set(Array.from(latestByKey.values()).sort((a, b) => b.created_at - a.created_at));
    } catch (error) {
      this.logger.error('[MusicBookmarkPlaylist] Failed to load playlists page:', error);
    } finally {
      this.loading.set(false);
    }
  }

  loadMore(): void {
    this.displayLimit.update(limit => limit + PAGE_SIZE);
  }

  setSourceFilter(source: PlaylistSourceFilter): void {
    this.sourceFilter.set(source);
    this.displayLimit.set(PAGE_SIZE);
  }

  openCreatePlaylist(): void {
    this.showCreatePlaylistDialog.set(true);
  }

  async onCreatePlaylistDialogClosed(result: unknown): Promise<void> {
    this.showCreatePlaylistDialog.set(false);
    if (!result) {
      return;
    }

    await this.loadPlaylists();
  }

  goBack(): void {
    void this.router.navigate(['/music']);
  }
}
