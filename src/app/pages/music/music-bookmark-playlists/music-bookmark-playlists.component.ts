import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Event } from 'nostr-tools';
import { MusicBookmarkPlaylistService } from '../../../services/music-bookmark-playlist.service';
import { MusicBookmarkPlaylistCardComponent } from '../../../components/music-bookmark-playlist-card/music-bookmark-playlist-card.component';
import { ReportingService } from '../../../services/reporting.service';
import { LoggerService } from '../../../services/logger.service';

const PAGE_SIZE = 24;

@Component({
  selector: 'app-music-bookmark-playlists',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MusicBookmarkPlaylistCardComponent],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font">Playlists</h2>
    </div>

    <div class="container">
      @if (loading()) {
        <div class="state">
          <mat-spinner diameter="42"></mat-spinner>
          <p>Loading playlists...</p>
        </div>
      } @else if (displayedPlaylists().length === 0) {
        <div class="state">
          <mat-icon>playlist_add</mat-icon>
          <p>No playlists found.</p>
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
    .container { padding: 1rem; padding-bottom: 120px; }
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
    .load-more { display: flex; justify-content: center; padding: 2rem 0; }
  `],
})
export class MusicBookmarkPlaylistsComponent implements AfterViewInit {
  private router = inject(Router);
  private playlistService = inject(MusicBookmarkPlaylistService);
  private reporting = inject(ReportingService);
  private logger = inject(LoggerService);

  allPlaylists = signal<Event[]>([]);
  loading = signal(true);
  displayLimit = signal(PAGE_SIZE);
  loadMoreSentinel = viewChild<ElementRef>('loadMoreSentinel');

  displayedPlaylists = computed(() => this.allPlaylists().slice(0, this.displayLimit()));
  hasMore = computed(() => this.allPlaylists().length > this.displayLimit());

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
      const events = await this.playlistService.fetchPublicPlaylists();
      this.allPlaylists.set(events.filter(event => !this.reporting.isUserBlocked(event.pubkey) && !this.reporting.isContentBlocked(event)));
    } catch (error) {
      this.logger.error('[MusicBookmarkPlaylist] Failed to load playlists page:', error);
    } finally {
      this.loading.set(false);
    }
  }

  loadMore(): void {
    this.displayLimit.update(limit => limit + PAGE_SIZE);
  }

  goBack(): void {
    void this.router.navigate(['/music']);
  }
}
