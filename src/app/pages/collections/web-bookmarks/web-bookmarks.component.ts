import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
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
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { TrustService } from '../../../services/trust.service';
import { WebBookmark, WebBookmarkService } from '../../../services/web-bookmark.service';
import { SocialPreviewComponent } from '../../../components/social-preview/social-preview.component';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { SaveWebBookmarkDialogComponent, SaveWebBookmarkDialogData } from './save-web-bookmark-dialog.component';

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
export class WebBookmarksComponent {
  readonly webBookmarks = inject(WebBookmarkService);
  private readonly accountState = inject(AccountStateService);
  private readonly customDialog = inject(CustomDialogService);
  private readonly followSets = inject(FollowSetsService);
  private readonly trust = inject(TrustService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly searchQuery = signal('');
  readonly activeTag = signal('');
  readonly sortMode = signal<BookmarkSort>('newest');
  readonly socialScope = signal<SocialScope>('following');
  readonly wotMinRank = signal(1);
  readonly requireWot = signal(true);
  readonly saving = signal(false);

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

    return this.allTags()
      .slice(0, 4)
      .map(tag => ({
        tag,
        items: pool.filter(bookmark => bookmark.tags.includes(tag)).slice(0, 4),
      }))
      .filter(section => section.items.length > 0);
  });

  readonly socialScopeTitle = computed(() => {
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

  getSectionLabel(bookmark: WebBookmark): string {
    return bookmark.authorPubkey === this.accountState.pubkey() ? 'Personal' : this.socialScopeTitle();
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

}
