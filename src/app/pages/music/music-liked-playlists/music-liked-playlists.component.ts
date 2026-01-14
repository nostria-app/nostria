import { Component, inject, signal, computed, OnDestroy, ChangeDetectionStrategy, AfterViewInit, ElementRef, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Event, Filter, kinds } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { ReportingService } from '../../../services/reporting.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { MusicPlaylistCardComponent } from '../../../components/music-playlist-card/music-playlist-card.component';

const MUSIC_PLAYLIST_KIND = 34139;
const PAGE_SIZE = 24;

@Component({
  selector: 'app-music-liked-playlists',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MusicPlaylistCardComponent,
  ],
  template: `
    <div class="music-liked-playlists-container">
      <div class="page-header">
        <div class="header-info">
          <div class="header-icon">
            <mat-icon>playlist_play</mat-icon>
          </div>
          <div class="header-text">
            <h1>Liked Playlists</h1>
            <p class="subtitle">{{ playlistsCount() }} playlists</p>
          </div>
        </div>
      </div>

      <div class="page-content">
        @if (loading()) {
          <div class="loading-container">
            <mat-spinner diameter="50"></mat-spinner>
            <p>Loading playlists...</p>
          </div>
        } @else if (displayedPlaylists().length === 0) {
          <div class="empty-state">
            <mat-icon>playlist_add</mat-icon>
            <h2>No liked playlists yet</h2>
            <p>Playlists you like will appear here. Start exploring and tap the heart icon on playlists you enjoy!</p>
            <button mat-flat-button (click)="goBack()">
              <mat-icon>queue_music</mat-icon>
              <span>Browse Music</span>
            </button>
          </div>
        } @else {
          <div class="playlist-grid">
            @for (playlist of displayedPlaylists(); track playlist.id) {
              <app-music-playlist-card [event]="playlist"></app-music-playlist-card>
            }
          </div>

          @if (hasMore()) {
            <div #loadMoreSentinel class="load-more-container">
              @if (loadingMore()) {
                <mat-spinner diameter="24"></mat-spinner>
              } @else {
                <button mat-button (click)="loadMore()">
                  <mat-icon>expand_more</mat-icon>
                  <span>Load More</span>
                </button>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
    
    .music-liked-playlists-container {
      display: flex;
      flex-direction: column;
      padding: 1rem;
      padding-bottom: 120px;
      gap: 1rem;
    }

    .page-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.5rem 0;
      flex-wrap: wrap;
    }

    .header-info {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .header-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      border-radius: var(--mat-sys-corner-medium);
      background: linear-gradient(135deg, #7c4dff, #536dfe);

      mat-icon {
        font-size: 2rem;
        width: 2rem;
        height: 2rem;
        color: white;
      }
    }

    .header-text {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;

      h1 {
        margin: 0;
        font-size: 1.5rem;
        color: var(--mat-sys-on-surface);
      }

      .subtitle {
        margin: 0;
        font-size: 0.875rem;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .page-content {
      padding: 1rem 0;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem 2rem;
      gap: 1rem;

      p {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem 2rem;
      gap: 1rem;
      text-align: center;

      mat-icon {
        font-size: 4rem;
        width: 4rem;
        height: 4rem;
        color: var(--mat-sys-on-surface-variant);
        opacity: 0.5;
      }

      h2 {
        margin: 0;
        font-size: 1.5rem;
        color: var(--mat-sys-on-surface);
      }

      p {
        margin: 0;
        max-width: 400px;
        color: var(--mat-sys-on-surface-variant);
        line-height: 1.5;
      }

      button mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .playlist-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 1rem;
      padding: 0.5rem 0;
      max-width: 100%;

      @media (max-width: 600px) {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 0.75rem;
      }
    }

    .load-more-container {
      display: flex;
      justify-content: center;
      padding: 2rem;

      button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
    }
  `],
})
export class MusicLikedPlaylistsComponent implements OnDestroy, AfterViewInit {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private router = inject(Router);

  allPlaylists = signal<Event[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  displayLimit = signal(PAGE_SIZE);

  private reactionSubscription: { close: () => void } | null = null;
  private playlistSubscriptions: { close: () => void }[] = [];
  private likedPlaylistIds = new Set<string>();
  private playlistMap = new Map<string, Event>();
  private intersectionObserver: IntersectionObserver | null = null;

  loadMoreSentinel = viewChild<ElementRef>('loadMoreSentinel');

  isAuthenticated = computed(() => this.app.authenticated());

  displayedPlaylists = computed(() => {
    return this.allPlaylists().slice(0, this.displayLimit());
  });

  playlistsCount = computed(() => this.allPlaylists().length);

  hasMore = computed(() => {
    return this.allPlaylists().length > this.displayLimit();
  });

  constructor() {
    this.startSubscriptions();
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    this.reactionSubscription?.close();
    this.playlistSubscriptions.forEach(sub => sub.close());
    this.intersectionObserver?.disconnect();
  }

  private setupIntersectionObserver(): void {
    this.intersectionObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && this.hasMore() && !this.loadingMore() && !this.loading()) {
            this.loadMore();
          }
        });
      },
      { rootMargin: '200px' }
    );

    setTimeout(() => this.observeSentinel(), 100);
  }

  private tryObserveSentinel(): void {
    setTimeout(() => this.observeSentinel(), 100);
  }

  private observeSentinel(): void {
    const sentinel = this.loadMoreSentinel();
    if (sentinel && this.intersectionObserver) {
      this.intersectionObserver.observe(sentinel.nativeElement);
    }
  }

  private startSubscriptions(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.loading.set(false);
      return;
    }

    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
      console.warn('No relays available for loading liked playlists');
      this.loading.set(false);
      return;
    }

    // Fetch user's reactions (kind 7) to playlist events (kind 34139)
    const reactionFilter: Filter = {
      kinds: [kinds.Reaction],
      authors: [pubkey],
      '#k': [MUSIC_PLAYLIST_KIND.toString()],
      limit: 500,
    };

    let reactionsLoaded = false;
    const reactionTimeout = setTimeout(() => {
      reactionsLoaded = true;
      this.fetchLikedPlaylists(relayUrls);
    }, 3000);

    this.reactionSubscription = this.pool.subscribe(relayUrls, reactionFilter, (event: Event) => {
      // Check if it's a like ('+' content)
      if (event.content !== '+') return;

      // Get the 'a' tag for addressable events
      const aTag = event.tags.find((tag: string[]) => tag[0] === 'a')?.[1];
      const eTag = event.tags.find((tag: string[]) => tag[0] === 'e')?.[1];

      if (aTag) {
        this.likedPlaylistIds.add(aTag);
      } else if (eTag) {
        this.likedPlaylistIds.add(eTag);
      }

      if (!reactionsLoaded) {
        clearTimeout(reactionTimeout);
        reactionsLoaded = true;
        // Delay slightly to collect more reactions before fetching playlists
        setTimeout(() => this.fetchLikedPlaylists(relayUrls), 500);
      }
    });
  }

  private fetchLikedPlaylists(relayUrls: string[]): void {
    if (this.likedPlaylistIds.size === 0) {
      this.loading.set(false);
      this.tryObserveSentinel();
      return;
    }

    // Build filters for liked playlists
    const aTagCoordinates: string[] = [];
    const eventIds: string[] = [];

    this.likedPlaylistIds.forEach(id => {
      if (id.includes(':')) {
        aTagCoordinates.push(id);
      } else {
        eventIds.push(id);
      }
    });

    let playlistsLoaded = false;
    const playlistTimeout = setTimeout(() => {
      playlistsLoaded = true;
      this.loading.set(false);
      this.tryObserveSentinel();
    }, 5000);

    // Subscribe to playlists by coordinate (for addressable events)
    if (aTagCoordinates.length > 0) {
      // Parse coordinates and build filters
      const playlistFilters: Filter[] = aTagCoordinates
        .filter(coord => coord.startsWith(`${MUSIC_PLAYLIST_KIND}:`))
        .map(coord => {
          const parts = coord.split(':');
          return {
            kinds: [MUSIC_PLAYLIST_KIND],
            authors: [parts[1]],
            '#d': [parts[2]],
          };
        });

      if (playlistFilters.length > 0) {
        // Batch filters in groups of 20 to avoid too large requests
        const batchSize = 20;
        for (let i = 0; i < playlistFilters.length; i += batchSize) {
          const batch = playlistFilters.slice(i, i + batchSize);
          batch.forEach(filter => {
            const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
              if (this.reporting.isUserBlocked(event.pubkey)) return;
              if (this.reporting.isContentBlocked(event)) return;

              const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
              const uniqueId = `${event.pubkey}:${dTag}`;

              const existing = this.playlistMap.get(uniqueId);
              if (existing && existing.created_at >= event.created_at) return;

              this.playlistMap.set(uniqueId, event);
              this.allPlaylists.set(
                Array.from(this.playlistMap.values()).sort((a, b) => b.created_at - a.created_at)
              );

              if (!playlistsLoaded) {
                clearTimeout(playlistTimeout);
                playlistsLoaded = true;
                this.loading.set(false);
                this.tryObserveSentinel();
              }
            });
            this.playlistSubscriptions.push(sub);
          });
        }
      }
    }

    // Also fetch by event IDs if any
    if (eventIds.length > 0) {
      const idFilter: Filter = {
        kinds: [MUSIC_PLAYLIST_KIND],
        ids: eventIds.slice(0, 100), // Limit to 100 IDs per request
      };

      const sub = this.pool.subscribe(relayUrls, idFilter, (event: Event) => {
        if (this.reporting.isUserBlocked(event.pubkey)) return;
        if (this.reporting.isContentBlocked(event)) return;

        const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
        const uniqueId = `${event.pubkey}:${dTag}`;

        const existing = this.playlistMap.get(uniqueId);
        if (existing && existing.created_at >= event.created_at) return;

        this.playlistMap.set(uniqueId, event);
        this.allPlaylists.set(
          Array.from(this.playlistMap.values()).sort((a, b) => b.created_at - a.created_at)
        );

        if (!playlistsLoaded) {
          clearTimeout(playlistTimeout);
          playlistsLoaded = true;
          this.loading.set(false);
          this.tryObserveSentinel();
        }
      });
      this.playlistSubscriptions.push(sub);
    }

    // Fallback if no playlists found
    if (aTagCoordinates.length === 0 && eventIds.length === 0) {
      this.loading.set(false);
      this.tryObserveSentinel();
    }
  }

  loadMore(): void {
    this.loadingMore.set(true);
    this.displayLimit.update(limit => limit + PAGE_SIZE);
    setTimeout(() => {
      this.loadingMore.set(false);
      setTimeout(() => this.observeSentinel(), 50);
    }, 100);
  }

  goBack(): void {
    this.router.navigate(['/music']);
  }
}
