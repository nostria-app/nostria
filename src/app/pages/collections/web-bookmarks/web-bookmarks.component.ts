import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSliderModule } from '@angular/material/slider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AccountStateService } from '../../../services/account-state.service';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { OpenGraphService } from '../../../services/opengraph.service';
import { TrustService } from '../../../services/trust.service';
import { WebBookmark, WebBookmarkService } from '../../../services/web-bookmark.service';
import { SocialPreviewComponent } from '../../../components/social-preview/social-preview.component';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { AgoPipe } from '../../../pipes/ago.pipe';

type BookmarkSort = 'newest' | 'oldest' | 'title' | 'domain';
type SocialScope = 'following' | 'wot' | string;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-web-bookmarks',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSliderModule,
    MatSnackBarModule,
    MatTooltipModule,
    SocialPreviewComponent,
    UserProfileComponent,
    AgoPipe,
  ],
  templateUrl: './web-bookmarks.component.html',
  styleUrl: './web-bookmarks.component.scss',
})
export class WebBookmarksComponent implements OnDestroy {
  readonly webBookmarks = inject(WebBookmarkService);
  private readonly accountState = inject(AccountStateService);
  private readonly followSets = inject(FollowSetsService);
  private readonly openGraph = inject(OpenGraphService);
  private readonly trust = inject(TrustService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private previewLookupTimer: ReturnType<typeof setTimeout> | null = null;
  private previewLookupToken = 0;

  readonly urlInput = signal('');
  readonly titleInput = signal('');
  readonly descriptionInput = signal('');
  readonly tagsInput = signal('');
  readonly searchQuery = signal('');
  readonly activeTag = signal('');
  readonly sortMode = signal<BookmarkSort>('newest');
  readonly socialScope = signal<SocialScope>('following');
  readonly wotMinRank = signal(1);
  readonly requireWot = signal(true);
  readonly composerExpanded = signal(true);
  readonly saving = signal(false);
  readonly previewLoading = signal(false);
  readonly previewHint = signal('');

  readonly trustEnabled = computed(() => this.trust.isEnabled());
  readonly followSetOptions = computed(() => [...this.followSets.followSets()].sort((a, b) => a.title.localeCompare(b.title)));

  readonly personalTags = computed(() => this.uniqueTags(this.webBookmarks.personalBookmarks()));
  readonly socialTags = computed(() => this.uniqueTags(this.webBookmarks.socialBookmarks()));
  readonly allTags = computed(() => this.uniqueTags([
    ...this.webBookmarks.personalBookmarks(),
    ...this.webBookmarks.socialBookmarks(),
  ]));

  readonly personalBookmarks = computed(() => this.applyFilters(this.webBookmarks.personalBookmarks(), false));
  readonly socialBookmarks = computed(() => {
    const currentPubkey = this.accountState.pubkey();
    return this.applyFilters(
      this.webBookmarks.socialBookmarks().filter(bookmark => bookmark.authorPubkey !== currentPubkey),
      true
    );
  });

  readonly featuredPersonal = computed(() => this.personalBookmarks()[0] ?? null);
  readonly featuredSocial = computed(() => this.socialBookmarks()[0] ?? null);

  readonly socialScopeTitle = computed(() => {
    const scope = this.socialScope();
    if (scope === 'following') {
      return 'Following';
    }
    if (scope === 'wot') {
      return 'Web of Trust';
    }
    return this.followSetOptions().find(set => set.dTag === scope)?.title || 'People list';
  });

  readonly hasActiveFilters = computed(() => {
    return !!this.searchQuery().trim()
      || !!this.activeTag()
      || this.sortMode() !== 'newest'
      || this.socialScope() !== 'following'
      || this.wotMinRank() !== 1
      || !this.requireWot();
  });

  constructor() {
    effect(() => {
      void this.webBookmarks.loadPersonal();
    });

    effect(() => {
      this.socialScope();
      this.wotMinRank();
      this.requireWot();
      this.followSetOptions();
      void this.reloadSocial();
    });

    effect(() => {
      const pubkeys = [...new Set(this.webBookmarks.socialBookmarks().map(item => item.authorPubkey))];
      if (pubkeys.length > 0 && this.trustEnabled()) {
        void this.trust.fetchMetricsBatch(pubkeys);
      }
    });
  }

  ngOnDestroy(): void {
    this.cancelPreviewLookup();
  }

  onUrlInputChange(value: string): void {
    this.urlInput.set(value);
    this.schedulePreviewLookup(value);
  }

  async reload(): Promise<void> {
    await Promise.all([
      this.webBookmarks.loadPersonal(),
      this.reloadSocial(),
    ]);
  }

  async saveBookmark(): Promise<void> {
    if (this.saving()) {
      return;
    }

    const url = this.urlInput().trim();
    if (!url) {
      this.snackBar.open('Add a URL first', 'Close', { duration: 2500 });
      return;
    }

    this.saving.set(true);
    try {
      const success = await this.webBookmarks.saveBookmark({
        url,
        title: this.titleInput(),
        description: this.descriptionInput(),
        tags: this.parseTags(this.tagsInput()),
      });

      if (!success) {
        this.snackBar.open('Could not publish bookmark', 'Close', { duration: 3500 });
        return;
      }

      this.clearComposer();
      this.snackBar.open('Social bookmark published', 'Close', { duration: 2500 });
    } finally {
      this.saving.set(false);
    }
  }

  editBookmark(bookmark: WebBookmark): void {
    this.cancelPreviewLookup();
    this.urlInput.set(bookmark.url);
    this.titleInput.set(bookmark.title);
    this.descriptionInput.set(bookmark.description);
    this.tagsInput.set(bookmark.tags.join(', '));
    this.composerExpanded.set(true);
  }

  async deleteBookmark(bookmark: WebBookmark): Promise<void> {
    const success = await this.webBookmarks.deleteBookmark(bookmark);
    if (success) {
      this.snackBar.open('Social bookmark deleted', 'Close', { duration: 2500 });
    }
  }

  async saveSocialBookmark(bookmark: WebBookmark): Promise<void> {
    this.saving.set(true);
    try {
      const success = await this.webBookmarks.saveBookmark({
        url: bookmark.url,
        title: bookmark.title,
        description: bookmark.description,
        tags: bookmark.tags,
      });
      this.snackBar.open(success ? 'Saved to your social bookmarks' : 'Could not save bookmark', 'Close', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  openBookmark(bookmark: WebBookmark): void {
    if (!this.isBrowser) {
      return;
    }

    window.open(bookmark.url, '_blank', 'noopener,noreferrer');
  }

  copyUrl(bookmark: WebBookmark): void {
    if (!this.isBrowser || !navigator.clipboard) {
      return;
    }

    navigator.clipboard.writeText(bookmark.url).then(() => {
      this.snackBar.open('URL copied', 'Close', { duration: 1800 });
    });
  }

  setActiveTag(tag: string): void {
    this.activeTag.set(this.activeTag() === tag ? '' : tag);
  }

  resetFilters(): void {
    this.searchQuery.set('');
    this.activeTag.set('');
    this.sortMode.set('newest');
    this.socialScope.set('following');
    this.wotMinRank.set(1);
    this.requireWot.set(true);
  }

  getTrustRank(pubkey: string): number | undefined {
    return this.trust.getRankSignal(pubkey);
  }

  getSortLabel(): string {
    switch (this.sortMode()) {
      case 'oldest':
        return 'Oldest';
      case 'title':
        return 'Title';
      case 'domain':
        return 'Domain';
      default:
        return 'Newest';
    }
  }

  private async reloadSocial(): Promise<void> {
    const authors = await this.resolveSocialAuthors();
    await this.webBookmarks.loadSocial(authors);
  }

  private schedulePreviewLookup(value: string): void {
    const token = ++this.previewLookupToken;
    this.previewHint.set('');

    if (this.previewLookupTimer) {
      clearTimeout(this.previewLookupTimer);
      this.previewLookupTimer = null;
    }

    const normalized = this.webBookmarks.normalizeUrl(value);
    if (!normalized) {
      this.previewLoading.set(false);
      return;
    }

    this.previewLookupTimer = setTimeout(() => {
      void this.loadPreviewMetadata(normalized.url, token);
    }, 550);
  }

  private async loadPreviewMetadata(url: string, token: number): Promise<void> {
    this.previewLoading.set(true);

    try {
      const preview = await this.openGraph.getOpenGraphData(url);
      const currentUrl = this.webBookmarks.normalizeUrl(this.urlInput())?.url;
      if (token !== this.previewLookupToken || currentUrl !== url || preview.error) {
        return;
      }

      const title = preview.title?.trim();
      const description = preview.description?.trim();
      let hydrated = false;

      if (title && !this.titleInput().trim()) {
        this.titleInput.set(title);
        hydrated = true;
      }

      if (description && !this.descriptionInput().trim()) {
        this.descriptionInput.set(description);
        hydrated = true;
      }

      if (hydrated) {
        this.previewHint.set('Link details added');
      }
    } finally {
      if (token === this.previewLookupToken) {
        this.previewLoading.set(false);
      }
    }
  }

  private cancelPreviewLookup(): void {
    this.previewLookupToken++;
    this.previewLoading.set(false);
    this.previewHint.set('');

    if (this.previewLookupTimer) {
      clearTimeout(this.previewLookupTimer);
      this.previewLookupTimer = null;
    }
  }

  private clearComposer(): void {
    this.cancelPreviewLookup();
    this.urlInput.set('');
    this.titleInput.set('');
    this.descriptionInput.set('');
    this.tagsInput.set('');
  }

  private async resolveSocialAuthors(): Promise<string[]> {
    const scope = this.socialScope();

    if (scope === 'wot') {
      const trusted = await this.trust.getPubkeysByTrustRank(this.wotMinRank());
      return trusted.slice(0, 160);
    }

    if (scope !== 'following') {
      const set = this.followSetOptions().find(item => item.dTag === scope);
      if (set) {
        return set.pubkeys;
      }
    }

    return this.accountState.followingList();
  }

  private applyFilters(items: WebBookmark[], applyTrustFilter: boolean): WebBookmark[] {
    const query = this.searchQuery().trim().toLowerCase();
    const tag = this.activeTag();
    const requireWot = applyTrustFilter && this.requireWot() && this.trustEnabled();
    const minRank = this.wotMinRank();

    const filtered = items.filter(item => {
      if (tag && !item.tags.includes(tag)) {
        return false;
      }

      if (requireWot) {
        const rank = this.trust.getRankSignal(item.authorPubkey);
        if (typeof rank !== 'number' || rank < minRank) {
          return false;
        }
      }

      if (!query) {
        return true;
      }

      return item.title.toLowerCase().includes(query)
        || item.description.toLowerCase().includes(query)
        || item.domain.toLowerCase().includes(query)
        || item.tags.some(itemTag => itemTag.includes(query));
    });

    return [...filtered].sort((left, right) => {
      switch (this.sortMode()) {
        case 'oldest':
          return left.publishedAt - right.publishedAt;
        case 'title':
          return left.title.localeCompare(right.title);
        case 'domain':
          return left.domain.localeCompare(right.domain) || right.publishedAt - left.publishedAt;
        default:
          return right.publishedAt - left.publishedAt;
      }
    });
  }

  private uniqueTags(items: WebBookmark[]): string[] {
    return [...new Set(items.flatMap(item => item.tags))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  private parseTags(value: string): string[] {
    return [...new Set(
      value
        .split(/[,#\s]+/)
        .map(tag => tag.trim().toLowerCase())
        .filter(Boolean)
    )];
  }
}
