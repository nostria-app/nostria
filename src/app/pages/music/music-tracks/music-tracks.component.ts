import { Component, inject, signal, computed, OnDestroy, OnInit, ChangeDetectionStrategy, AfterViewInit, ElementRef, viewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { Event, Filter } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { ReportingService } from '../../../services/reporting.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { MusicEventComponent } from '../../../components/event-types/music-event.component';

const MUSIC_KIND = 36787;
const PAGE_SIZE = 24;

@Component({
  selector: 'app-music-tracks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatSelectModule,
    MusicEventComponent,
  ],
  template: `
    <div class="music-tracks-container">
      <div class="page-header">
        <button mat-icon-button (click)="goBack()" aria-label="Go back">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="header-info">
          <h1 i18n="@@music.tracks.title">All Songs</h1>
          <p class="subtitle">{{ tracksCount() }} <span i18n="@@music.tracks.trackCount">tracks</span></p>
        </div>
        <div class="header-actions">
          <mat-select class="sort-select" [(value)]="sortBy" aria-label="Sort tracks">
            <mat-option value="recents">Recents</mat-option>
            <mat-option value="alphabetical">Alphabetical</mat-option>
            <mat-option value="artist">Artist</mat-option>
          </mat-select>
          @if (isAuthenticated()) {
            <mat-button-toggle-group [value]="source()" (change)="onSourceChange($event.value)" class="source-toggle">
              <mat-button-toggle value="following">
                <mat-icon>people</mat-icon>
                <span i18n="@@music.toggle.following">Following</span>
              </mat-button-toggle>
              <mat-button-toggle value="public">
                <mat-icon>public</mat-icon>
                <span i18n="@@music.toggle.public">Public</span>
              </mat-button-toggle>
            </mat-button-toggle-group>
          }
        </div>
      </div>

      <div class="page-content">
        @if (loading()) {
          <div class="loading-container">
            <mat-spinner diameter="50"></mat-spinner>
            <p i18n="@@music.loading">Loading music...</p>
          </div>
        } @else if (displayedTracks().length === 0) {
          <div class="empty-state">
            <mat-icon>music_note</mat-icon>
            <h2 i18n="@@music.tracks.empty.title">No songs found</h2>
            <p>
              @if (source() === 'following') {
                <span i18n="@@music.tracks.empty.following">People you follow haven't shared any music yet. Switch to Public to discover music from the wider Nostr network.</span>
              } @else {
                <span i18n="@@music.tracks.empty.public">No music tracks have been shared yet.</span>
              }
            </p>
            <button mat-flat-button (click)="refresh()">
              <mat-icon>refresh</mat-icon>
              <span i18n="@@music.refresh">Refresh</span>
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
    .music-tracks-container {
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
      flex-direction: column;
      gap: 0.25rem;
      flex: 1;

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

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .sort-select {
      font-size: 0.875rem;
      min-width: 130px;
    }

    .source-toggle {
      mat-button-toggle {
        mat-icon {
          margin-right: 0.25rem;
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
        }
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
export class MusicTracksComponent implements OnInit, OnDestroy, AfterViewInit {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  loadMoreSentinel = viewChild<ElementRef>('loadMoreSentinel');

  allTracks = signal<Event[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  displayLimit = signal(PAGE_SIZE);
  source = signal<'following' | 'public'>('following');
  sortBy = signal<'recents' | 'alphabetical' | 'artist'>('recents');

  private trackSubscription: { close: () => void } | null = null;
  private trackMap = new Map<string, Event>();
  private intersectionObserver: IntersectionObserver | null = null;

  private followingPubkeys = computed(() => {
    return this.accountState.followingList() || [];
  });

  isAuthenticated = computed(() => this.app.authenticated());

  filteredTracks = computed(() => {
    const tracks = this.allTracks();
    const following = this.followingPubkeys();
    const sourceVal = this.source();
    const sort = this.sortBy();

    let filtered: Event[];
    if (sourceVal === 'following' && following.length > 0) {
      filtered = tracks.filter(track => following.includes(track.pubkey));
    } else {
      filtered = tracks.filter(track => !following.includes(track.pubkey));
    }

    // Apply sorting
    switch (sort) {
      case 'alphabetical':
        return [...filtered].sort((a, b) => {
          const titleA = a.tags.find(t => t[0] === 'title')?.[1] || '';
          const titleB = b.tags.find(t => t[0] === 'title')?.[1] || '';
          return titleA.localeCompare(titleB);
        });

      case 'artist':
        return [...filtered].sort((a, b) => {
          const artistA = a.tags.find(t => t[0] === 'artist')?.[1] || '';
          const artistB = b.tags.find(t => t[0] === 'artist')?.[1] || '';
          return artistA.localeCompare(artistB);
        });

      case 'recents':
      default:
        return filtered;
    }
  });

  displayedTracks = computed(() => {
    return this.filteredTracks().slice(0, this.displayLimit());
  });

  tracksCount = computed(() => this.filteredTracks().length);

  hasMore = computed(() => {
    return this.filteredTracks().length > this.displayLimit();
  });

  ngOnInit(): void {
    // Get source from query params
    this.route.queryParams.subscribe(params => {
      const sourceParam = params['source'];
      if (sourceParam === 'following' || sourceParam === 'public') {
        this.source.set(sourceParam);
      }
    });
    this.startSubscription();
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
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

    // Initial observation attempt - also re-observed when loading completes
    setTimeout(() => this.observeSentinel(), 100);
  }

  private tryObserveSentinel(): void {
    // Re-attempt observation when data loads - sentinel may not exist initially
    setTimeout(() => this.observeSentinel(), 100);
  }

  private observeSentinel(): void {
    const sentinel = this.loadMoreSentinel();
    if (sentinel && this.intersectionObserver) {
      this.intersectionObserver.observe(sentinel.nativeElement);
    }
  }

  private startSubscription(): void {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
      console.warn('No relays available for loading tracks');
      this.loading.set(false);
      return;
    }

    let loaded = false;
    const timeout = setTimeout(() => {
      loaded = true;
      this.loading.set(false);
      this.tryObserveSentinel();
    }, 5000);

    const filter: Filter = {
      kinds: [MUSIC_KIND],
      limit: 500,
    };

    this.trackSubscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

      const existing = this.trackMap.get(uniqueId);
      if (existing && existing.created_at >= event.created_at) return;
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      if (this.reporting.isContentBlocked(event)) return;

      this.trackMap.set(uniqueId, event);
      this.allTracks.set(
        Array.from(this.trackMap.values()).sort((a, b) => b.created_at - a.created_at)
      );

      if (!loaded) {
        clearTimeout(timeout);
        loaded = true;
        this.loading.set(false);
        this.tryObserveSentinel();
      }
    });
  }

  onSourceChange(value: 'following' | 'public'): void {
    this.source.set(value);
    this.displayLimit.set(PAGE_SIZE);
    // Update URL query params
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { source: value },
      queryParamsHandling: 'merge',
    });
  }

  loadMore(): void {
    this.loadingMore.set(true);
    this.displayLimit.update(limit => limit + PAGE_SIZE);
    setTimeout(() => {
      this.loadingMore.set(false);
      // Re-observe sentinel after DOM updates
      setTimeout(() => this.observeSentinel(), 50);
    }, 100);
  }

  refresh(): void {
    this.trackMap.clear();
    this.allTracks.set([]);
    this.loading.set(true);
    this.displayLimit.set(PAGE_SIZE);
    this.trackSubscription?.close();
    this.startSubscription();
  }

  goBack(): void {
    this.router.navigate(['/music']);
  }
}
