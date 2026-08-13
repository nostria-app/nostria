import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import { ListFilterValue } from '../../../components/list-filter-menu/list-filter-menu.component';
import { PodcastListFilterComponent } from '../../../components/podcast-list-filter/podcast-list-filter.component';
import { PodcastEventComponent } from '../../../components/event-types/podcast-event.component';
import { episodeMatchesQuery } from '../../../utils/podcast';

const PAGE_SIZE = 30;
const CURATED_FILTER = 'curated';

@Component({
  selector: 'app-podcast-episodes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    PodcastListFilterComponent,
    PodcastEventComponent,
  ],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back to Podcasts">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@podcasts.episodes.title">Episodes</h2>
      <span class="panel-header-spacer"></span>
      @if (isAuthenticated()) {
        <app-podcast-list-filter [initialFilter]="urlListFilter()" (filterChanged)="onFilterChanged($event)" />
      }
    </div>

    <div class="page">
      <div class="search-bar">
        <mat-icon>search</mat-icon>
        <input type="text" [placeholder]="searchPlaceholder" [value]="searchQuery()" (input)="onSearch($any($event))" />
      </div>

      @if (loading() && displayed().length === 0) {
        <div class="empty"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (displayed().length === 0) {
        <div class="empty">
          <mat-icon>podcasts</mat-icon>
          <p i18n="@@podcasts.episodes.empty">No episodes match this filter.</p>
        </div>
      } @else {
        <div class="episode-list">
          @for (episode of displayed(); track episode.id; let i = $index) {
            <app-podcast-event [event]="episode" mode="row" [queueEpisodes]="filtered()" [queueIndex]="i"></app-podcast-event>
          }
        </div>
        @if (hasMore()) {
          <button mat-button (click)="loadMore()">
            <span i18n="@@podcasts.loadMore">Load more</span>
          </button>
        }
      }
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
    .panel-header-spacer { flex: 1; }
    .page { padding: 1rem 1rem 120px; }
    .search-bar {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; margin-bottom: 1rem;
      background: var(--mat-sys-surface-container); border-radius: var(--mat-sys-corner-large);
      input { flex: 1; border: 0; background: transparent; outline: none; color: var(--mat-sys-on-surface); }
    }
    .empty { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 3rem 1rem; color: var(--mat-sys-on-surface-variant); }
  `],
})
export class PodcastEpisodesComponent implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private followSetsService = inject(FollowSetsService);
  private podcastData = inject(PodcastDataService);

  readonly loading = this.podcastData.loading;
  readonly isAuthenticated = computed(() => this.app.authenticated());
  readonly urlListFilter = signal<string | undefined>(this.route.snapshot.queryParams['list']);
  readonly selectedListFilter = signal<ListFilterValue>(this.urlListFilter() || CURATED_FILTER);
  readonly searchQuery = signal('');
  readonly displayLimit = signal(PAGE_SIZE);
  readonly searchPlaceholder = $localize`:@@podcasts.searchEpisodes:Search episodes...`;

  private filterPubkeys = computed(() => {
    const filter = this.selectedListFilter();
    if (filter === CURATED_FILTER) return this.podcastData.showPubkeys();
    if (filter === 'all') return null;
    if (filter === 'following') return this.accountState.followingList() || [];
    return this.followSetsService.followSets().find(set => set.dTag === filter)?.pubkeys || [];
  });

  readonly filtered = computed(() => {
    const query = this.searchQuery();
    const pubkeys = this.filterPubkeys();
    let episodes = this.podcastData.episodes().filter(episode => episodeMatchesQuery(episode, query));
    if (pubkeys !== null) {
      if (pubkeys.length === 0) return [];
      episodes = episodes.filter(episode => pubkeys.includes(episode.pubkey));
    }
    return episodes.sort((a, b) => b.created_at - a.created_at);
  });

  readonly displayed = computed(() => this.filtered().slice(0, this.displayLimit()));
  readonly hasMore = computed(() => this.filtered().length > this.displayLimit());

  constructor() {
    void this.podcastData.ensureInitialized();
    effect(() => {
      const filter = this.selectedListFilter();
      if (filter === CURATED_FILTER) {
        untracked(() => this.podcastData.startSubscriptions(null));
        return;
      }
      const pubkeys = this.filterPubkeys();
      untracked(() => this.podcastData.startSubscriptions(pubkeys));
    });
  }

  ngOnDestroy(): void {
    this.podcastData.stopSubscriptions();
  }

  onFilterChanged(filter: ListFilterValue): void {
    this.selectedListFilter.set(filter);
    this.displayLimit.set(PAGE_SIZE);
  }

  onSearch(domEvent: { target: EventTarget | null }): void {
    this.searchQuery.set((domEvent.target as HTMLInputElement).value);
    this.displayLimit.set(PAGE_SIZE);
  }

  loadMore(): void {
    this.displayLimit.update(limit => limit + PAGE_SIZE);
  }

  goBack(): void {
    void this.router.navigate(['/podcasts']);
  }
}
