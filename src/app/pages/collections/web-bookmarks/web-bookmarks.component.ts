import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, PLATFORM_ID, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSliderModule } from '@angular/material/slider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AccountStateService } from '../../../services/account-state.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { DataService } from '../../../services/data.service';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { TrustService } from '../../../services/trust.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { WebBookmark, WebBookmarkService } from '../../../services/web-bookmark.service';
import { NostrRecord } from '../../../interfaces';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { SaveWebBookmarkDialogComponent, SaveWebBookmarkDialogData } from './save-web-bookmark-dialog.component';
import { Subscription } from 'rxjs';

type BookmarkSort = 'newest' | 'oldest' | 'title' | 'domain';
type SocialScope = 'following' | 'wot' | string;

interface BookmarkNewsSection {
  tag: string;
  items: WebBookmark[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-web-bookmarks',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSliderModule,
    MatSnackBarModule,
    MatTooltipModule,
    AgoPipe,
  ],
  templateUrl: './web-bookmarks.component.html',
  styleUrl: './web-bookmarks.component.scss',
})
export class WebBookmarksComponent implements OnDestroy {
  readonly webBookmarks = inject(WebBookmarkService);
  private readonly accountState = inject(AccountStateService);
  private readonly customDialog = inject(CustomDialogService);
  private readonly data = inject(DataService);
  private readonly followSets = inject(FollowSetsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly trust = inject(TrustService);
  private readonly utilities = inject(UtilitiesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly searchQuery = signal('');
  readonly showSearch = signal(false);
  readonly activeTag = signal('');
  readonly sortMode = signal<BookmarkSort>('newest');
  readonly socialScope = signal<SocialScope>('following');
  readonly wotMinRank = signal(1);
  readonly requireWot = signal(false);
  readonly saving = signal(false);
  readonly visibleArticleCount = signal(12);
  readonly discoveringMore = signal(false);
  readonly publicDiscoveryExhausted = signal(false);
  readonly reviewPubkey = signal('');
  readonly reviewOwnerName = signal('');
  readonly profileNames = signal(new Map<string, string>());
  readonly profileImages = signal(new Map<string, string>());

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('feedSentinel') set feedSentinel(element: ElementRef<HTMLElement> | undefined) {
    this.feedSentinelElement = element;
    this.observeFeedSentinel();
  }

  private feedObserver?: IntersectionObserver;
  private feedSentinelElement?: ElementRef<HTMLElement>;
  private routeSubscription?: Subscription;

  readonly trustEnabled = computed(() => this.trust.isEnabled());
  readonly followSetOptions = computed(() => [...this.followSets.followSets()].sort((a, b) => a.title.localeCompare(b.title)));
  readonly isPersonalizedReview = computed(() => !!this.reviewPubkey());

  readonly reviewBookmarks = computed(() => {
    const pubkey = this.reviewPubkey();
    if (!pubkey) {
      return [];
    }

    if (pubkey === this.accountState.pubkey()) {
      return this.webBookmarks.personalBookmarks();
    }

    return this.webBookmarks.socialBookmarks().filter(bookmark => bookmark.authorPubkey === pubkey);
  });

  readonly sourceBookmarks = computed(() => this.reviewPubkey()
    ? this.reviewBookmarks()
    : [
      ...this.webBookmarks.personalBookmarks(),
      ...this.webBookmarks.socialBookmarks(),
    ]);

  readonly personalTags = computed(() => this.uniqueTags(this.reviewPubkey()
    ? this.reviewBookmarks()
    : this.webBookmarks.personalBookmarks()));
  readonly socialTags = computed(() => this.uniqueTags(this.reviewPubkey() ? [] : this.webBookmarks.socialBookmarks()));
  readonly allTags = computed(() => this.uniqueTags(this.sourceBookmarks()));

  readonly personalBookmarks = computed(() => this.applyFilters(
    this.reviewPubkey() ? this.reviewBookmarks() : this.webBookmarks.personalBookmarks(),
    false
  ));
  readonly socialBookmarks = computed(() => {
    if (this.reviewPubkey()) {
      return [];
    }

    const currentPubkey = this.accountState.pubkey();
    return this.applyFilters(
      this.webBookmarks.socialBookmarks().filter(bookmark => bookmark.authorPubkey !== currentPubkey),
      true
    );
  });

  readonly featuredPersonal = computed(() => this.personalBookmarks()[0] ?? null);
  readonly featuredSocial = computed(() => this.socialBookmarks()[0] ?? null);
  readonly leadBookmark = computed(() => this.featuredSocial() ?? this.featuredPersonal());
  readonly secondaryBookmarks = computed(() => {
    const leadId = this.leadBookmark()?.id;
    return [
      ...this.socialBookmarks(),
      ...this.personalBookmarks(),
    ]
      .filter(bookmark => bookmark.id !== leadId)
      .slice(0, 4);
  });
  readonly newsSections = computed<BookmarkNewsSection[]>(() => {
    const pool = [
      ...this.socialBookmarks(),
      ...this.personalBookmarks(),
    ];
    const tags = this.activeTag() ? [this.activeTag()] : this.allTags().slice(0, 4);

    return tags
      .map(tag => ({
        tag,
        items: pool.filter(bookmark => bookmark.tags.includes(tag)).slice(0, 4),
      }))
      .filter(section => section.items.length > 0);
  });
  readonly feedBookmarks = computed(() => {
    const frontPageIds = new Set([
      this.leadBookmark()?.id,
      ...this.secondaryBookmarks().map(bookmark => bookmark.id),
      ...this.personalBookmarks().slice(0, 3).map(bookmark => bookmark.id),
    ].filter((id): id is string => !!id));

    return this.sortBookmarks([
      ...this.socialBookmarks(),
      ...this.personalBookmarks(),
    ].filter(bookmark => !frontPageIds.has(bookmark.id)));
  });
  readonly visibleFeedBookmarks = computed(() => this.feedBookmarks().slice(0, this.visibleArticleCount()));
  readonly hasMoreFeedBookmarks = computed(() => this.visibleArticleCount() < this.feedBookmarks().length);
  readonly canDiscoverMoreBookmarks = computed(() => this.socialScope() === 'public' && !this.publicDiscoveryExhausted());
  readonly headerSubtitle = computed(() => this.reviewPubkey()
    ? `${this.personalBookmarks().length} bookmarks`
    : `${this.personalBookmarks().length} personal · ${this.socialBookmarks().length} social`);
  readonly mastheadTitle = computed(() => this.reviewPubkey()
    ? `${this.reviewOwnerName() || this.truncatedPubkey(this.reviewPubkey())}'s Bookmark Review`
    : 'The Bookmark Review');
  readonly mastheadDescription = computed(() => this.reviewPubkey()
    ? `A personalized edition of saved web bookmarks from ${this.reviewOwnerName() || 'this user'}.`
    : 'Personal links, trusted recommendations, and public web finds.');
  readonly briefingTitle = computed(() => this.reviewPubkey() ? 'Bookmark Desk' : 'Personal Desk');
  readonly emptyDeskMessage = computed(() => this.reviewPubkey()
    ? 'No bookmarks found for this review yet.'
    : 'Your saved links will appear here.');
  readonly loadingDesk = computed(() => this.reviewPubkey() && this.reviewPubkey() !== this.accountState.pubkey()
    ? this.webBookmarks.loadingSocial()
    : this.webBookmarks.loadingPersonal());

  readonly socialScopeTitle = computed(() => {
    if (this.reviewPubkey()) {
      return this.reviewOwnerName() || 'Personalized';
    }

    const scope = this.socialScope();
    if (scope === 'following') {
      return 'Following';
    }
    if (scope === 'wot') {
      return 'Web of Trust';
    }
    if (scope === 'public') {
      return 'Public relays';
    }
    return this.followSetOptions().find(set => set.dTag === scope)?.title || 'People list';
  });

  readonly hasActiveFilters = computed(() => {
    return !!this.searchQuery().trim()
      || !!this.activeTag()
      || this.sortMode() !== 'newest'
      || this.socialScope() !== 'following'
      || this.wotMinRank() !== 1
      || this.requireWot();
  });

  constructor() {
    this.routeSubscription = this.route.paramMap.subscribe(params => {
      const pubkey = this.normalizeRoutePubkey(params.get('pubkey'));
      this.reviewPubkey.set(pubkey);
      this.reviewOwnerName.set(pubkey ? this.profileNames().get(pubkey) || this.truncatedPubkey(pubkey) : '');
      if (pubkey) {
        void this.loadProfileName(pubkey, true);
      }
    });

    effect(() => {
      void this.webBookmarks.loadPersonal();
    });

    effect(() => {
      this.socialScope();
      this.wotMinRank();
      this.requireWot();
      this.followSetOptions();
      this.accountState.followingList();
      this.reviewPubkey();
      void this.reloadSocial();
    });

    effect(() => {
      const pubkeys = [...new Set(this.webBookmarks.socialBookmarks().map(item => item.authorPubkey))];
      if (pubkeys.length > 0 && this.trustEnabled()) {
        void this.trust.fetchMetricsBatch(pubkeys);
      }
    });

    effect(() => {
      const pubkeys = [...new Set(this.sourceBookmarks().map(item => item.authorPubkey))].slice(0, 80);
      if (pubkeys.length > 0) {
        void this.loadProfileNames(pubkeys);
      }
    });

    effect(() => {
      this.activeTag();
      this.searchQuery();
      this.sortMode();
      this.socialScope();
      this.visibleArticleCount.set(12);
      this.publicDiscoveryExhausted.set(false);
    });
  }

  ngOnDestroy(): void {
    this.feedObserver?.disconnect();
    this.routeSubscription?.unsubscribe();
  }

  async reload(): Promise<void> {
    await Promise.all([
      this.webBookmarks.loadPersonal(),
      this.reloadSocial(),
    ]);
  }

  openSaveDialog(bookmark?: WebBookmark): void {
    const dialogRef = this.customDialog.open<SaveWebBookmarkDialogComponent, boolean>(
      SaveWebBookmarkDialogComponent,
      {
        title: bookmark ? 'Edit Social Bookmark' : 'Save a URL',
        headerIcon: bookmark ? 'edit' : 'add_link',
        width: '920px',
        maxWidth: 'calc(100vw - 32px)',
        data: { bookmark } satisfies SaveWebBookmarkDialogData,
        panelClass: 'save-web-bookmark-dialog',
      }
    );

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result) {
        void this.reload();
      }
    });
  }

  editBookmark(bookmark: WebBookmark): void {
    this.openSaveDialog(bookmark);
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

  openUserReview(bookmark: WebBookmark): void {
    const npub = this.utilities.getNpubFromPubkey(bookmark.authorPubkey);
    void this.router.navigate(['/collections/web', npub]);
  }

  openMainReview(): void {
    void this.router.navigate(['/collections/web']);
  }

  bookmarkReviewLabel(bookmark: WebBookmark): string {
    const name = this.bookmarkAuthorName(bookmark);
    return name === 'You' ? 'Your Bookmark Review' : `${name}'s Bookmark Review`;
  }

  bookmarkAuthorName(bookmark: WebBookmark): string {
    return this.bookmarkAuthorNameFromPubkey(bookmark.authorPubkey);
  }

  bookmarkReviewImage(bookmark: WebBookmark): string {
    return this.profileImages().get(bookmark.authorPubkey) || '';
  }

  getSectionLabel(bookmark: WebBookmark): string {
    return bookmark.authorPubkey === this.accountState.pubkey() ? 'Personal' : this.socialScopeTitle();
  }

  isOwnBookmark(bookmark: WebBookmark): boolean {
    return bookmark.authorPubkey === this.accountState.pubkey();
  }

  setActiveTag(tag: string): void {
    this.activeTag.set(this.activeTag() === tag ? '' : tag);
  }

  async showMoreBookmarks(): Promise<void> {
    if (this.visibleArticleCount() < this.feedBookmarks().length) {
      this.visibleArticleCount.update(count => Math.min(count + 12, this.feedBookmarks().length));
      return;
    }

    await this.discoverMoreBookmarks();
  }

  toggleSearch(): void {
    const shouldShow = !this.showSearch();
    this.showSearch.set(shouldShow);

    if (shouldShow) {
      setTimeout(() => this.searchInput?.nativeElement.focus(), 50);
    } else {
      this.searchQuery.set('');
    }
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.searchInput?.nativeElement.focus();
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.searchQuery.set(input?.value ?? '');
  }

  resetFilters(): void {
    this.searchQuery.set('');
    this.showSearch.set(false);
    this.activeTag.set('');
    this.sortMode.set('newest');
    this.socialScope.set('following');
    this.wotMinRank.set(1);
    this.requireWot.set(false);
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
    const reviewPubkey = this.reviewPubkey();
    if (reviewPubkey) {
      if (reviewPubkey !== this.accountState.pubkey()) {
        await this.webBookmarks.loadSocial([reviewPubkey]);
      }
      return;
    }

    if (this.socialScope() === 'public') {
      await this.webBookmarks.loadPublic();
      return;
    }

    const authors = await this.resolveSocialAuthors();
    await this.webBookmarks.loadSocial(authors);
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
    const requireWot = applyTrustFilter && this.socialScope() !== 'public' && this.requireWot() && this.trustEnabled();
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

    return this.sortBookmarks(filtered);
  }

  private sortBookmarks(items: WebBookmark[]): WebBookmark[] {
    return [...items].sort((left, right) => {
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

  private observeFeedSentinel(): void {
    if (!this.isBrowser) {
      return;
    }

    this.feedObserver?.disconnect();
    if (!this.feedSentinelElement) {
      return;
    }

    this.feedObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        void this.showMoreBookmarks();
      }
    }, { rootMargin: '600px 0px' });
    this.feedObserver.observe(this.feedSentinelElement.nativeElement);
  }

  private normalizeRoutePubkey(value: string | null): string {
    if (!value) {
      return '';
    }

    if (this.utilities.isValidHexPubkey(value)) {
      return value;
    }

    if (value.startsWith('npub1')) {
      try {
        const pubkey = this.utilities.getPubkeyFromNpub(value);
        return this.utilities.isValidHexPubkey(pubkey) ? pubkey : '';
      } catch {
        return '';
      }
    }

    return '';
  }

  private async loadProfileNames(pubkeys: string[]): Promise<void> {
    await Promise.all(pubkeys.map(pubkey => this.loadProfileName(pubkey, false)));
  }

  private async loadProfileName(pubkey: string, updateReviewOwner: boolean): Promise<void> {
    const cached = this.data.getCachedProfile(pubkey);
    if (cached) {
      this.setProfileName(pubkey, cached, updateReviewOwner);
      return;
    }

    try {
      const profile = await this.data.getProfile(pubkey);
      if (profile) {
        this.setProfileName(pubkey, profile, updateReviewOwner);
      }
    } catch {
      // Profile names are decorative; fall back to npub if loading fails.
    }
  }

  private setProfileName(pubkey: string, profile: NostrRecord, updateReviewOwner: boolean): void {
    const name = this.displayNameFromProfile(profile) || this.truncatedPubkey(pubkey);
    const image = this.profileImageFromProfile(profile);
    this.profileNames.update(current => {
      const next = new Map(current);
      next.set(pubkey, name);
      return next;
    });
    this.profileImages.update(current => {
      const next = new Map(current);
      if (image) {
        next.set(pubkey, image);
      } else {
        next.delete(pubkey);
      }
      return next;
    });

    if (updateReviewOwner && this.reviewPubkey() === pubkey) {
      this.reviewOwnerName.set(name);
    }
  }

  private displayNameFromProfile(profile: NostrRecord | undefined): string {
    const data = profile?.data;
    if (!data || typeof data !== 'object') {
      return '';
    }

    const displayName = typeof data.display_name === 'string' ? data.display_name.trim() : '';
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    return displayName || name;
  }

  private profileImageFromProfile(profile: NostrRecord | undefined): string {
    const data = profile?.data;
    if (!data || typeof data !== 'object') {
      return '';
    }

    const picture = typeof data.picture === 'string' ? data.picture.trim() : '';
    const image = typeof data.image === 'string' ? data.image.trim() : '';
    return picture || image;
  }

  private bookmarkAuthorNameFromPubkey(pubkey: string): string {
    if (pubkey === this.accountState.pubkey()) {
      return 'You';
    }

    return this.profileNames().get(pubkey) || this.truncatedPubkey(pubkey);
  }

  private truncatedPubkey(pubkey: string): string {
    if (!pubkey) {
      return 'Someone';
    }

    try {
      return this.utilities.getTruncatedNpub(pubkey);
    } catch {
      return `${pubkey.slice(0, 8)}...`;
    }
  }

  private async discoverMoreBookmarks(): Promise<void> {
    if (this.socialScope() !== 'public' || this.discoveringMore() || this.publicDiscoveryExhausted()) {
      return;
    }

    const oldestCreatedAt = Math.min(...this.webBookmarks.socialBookmarks().map(bookmark => bookmark.createdAt));
    if (!Number.isFinite(oldestCreatedAt)) {
      this.publicDiscoveryExhausted.set(true);
      return;
    }

    this.discoveringMore.set(true);
    try {
      const addedCount = await this.webBookmarks.loadMorePublic(oldestCreatedAt - 1);
      this.publicDiscoveryExhausted.set(addedCount === 0);
      this.visibleArticleCount.update(count => Math.min(count + 12, this.feedBookmarks().length));
    } finally {
      this.discoveringMore.set(false);
    }
  }

  private uniqueTags(items: WebBookmark[]): string[] {
    return [...new Set(items.flatMap(item => item.tags))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

}
