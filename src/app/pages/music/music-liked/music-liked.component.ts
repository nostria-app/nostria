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
import { MediaPlayerService } from '../../../services/media-player.service';
import { DataService } from '../../../services/data.service';
import { MediaItem } from '../../../interfaces';
import { MusicEventComponent } from '../../../components/event-types/music-event.component';

const MUSIC_KIND = 36787;
const PAGE_SIZE = 24;

@Component({
  selector: 'app-music-liked',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MusicEventComponent,
  ],
  template: `
    <div class="music-liked-container">
      <div class="page-header">
        <button mat-icon-button (click)="goBack()" aria-label="Go back">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="header-info">
          <div class="header-icon">
            <mat-icon>favorite</mat-icon>
          </div>
          <div class="header-text">
            <h1 i18n="@@music.liked.title">Liked Songs</h1>
            <p class="subtitle">{{ tracksCount() }} <span i18n="@@music.liked.trackCount">tracks</span></p>
          </div>
        </div>
        @if (allTracks().length > 0) {
          <button mat-fab extended class="play-all-button" (click)="playAll()" aria-label="Play all">
            <mat-icon>play_arrow</mat-icon>
            <span i18n="@@music.playAll">Play All</span>
          </button>
        }
      </div>

      <div class="page-content">
        @if (loading()) {
          <div class="loading-container">
            <mat-spinner diameter="50"></mat-spinner>
            <p i18n="@@music.loading">Loading music...</p>
          </div>
        } @else if (displayedTracks().length === 0) {
          <div class="empty-state">
            <mat-icon>favorite_border</mat-icon>
            <h2 i18n="@@music.liked.empty.title">No liked songs yet</h2>
            <p i18n="@@music.liked.empty.message">Songs you like will appear here. Start exploring and tap the heart icon on songs you enjoy!</p>
            <button mat-flat-button (click)="goBack()">
              <mat-icon>music_note</mat-icon>
              <span i18n="@@music.liked.browseMusic">Browse Music</span>
            </button>
          </div>
        } @else {
          <div class="music-grid">
            @for (track of displayedTracks(); track track.id) {
              <app-music-event [event]="track" mode="card"></app-music-event>
            }
          </div>

          @if (hasMore()) {
            <div #loadMoreSentinel class="load-more-container">
              @if (loadingMore()) {
                <mat-spinner diameter="24"></mat-spinner>
              } @else {
                <button mat-button (click)="loadMore()">
                  <mat-icon>expand_more</mat-icon>
                  <span i18n="@@music.loadMore">Load More</span>
                </button>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .music-liked-container {
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

      .play-all-button {
        margin-left: auto;

        @media (max-width: 600px) {
          margin-left: 0;
          width: 100%;
          margin-top: 0.5rem;
        }
      }
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
      background: linear-gradient(135deg, #e91e63, #9c27b0);

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

    .music-grid {
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
export class MusicLikedComponent implements OnDestroy, AfterViewInit {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private router = inject(Router);
  private mediaPlayer = inject(MediaPlayerService);
  private dataService = inject(DataService);

  allTracks = signal<Event[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  displayLimit = signal(PAGE_SIZE);

  private reactionSubscription: { close: () => void } | null = null;
  private trackSubscription: { close: () => void } | null = null;
  private likedEventIds = new Set<string>();
  private trackMap = new Map<string, Event>();
  private intersectionObserver: IntersectionObserver | null = null;

  loadMoreSentinel = viewChild<ElementRef>('loadMoreSentinel');

  isAuthenticated = computed(() => this.app.authenticated());

  displayedTracks = computed(() => {
    return this.allTracks().slice(0, this.displayLimit());
  });

  tracksCount = computed(() => this.allTracks().length);

  hasMore = computed(() => {
    return this.allTracks().length > this.displayLimit();
  });

  constructor() {
    this.startSubscriptions();
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    this.reactionSubscription?.close();
    this.trackSubscription?.close();
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
      console.warn('No relays available for loading liked songs');
      this.loading.set(false);
      return;
    }

    // First, fetch user's reactions (kind 7) to music events (kind 36787)
    const reactionFilter: Filter = {
      kinds: [kinds.Reaction],
      authors: [pubkey],
      '#k': [MUSIC_KIND.toString()],
      limit: 500,
    };

    let reactionsLoaded = false;
    const reactionTimeout = setTimeout(() => {
      reactionsLoaded = true;
      this.fetchLikedTracks(relayUrls);
    }, 3000);

    this.reactionSubscription = this.pool.subscribe(relayUrls, reactionFilter, (event: Event) => {
      // Check if it's a like ('+' content)
      if (event.content !== '+') return;

      // Get the 'a' tag for addressable events or 'e' tag for regular events
      const aTag = event.tags.find((tag: string[]) => tag[0] === 'a')?.[1];
      const eTag = event.tags.find((tag: string[]) => tag[0] === 'e')?.[1];

      if (aTag) {
        // For addressable events, store the coordinate
        this.likedEventIds.add(aTag);
      } else if (eTag) {
        this.likedEventIds.add(eTag);
      }

      if (!reactionsLoaded) {
        clearTimeout(reactionTimeout);
        reactionsLoaded = true;
        // Delay slightly to collect more reactions before fetching tracks
        setTimeout(() => this.fetchLikedTracks(relayUrls), 500);
      }
    });
  }

  private fetchLikedTracks(relayUrls: string[]): void {
    if (this.likedEventIds.size === 0) {
      this.loading.set(false);
      this.tryObserveSentinel();
      return;
    }

    // Build filters for liked tracks
    const aTagCoordinates: string[] = [];
    const eventIds: string[] = [];

    this.likedEventIds.forEach(id => {
      if (id.includes(':')) {
        aTagCoordinates.push(id);
      } else {
        eventIds.push(id);
      }
    });

    let tracksLoaded = false;
    const trackTimeout = setTimeout(() => {
      tracksLoaded = true;
      this.loading.set(false);
      this.tryObserveSentinel();
    }, 5000);

    // Subscribe to tracks by coordinate (for addressable events)
    if (aTagCoordinates.length > 0) {
      // Parse coordinates and build filters
      const trackFilters: Filter[] = aTagCoordinates
        .filter(coord => coord.startsWith(`${MUSIC_KIND}:`))
        .map(coord => {
          const parts = coord.split(':');
          return {
            kinds: [MUSIC_KIND],
            authors: [parts[1]],
            '#d': [parts[2]],
          };
        });

      if (trackFilters.length > 0) {
        // Batch filters in groups of 20 to avoid too large requests
        const batchSize = 20;
        for (let i = 0; i < trackFilters.length; i += batchSize) {
          const batch = trackFilters.slice(i, i + batchSize);
          batch.forEach(filter => {
            this.pool.subscribe(relayUrls, filter, (event: Event) => {
              if (this.reporting.isUserBlocked(event.pubkey)) return;
              if (this.reporting.isContentBlocked(event)) return;

              const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
              const uniqueId = `${event.pubkey}:${dTag}`;

              const existing = this.trackMap.get(uniqueId);
              if (existing && existing.created_at >= event.created_at) return;

              this.trackMap.set(uniqueId, event);
              this.allTracks.set(
                Array.from(this.trackMap.values()).sort((a, b) => b.created_at - a.created_at)
              );

              if (!tracksLoaded) {
                clearTimeout(trackTimeout);
                tracksLoaded = true;
                this.loading.set(false);
                this.tryObserveSentinel();
              }
            });
          });
        }
      }
    }

    // Also fetch by event IDs if any
    if (eventIds.length > 0) {
      const idFilter: Filter = {
        kinds: [MUSIC_KIND],
        ids: eventIds.slice(0, 100), // Limit to 100 IDs per request
      };

      this.pool.subscribe(relayUrls, idFilter, (event: Event) => {
        if (this.reporting.isUserBlocked(event.pubkey)) return;
        if (this.reporting.isContentBlocked(event)) return;

        const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
        const uniqueId = `${event.pubkey}:${dTag}`;

        const existing = this.trackMap.get(uniqueId);
        if (existing && existing.created_at >= event.created_at) return;

        this.trackMap.set(uniqueId, event);
        this.allTracks.set(
          Array.from(this.trackMap.values()).sort((a, b) => b.created_at - a.created_at)
        );

        if (!tracksLoaded) {
          clearTimeout(trackTimeout);
          tracksLoaded = true;
          this.loading.set(false);
          this.tryObserveSentinel();
        }
      });
    }

    // Fallback if no tracks found
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

  async playAll(): Promise<void> {
    const tracks = this.allTracks();
    if (tracks.length === 0) return;

    // Create media items for all tracks and play the first one
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const urlTag = track.tags.find(t => t[0] === 'url');
      const url = urlTag?.[1];
      if (!url) continue;

      const titleTag = track.tags.find(t => t[0] === 'title');
      const imageTag = track.tags.find(t => t[0] === 'image');
      const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';

      // Get artist name
      let artistName = 'Unknown Artist';
      const profile = await this.dataService.getProfile(track.pubkey);
      if (profile) {
        artistName = profile.data?.name || profile.data?.display_name || 'Unknown Artist';
      }

      const mediaItem: MediaItem = {
        source: url,
        title: titleTag?.[1] || 'Untitled Track',
        artist: artistName,
        artwork: imageTag?.[1] || '/icons/icon-192x192.png',
        type: 'Music',
        eventPubkey: track.pubkey,
        eventIdentifier: dTag,
        lyrics: this.utilities.extractLyricsFromEvent(track),
      };

      if (i === 0) {
        this.mediaPlayer.play(mediaItem);
      } else {
        this.mediaPlayer.enque(mediaItem);
      }
    }
  }

  goBack(): void {
    this.router.navigate(['/music']);
  }
}
