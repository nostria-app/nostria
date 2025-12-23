import { Component, inject, signal, computed, OnDestroy, OnInit, ChangeDetectionStrategy, AfterViewInit, ElementRef, viewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { Event, Filter } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { ReportingService } from '../../../services/reporting.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { MusicPlaylistCardComponent } from '../../../components/music-playlist-card/music-playlist-card.component';

const PLAYLIST_KIND = 34139;
const PAGE_SIZE = 24;

@Component({
  selector: 'app-music-playlists',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MusicPlaylistCardComponent,
  ],
  template: `
    <div class="music-playlists-container">
      <div class="page-header">
        <button mat-icon-button (click)="goBack()" aria-label="Go back">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="header-info">
          <h1 i18n="@@music.playlists.title">All Playlists</h1>
          <p class="subtitle">{{ playlistsCount() }} <span i18n="@@music.playlists.count">playlists</span></p>
        </div>
        <div class="header-actions">
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
            <p i18n="@@music.loading">Loading playlists...</p>
          </div>
        } @else if (displayedPlaylists().length === 0) {
          <div class="empty-state">
            <mat-icon>queue_music</mat-icon>
            <h2 i18n="@@music.playlists.empty.title">No playlists found</h2>
            <p>
              @if (source() === 'following') {
                <span i18n="@@music.playlists.empty.following">People you follow haven't created any playlists yet. Switch to Public to discover playlists from the wider Nostr network.</span>
              } @else {
                <span i18n="@@music.playlists.empty.public">No playlists have been created yet.</span>
              }
            </p>
            <button mat-flat-button (click)="refresh()">
              <mat-icon>refresh</mat-icon>
              <span i18n="@@music.refresh">Refresh</span>
            </button>
          </div>
        } @else {
          <div class="playlists-grid">
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
    .music-playlists-container {
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

    .playlists-grid {
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
export class MusicPlaylistsComponent implements OnInit, OnDestroy, AfterViewInit {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  allPlaylists = signal<Event[]>([]);
  loading = signal(true);
  loadingMore = signal(false);
  displayLimit = signal(PAGE_SIZE);
  source = signal<'following' | 'public'>('following');

  private playlistSubscription: { close: () => void } | null = null;
  private playlistMap = new Map<string, Event>();

  private followingPubkeys = computed(() => {
    return this.accountState.followingList() || [];
  });

  private currentPubkey = computed(() => {
    return this.accountState.pubkey();
  });

  isAuthenticated = computed(() => this.app.authenticated());

  filteredPlaylists = computed(() => {
    const playlists = this.allPlaylists();
    const following = this.followingPubkeys();
    const myPubkey = this.currentPubkey();
    const sourceVal = this.source();

    if (sourceVal === 'following' && following.length > 0) {
      return playlists.filter(p => following.includes(p.pubkey) && p.pubkey !== myPubkey);
    } else {
      return playlists.filter(p => !following.includes(p.pubkey) && p.pubkey !== myPubkey);
    }
  });

  displayedPlaylists = computed(() => {
    return this.filteredPlaylists().slice(0, this.displayLimit());
  });

  playlistsCount = computed(() => this.filteredPlaylists().length);

  hasMore = computed(() => {
    return this.filteredPlaylists().length > this.displayLimit();
  });

  loadMoreSentinel = viewChild<ElementRef>('loadMoreSentinel');
  private intersectionObserver: IntersectionObserver | null = null;

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
    this.playlistSubscription?.close();
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

  private startSubscription(): void {
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

    if (relayUrls.length === 0) {
      console.warn('No relays available for loading playlists');
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
      kinds: [PLAYLIST_KIND],
      limit: 500,
    };

    this.playlistSubscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
      const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

      const existing = this.playlistMap.get(uniqueId);
      if (existing && existing.created_at >= event.created_at) return;
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      if (this.reporting.isContentBlocked(event)) return;

      this.playlistMap.set(uniqueId, event);
      this.allPlaylists.set(
        Array.from(this.playlistMap.values()).sort((a, b) => b.created_at - a.created_at)
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
      setTimeout(() => this.observeSentinel(), 50);
    }, 100);
  }

  refresh(): void {
    this.playlistMap.clear();
    this.allPlaylists.set([]);
    this.loading.set(true);
    this.displayLimit.set(PAGE_SIZE);
    this.playlistSubscription?.close();
    this.startSubscription();
  }

  goBack(): void {
    this.router.navigate(['/music']);
  }
}
