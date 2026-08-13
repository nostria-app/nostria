import { Component, ChangeDetectionStrategy, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { LayoutService } from '../../services/layout.service';
import { PodcastDataService } from '../../services/podcast-data.service';
import { PodcastFavoritesService } from '../../services/podcast-favorites.service';
import { ListFilterValue } from '../../components/list-filter-menu/list-filter-menu.component';
import { PodcastListFilterComponent } from '../../components/podcast-list-filter/podcast-list-filter.component';
import { PodcastEventComponent } from '../../components/event-types/podcast-event.component';
import { PodcastShowEventComponent } from '../../components/event-types/podcast-show-event.component';
import { PodcastSettingsDialogComponent } from './podcast-settings-dialog/podcast-settings-dialog.component';
import { PublishEpisodeDialogComponent } from './publish-episode-dialog/publish-episode-dialog.component';
import { EditShowDialogComponent } from './edit-show-dialog/edit-show-dialog.component';
import { episodeMatchesQuery, getPodcastTitle, showMatchesQuery } from '../../utils/podcast';

const SECTION_LIMIT = 12;
const CURATED_FILTER = 'curated';

@Component({
  selector: 'app-podcasts',
  host: {
    class: 'panel-with-sticky-header',
    '(window:resize)': 'updateContainerWidth()',
  },
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    PodcastListFilterComponent,
    PodcastEventComponent,
    PodcastShowEventComponent,
    PodcastSettingsDialogComponent,
    PublishEpisodeDialogComponent,
    EditShowDialogComponent,
  ],
  templateUrl: './podcasts.component.html',
  styleUrl: './podcasts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PodcastsComponent implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private twoColumnLayout = inject(TwoColumnLayoutService);
  private followSetsService = inject(FollowSetsService);
  private layout = inject(LayoutService);
  private podcastData = inject(PodcastDataService);
  private favorites = inject(PodcastFavoritesService);

  readonly loading = this.podcastData.loading;
  readonly isAuthenticated = computed(() => this.app.authenticated());
  readonly urlListFilter = signal<string | undefined>(this.route.snapshot.queryParams['list']);
  readonly selectedListFilter = signal<ListFilterValue>(CURATED_FILTER);
  readonly searchQuery = signal('');
  readonly showSearch = signal(false);
  readonly containerWidth = signal(0);
  readonly showSettingsDialog = signal(false);
  readonly showPublishDialog = signal(false);
  readonly showEditShowDialog = signal(false);

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('podcastsContent') podcastsContent?: ElementRef<HTMLDivElement>;

  private followingPubkeys = computed(() => this.accountState.followingList() || []);
  private currentPubkey = computed(() => this.accountState.pubkey());

  private selectedFollowSet = computed(() => {
    const filter = this.selectedListFilter();
    if (filter === CURATED_FILTER || filter === 'all' || filter === 'following') {
      return null;
    }
    return this.followSetsService.followSets().find(set => set.dTag === filter) || null;
  });

  private filterPubkeys = computed(() => {
    const filter = this.selectedListFilter();
    if (filter === CURATED_FILTER) {
      return this.podcastData.showPubkeys();
    }
    if (filter === 'all') {
      return null;
    }
    if (filter === 'following') {
      return this.followingPubkeys();
    }
    return this.selectedFollowSet()?.pubkeys || [];
  });

  readonly filteredShows = computed(() => {
    const query = this.searchQuery();
    const pubkeys = this.filterPubkeys();
    let shows = this.podcastData.shows().filter(show => showMatchesQuery(show, query));
    if (pubkeys !== null) {
      if (pubkeys.length === 0) {
        return [];
      }
      shows = shows.filter(show => pubkeys.includes(show.pubkey));
    }
    return shows.sort((a, b) => b.created_at - a.created_at);
  });

  readonly filteredEpisodes = computed(() => {
    const query = this.searchQuery();
    const pubkeys = this.filterPubkeys();
    let episodes = this.podcastData.episodes().filter(episode => episodeMatchesQuery(episode, query));
    if (pubkeys !== null) {
      if (pubkeys.length === 0) {
        return [];
      }
      episodes = episodes.filter(episode => pubkeys.includes(episode.pubkey));
    }
    return episodes.sort((a, b) => b.created_at - a.created_at);
  });

  readonly showsPreview = computed(() => this.filteredShows().slice(0, this.calculateCardLimit()));
  readonly episodesPreview = computed(() => this.filteredEpisodes().slice(0, this.calculateCardLimit()));
  readonly hasMoreShows = computed(() => this.filteredShows().length > this.showsPreview().length);
  readonly hasMoreEpisodes = computed(() => this.filteredEpisodes().length > this.episodesPreview().length);
  readonly favoriteCount = computed(() => this.favorites.showPubkeys().length);
  readonly myShow = computed(() => {
    const pubkey = this.currentPubkey();
    return pubkey ? this.podcastData.getShow(pubkey) ?? null : null;
  });
  readonly hasSearchResults = computed(() => this.filteredEpisodes().length > 0 || this.filteredShows().length > 0);
  readonly totalSearchResults = computed(() => this.filteredEpisodes().length + this.filteredShows().length);
  readonly myShowTitle = computed(() => {
    const show = this.myShow();
    return show ? getPodcastTitle(show) || $localize`:@@podcasts.untitledShow:Untitled podcast` : '';
  });
  readonly searchLabel = $localize`:@@podcasts.search:Search podcasts`;
  readonly closeSearchLabel = $localize`:@@podcasts.closeSearch:Close search`;
  readonly searchPlaceholder = $localize`:@@podcasts.searchPlaceholder:Search episodes and shows...`;
  readonly unpublishedShow = $localize`:@@podcasts.unpublishedShow:Publish your show details`;

  constructor() {
    this.twoColumnLayout.setWideLeft();
    void this.initialize();

    if (this.route.snapshot.queryParams['publish'] === 'true') {
      this.showPublishDialog.set(true);
      this.router.navigate([], { queryParams: { publish: undefined }, queryParamsHandling: 'merge', replaceUrl: true });
    }

    effect(() => {
      const filter = this.selectedListFilter();
      if (filter === CURATED_FILTER) {
        untracked(() => this.podcastData.startSubscriptions(null));
        return;
      }

      const pubkeys = this.filterPubkeys();
      untracked(() => this.podcastData.startSubscriptions(pubkeys));
    });

    setTimeout(() => this.updateContainerWidth(), 50);
    setTimeout(() => this.updateContainerWidth(), 400);
  }

  ngOnDestroy(): void {
    this.podcastData.stopSubscriptions();
  }

  private async initialize(): Promise<void> {
    await this.podcastData.ensureInitialized();
    this.podcastData.startSubscriptions(null);
  }

  onListFilterChanged(filter: ListFilterValue): void {
    this.selectedListFilter.set(filter);
  }

  toggleSearch(): void {
    this.showSearch.update(value => !value);
    if (this.showSearch()) {
      setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
    } else {
      this.searchQuery.set('');
    }
  }

  onSearchInput(domEvent: { target: EventTarget | null }): void {
    this.searchQuery.set((domEvent.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  refresh(): void {
    this.podcastData.startSubscriptions(this.selectedListFilter() === CURATED_FILTER ? null : this.filterPubkeys());
  }

  updateContainerWidth(): void {
    if (this.podcastsContent?.nativeElement) {
      this.containerWidth.set(this.podcastsContent.nativeElement.offsetWidth);
    }
  }

  private calculateCardLimit(): number {
    const width = this.containerWidth();
    if (width === 0) {
      return SECTION_LIMIT;
    }
    return Math.max(1, Math.floor((width + 16) / (166)));
  }

  goToEpisodes(): void {
    void this.router.navigate(['/podcasts/episodes'], { queryParams: { list: this.selectedListFilter() } });
  }

  goToShows(): void {
    void this.router.navigate(['/podcasts/shows'], { queryParams: { list: this.selectedListFilter() } });
  }

  goToFavorites(): void {
    this.layout.navigateToRightPanel('podcasts/favorites');
  }

  goToMyShow(): void {
    const pubkey = this.currentPubkey();
    if (pubkey) {
      this.layout.openPodcastShow(pubkey);
    }
  }

  openSettings(): void {
    this.showSettingsDialog.set(true);
  }

  openPublish(): void {
    this.showPublishDialog.set(true);
  }

  openEditShow(): void {
    this.showEditShowDialog.set(true);
  }

  onSettingsClosed(result: { saved: boolean } | null): void {
    this.showSettingsDialog.set(false);
    if (result?.saved) {
      void this.podcastData.ensureInitialized();
      this.refresh();
    }
  }

  onPublishClosed(result: { published: boolean } | null): void {
    this.showPublishDialog.set(false);
    if (result?.published) {
      this.refresh();
    }
  }

  onEditShowClosed(result: { published: boolean } | null): void {
    this.showEditShowDialog.set(false);
    if (result?.published) {
      this.refresh();
    }
  }
}
