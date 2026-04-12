import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Event, kinds, nip19 } from 'nostr-tools';
import { MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BookmarkList, BookmarkService } from '../../services/bookmark.service';
import { DatabaseService } from '../../services/database.service';
import { AccountStateService } from '../../services/account-state.service';
import { UserRelayService } from '../../services/relays/user-relay';
import { AccountRelayService } from '../../services/relays/account-relay';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { MaterialCustomDialogComponent } from '../material-custom-dialog/material-custom-dialog.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import { getKindLabel } from '../../utils/kind-labels';

export interface ArticleReferencePickerResult {
  references: string[];
}

type EventKindFilter = 'all' | 'articles' | 'notes' | 'media' | 'other';

@Component({
  selector: 'app-article-reference-picker-dialog',
  imports: [
    FormsModule,
    MaterialCustomDialogComponent,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
    UserProfileComponent,
    AgoPipe,
  ],
  templateUrl: './article-reference-picker-dialog.component.html',
  styleUrl: './article-reference-picker-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleReferencePickerDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ArticleReferencePickerDialogComponent, ArticleReferencePickerResult>, { optional: true });

  private readonly database = inject(DatabaseService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly bookmarkService = inject(BookmarkService);
  private readonly accountState = inject(AccountStateService);
  private readonly userRelayService = inject(UserRelayService);
  private readonly accountRelay = inject(AccountRelayService);

  readonly query = signal('');
  readonly pastedReference = signal('');
  readonly activeTabIndex = signal(0);
  readonly profilesLoading = signal(false);
  readonly eventsLoading = signal(false);
  readonly myArticlesLoading = signal(false);
  readonly eventKindFilter = signal<EventKindFilter>('all');

  private readonly profileSearchResults = signal<Event[]>([]);
  private readonly eventSearchResults = signal<Event[]>([]);
  private readonly myArticleResults = signal<Event[]>([]);
  private readonly authorNameCache = new Map<string, string>();
  private readonly SEARCH_DEBOUNCE_MS = 250;
  private readonly MAX_SEARCH_RESULTS = 200;
  private readonly RECENT_POST_LIMIT = 5;
  private readonly POSTS_TAB_INDEX = 1;
  private readonly MY_ARTICLES_TAB_INDEX = 2;
  private readonly PROFILES_TAB_INDEX = 3;
  private searchDebounceTimer?: ReturnType<typeof setTimeout>;
  private activeSearchToken = 0;

  readonly bookmarkLists = this.bookmarkService.allBookmarkLists;

  readonly filteredProfiles = computed(() => this.profileSearchResults());

  readonly filteredEvents = computed(() => {
    const events = this.eventSearchResults();
    const filter = this.eventKindFilter();
    if (filter === 'all') {
      return events;
    }
    return events.filter((event) => this.matchesKindFilter(event, filter));
  });

  readonly myArticles = computed(() => this.myArticleResults());

  readonly isLoggedIn = computed(() => !!this.accountState.pubkey());

  onSearchQueryChange(value: string): void {
    this.query.set(value);
    this.scheduleSearchForActiveTab();
  }

  onTabIndexChange(index: number): void {
    this.activeTabIndex.set(index);
    if (index === this.MY_ARTICLES_TAB_INDEX) {
      this.loadMyArticles();
    } else {
      this.scheduleSearchForActiveTab();
    }
  }

  onEventKindFilterChange(filter: EventKindFilter): void {
    this.eventKindFilter.set(filter);
  }

  private loadMyArticles(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return;
    }
    if (this.myArticleResults().length > 0) {
      return;
    }
    this.myArticlesLoading.set(true);
    const token = ++this.activeSearchToken;

    void (async () => {
      try {
        // First, load from local DB for instant results
        const dbEvents = await this.database.getEventsByKind(kinds.LongFormArticle);
        if (token !== this.activeSearchToken) {
          return;
        }

        for (const event of dbEvents) {
          if (event.pubkey === pubkey) {
            const dTag = event.tags.find((t) => t[0] === 'd')?.[1] || event.id;
            const existing = this.allMyArticles.get(dTag);
            if (!existing || event.created_at > existing.created_at) {
              this.allMyArticles.set(dTag, event);
            }
          }
        }

        this.setMyArticleResults(Array.from(this.allMyArticles.values()), token);

        // Then, fetch from relays to get latest articles
        try {
          const relayEvents = await this.userRelayService.query(pubkey, {
            kinds: [kinds.LongFormArticle],
            authors: [pubkey],
            limit: 50,
          });

          if (token !== this.activeSearchToken || !relayEvents) {
            return;
          }

          // Merge relay results with DB results
          for (const event of relayEvents) {
            if (event.pubkey === pubkey) {
              const dTag = event.tags.find((t) => t[0] === 'd')?.[1] || event.id;
              const existing = this.allMyArticles.get(dTag);
              if (!existing || event.created_at > existing.created_at) {
                this.allMyArticles.set(dTag, event);
              }
            }
          }

          this.setMyArticleResults(Array.from(this.allMyArticles.values()), token);
        } catch {
          // Relay fetch failed - that's fine, we already have DB results
        }
      } catch (error) {
        if (token === this.activeSearchToken) {
          this.myArticleResults.set([]);
          this.snackBar.open('Failed to load your articles', 'Close', { duration: 3000 });
          console.error('Failed to load articles:', error);
        }
      } finally {
        if (token === this.activeSearchToken) {
          this.myArticlesLoading.set(false);
        }
      }
    })();
  }

  private setMyArticleResults(articles: Event[], token: number): void {
    if (token !== this.activeSearchToken) {
      return;
    }

    const sorted = articles
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, this.MAX_SEARCH_RESULTS);

    const q = this.query().trim().toLowerCase();
    if (q) {
      this.myArticleResults.set(
        sorted.filter((event) => {
          const title = this.getEventTitle(event).toLowerCase();
          const content = (event.content || '').slice(0, 500).toLowerCase();
          const summary = this.getEventSummary(event).toLowerCase();
          return title.includes(q) || content.includes(q) || summary.includes(q);
        }),
      );
    } else {
      this.myArticleResults.set(sorted);
    }
  }

  private scheduleSearchForActiveTab(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = undefined;
    }

    const tabIndex = this.activeTabIndex();
    const q = this.query().trim();

    // My Articles tab: re-filter loaded articles
    if (tabIndex === this.MY_ARTICLES_TAB_INDEX) {
      if (this.myArticleResults().length > 0 || this.myArticlesLoading()) {
        this.loadMyArticlesFiltered();
      } else {
        this.loadMyArticles();
      }
      return;
    }

    if (tabIndex === this.POSTS_TAB_INDEX && !q) {
      void this.loadRecentPosts();
      return;
    }

    if (tabIndex !== this.POSTS_TAB_INDEX && tabIndex !== this.PROFILES_TAB_INDEX) {
      return;
    }

    if (!q) {
      if (tabIndex === this.PROFILES_TAB_INDEX) {
        this.profileSearchResults.set([]);
        this.profilesLoading.set(false);
      }
      if (tabIndex === this.POSTS_TAB_INDEX) {
        this.eventSearchResults.set([]);
        this.eventsLoading.set(false);
      }
      return;
    }

    this.searchDebounceTimer = setTimeout(() => {
      void this.searchActiveTab(q, tabIndex);
    }, this.SEARCH_DEBOUNCE_MS);
  }

  private readonly allMyArticles = new Map<string, Event>();

  private async loadRecentPosts(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.eventSearchResults.set([]);
      this.eventsLoading.set(false);
      return;
    }

    const token = ++this.activeSearchToken;
    this.eventsLoading.set(true);

    try {
      const ownEvents = await this.database.getEventsByPubkey(pubkey);
      if (token !== this.activeSearchToken) {
        return;
      }

      const recentPosts = this.getDisplayableEvents(ownEvents).slice(0, this.RECENT_POST_LIMIT);
      this.eventSearchResults.set(recentPosts);
      void this.resolveAuthorNames(recentPosts.map((event) => event.pubkey));
    } catch (error) {
      if (token === this.activeSearchToken) {
        this.eventSearchResults.set([]);
        this.snackBar.open('Failed to load your recent posts', 'Close', { duration: 3000 });
        console.error('Failed to load recent posts:', error);
      }
    } finally {
      if (token === this.activeSearchToken) {
        this.eventsLoading.set(false);
      }
    }
  }

  private loadMyArticlesFiltered(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      return;
    }

    // If we already have cached articles, just re-filter
    if (this.allMyArticles.size > 0) {
      const token = this.activeSearchToken;
      this.setMyArticleResults(Array.from(this.allMyArticles.values()), token);
      return;
    }

    // Otherwise, do a full load
    this.loadMyArticles();
  }

  private async searchActiveTab(query: string, tabIndex: number): Promise<void> {
    const token = ++this.activeSearchToken;

    if (tabIndex === this.PROFILES_TAB_INDEX) {
      this.profilesLoading.set(true);

      try {
        const profileEvents = await this.database.getEventsByKind(0);
        if (token !== this.activeSearchToken) {
          return;
        }

        this.profileSearchResults.set(this.filterProfiles(profileEvents, query));
      } catch (error) {
        if (token === this.activeSearchToken) {
          this.profileSearchResults.set([]);
          this.snackBar.open('Failed to search cached profiles', 'Close', { duration: 3000 });
          console.error('Failed to search cached profiles:', error);
        }
      } finally {
        if (token === this.activeSearchToken) {
          this.profilesLoading.set(false);
        }
      }
      return;
    }

    if (tabIndex === this.POSTS_TAB_INDEX) {
      this.eventsLoading.set(true);

      try {
        const allEvents = await this.database.getAllEvents();
        if (token !== this.activeSearchToken) {
          return;
        }

        const filtered = this.filterEvents(allEvents, query);
        this.eventSearchResults.set(filtered);

        // Resolve author names in the background
        void this.resolveAuthorNames(filtered.map((e) => e.pubkey));
      } catch (error) {
        if (token === this.activeSearchToken) {
          this.eventSearchResults.set([]);
          this.snackBar.open('Failed to search cached events', 'Close', { duration: 3000 });
          console.error('Failed to search cached events:', error);
        }
      } finally {
        if (token === this.activeSearchToken) {
          this.eventsLoading.set(false);
        }
      }
    }
  }

  private filterProfiles(events: Event[], query: string): Event[] {
    const q = query.trim().toLowerCase();
    const latestProfilesByPubkey = new Map<string, Event>();

    for (const event of events) {
      const current = latestProfilesByPubkey.get(event.pubkey);
      if (!current || event.created_at > current.created_at) {
        latestProfilesByPubkey.set(event.pubkey, event);
      }
    }

    return Array.from(latestProfilesByPubkey.values())
      .filter((event) => {
        const metadata = this.parseProfileMetadata(event.content);
        return (
          event.pubkey.toLowerCase().includes(q) ||
          (metadata.name || '').toLowerCase().includes(q) ||
          (metadata.display_name || '').toLowerCase().includes(q) ||
          (metadata.nip05 || '').toLowerCase().includes(q) ||
          (metadata.about || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, this.MAX_SEARCH_RESULTS);
  }

  private filterEvents(events: Event[], query: string): Event[] {
    const q = query.trim().toLowerCase();
    return this.getDisplayableEvents(events)
      .filter((event) => {
        const title = this.getEventTitle(event).toLowerCase();
        const kind = String(event.kind);
        const kindLabel = getKindLabel(event.kind).toLowerCase();
        const id = event.id.toLowerCase();
        const pubkey = event.pubkey.toLowerCase();
        const content = (event.content || '').slice(0, 500).toLowerCase();
        return (
          title.includes(q) ||
          kind.includes(q) ||
          kindLabel.includes(q) ||
          id.includes(q) ||
          pubkey.includes(q) ||
          content.includes(q)
        );
      })
      .slice(0, this.MAX_SEARCH_RESULTS);
  }

  private getDisplayableEvents(events: Event[]): Event[] {
    const deduplicatedEventsById = new Map<string, Event>();

    for (const event of events) {
      if (!event || !event.id) {
        continue;
      }

      const existing = deduplicatedEventsById.get(event.id);
      if (!existing || event.created_at > existing.created_at) {
        deduplicatedEventsById.set(event.id, event);
      }
    }

    return Array.from(deduplicatedEventsById.values())
      .filter((event) => event.kind !== 0)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, this.MAX_SEARCH_RESULTS);
  }

  private matchesKindFilter(event: Event, filter: EventKindFilter): boolean {
    switch (filter) {
      case 'articles':
        return event.kind === kinds.LongFormArticle || event.kind === 30024;
      case 'notes':
        return event.kind === kinds.ShortTextNote || event.kind === 1111;
      case 'media':
        return event.kind === 20 || event.kind === 21 || event.kind === 22 ||
          event.kind === 1063 || event.kind === 1222 || event.kind === 1244 ||
          event.kind === 34235 || event.kind === 34236 || event.kind === 36787;
      case 'other':
        return !this.matchesKindFilter(event, 'articles') &&
          !this.matchesKindFilter(event, 'notes') &&
          !this.matchesKindFilter(event, 'media');
      default:
        return true;
    }
  }

  private async resolveAuthorNames(pubkeys: string[]): Promise<void> {
    const uniquePubkeys = [...new Set(pubkeys)].filter((pk) => !this.authorNameCache.has(pk));
    if (uniquePubkeys.length === 0) {
      return;
    }

    try {
      const profileEvents = await this.database.getEventsByKind(0);
      const latestByPubkey = new Map<string, Event>();
      for (const event of profileEvents) {
        const current = latestByPubkey.get(event.pubkey);
        if (!current || event.created_at > current.created_at) {
          latestByPubkey.set(event.pubkey, event);
        }
      }

      for (const pk of uniquePubkeys) {
        const profileEvent = latestByPubkey.get(pk);
        if (profileEvent) {
          const metadata = this.parseProfileMetadata(profileEvent.content);
          const name = metadata.display_name || metadata.name || '';
          if (name) {
            this.authorNameCache.set(pk, name);
          }
        }
      }

      // Trigger change detection by re-setting the signal
      this.eventSearchResults.set([...this.eventSearchResults()]);
    } catch {
      // Silently fail - names are optional
    }
  }

  getAuthorName(pubkey: string): string {
    return this.authorNameCache.get(pubkey) || `${pubkey.slice(0, 12)}...`;
  }

  addPastedReference(): void {
    const normalized = this.normalizeReference(this.pastedReference());

    if (!normalized) {
      this.snackBar.open('Paste a valid npub, nevent, or naddr reference', 'Close', { duration: 3500 });
      return;
    }

    this.closeDialog({ references: [normalized] });
  }

  insertProfileReference(pubkey: string): void {
    try {
      const npub = nip19.npubEncode(pubkey);
      this.closeDialog({ references: [`nostr:${npub}`] });
    } catch {
      this.snackBar.open('Could not encode profile reference', 'Close', { duration: 3000 });
    }
  }

  insertEventReference(event: Event): void {
    const reference = this.getReferenceForEvent(event);
    if (!reference) {
      this.snackBar.open('Could not generate a reference for this event', 'Close', { duration: 3000 });
      return;
    }

    this.closeDialog({ references: [reference] });
  }

  async insertBookmarkListReferences(list: BookmarkList): Promise<void> {
    try {
      if (list.isPrivate) {
        await this.bookmarkService.decryptPrivateList(list.id);
      }

      const currentList = this.bookmarkService.allBookmarkLists().find((item) => item.id === list.id);
      const event = currentList?.event;
      if (!event) {
        this.snackBar.open('No references found in this bookmark folder', 'Close', { duration: 3000 });
        return;
      }

      const references = this.getReferencesFromBookmarkTags(event.tags);
      if (references.length === 0) {
        this.snackBar.open('No reference tags found in this bookmark folder', 'Close', { duration: 3000 });
        return;
      }

      this.closeDialog({ references });
    } catch (error) {
      console.error('Failed to insert bookmark list references:', error);
      this.snackBar.open('Failed to load bookmark folder references', 'Close', { duration: 3000 });
    }
  }

  cancel(): void {
    this.closeDialog({ references: [] });
  }

  private closeDialog(result: ArticleReferencePickerResult): void {
    this.dialogRef?.close(result);
  }

  getProfileDisplayName(event: Event): string {
    const metadata = this.parseProfileMetadata(event.content);
    return metadata.display_name || metadata.name || `${event.pubkey.slice(0, 12)}...`;
  }

  getProfileSubtitle(event: Event): string {
    const metadata = this.parseProfileMetadata(event.content);
    return metadata.nip05 || event.pubkey;
  }

  getProfileAbout(event: Event): string {
    const metadata = this.parseProfileMetadata(event.content);
    const about = (metadata.about || '').replace(/\s+/g, ' ').trim();
    return about.length > 120 ? about.slice(0, 120) + '...' : about;
  }

  getProfilePicture(event: Event): string {
    const metadata = this.parseProfileMetadata(event.content);
    return metadata.picture || '';
  }

  getEventTitle(event: Event): string {
    const title = event.tags.find((tag) => tag[0] === 'title')?.[1];
    const subject = event.tags.find((tag) => tag[0] === 'subject')?.[1];
    const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
    const fallbackContent = (event.content || '').replace(/\s+/g, ' ').trim().slice(0, 90);

    return title || subject || identifier || fallbackContent || `Event ${event.id.slice(0, 12)}...`;
  }

  getEventSummary(event: Event): string {
    const summary = event.tags.find((tag) => tag[0] === 'summary')?.[1];
    if (summary) {
      const trimmed = summary.replace(/\s+/g, ' ').trim();
      return trimmed.length > 160 ? trimmed.slice(0, 160) + '...' : trimmed;
    }
    const content = (event.content || '').replace(/[#*_~`>[\]()!]/g, '').replace(/\s+/g, ' ').trim();
    return content.length > 160 ? content.slice(0, 160) + '...' : content;
  }

  getEventImage(event: Event): string {
    return event.tags.find((tag) => tag[0] === 'image')?.[1] || '';
  }

  getEventHashtags(event: Event): string[] {
    return event.tags
      .filter((tag) => tag[0] === 't' && tag[1])
      .map((tag) => tag[1])
      .slice(0, 5);
  }

  getKindLabel(kind: number): string {
    return getKindLabel(kind);
  }

  getKindIcon(kind: number): string {
    switch (kind) {
      case kinds.ShortTextNote:
        return 'short_text';
      case kinds.LongFormArticle:
        return 'article';
      case 30024:
        return 'edit_note';
      case 20:
        return 'photo';
      case 21:
      case 34235:
        return 'videocam';
      case 22:
      case 34236:
        return 'play_circle';
      case 1068:
        return 'poll';
      case 1111:
        return 'comment';
      case 1222:
      case 1244:
      case 36787:
        return 'music_note';
      case 30311:
        return 'live_tv';
      case 9802:
        return 'format_quote';
      case 34139:
        return 'queue_music';
      default:
        return 'event';
    }
  }

  getBookmarkListEntryLabel(list: BookmarkList): string {
    const count = this.getBookmarkListEntryCount(list);
    return `${count} ${count === 1 ? 'entry' : 'entries'}`;
  }

  private getBookmarkListEntryCount(list: BookmarkList): number {
    const tags = list.event?.tags;
    if (!tags || tags.length === 0) {
      return 0;
    }

    return tags.filter((tag) => {
      const marker = tag[0];
      return (marker === 'p' || marker === 'e' || marker === 'a') && !!tag[1];
    }).length;
  }

  private getReferenceForEvent(event: Event): string | null {
    try {
      const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1];
      const isAddressable = event.kind >= 30000 && event.kind < 40000 && !!dTag;
      const relays = this.accountRelay.getRelayUrls();

      if (isAddressable && dTag) {
        const naddr = nip19.naddrEncode({
          kind: event.kind,
          pubkey: event.pubkey,
          identifier: dTag,
          relays,
        });
        return `nostr:${naddr}`;
      }

      const nevent = nip19.neventEncode({
        id: event.id,
        author: event.pubkey,
        relays,
      });
      return `nostr:${nevent}`;
    } catch {
      return null;
    }
  }

  private normalizeReference(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const withoutPrefix = trimmed.toLowerCase().startsWith('nostr:') ? trimmed.slice(6) : trimmed;

    try {
      const decoded = nip19.decode(withoutPrefix);
      if (decoded.type === 'npub' || decoded.type === 'nevent' || decoded.type === 'naddr') {
        return `nostr:${withoutPrefix}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  private getReferencesFromBookmarkTags(tags: string[][]): string[] {
    const references = new Set<string>();

    for (const tag of tags) {
      if (tag[0] === 'p' && tag[1]) {
        try {
          references.add(`nostr:${nip19.npubEncode(tag[1])}`);
        } catch {
          continue;
        }
      }

      if (tag[0] === 'e' && tag[1]) {
        try {
          const relays = tag[2] ? [tag[2]] : undefined;
          const author = tag[3] || undefined;
          references.add(`nostr:${nip19.neventEncode({ id: tag[1], relays, author })}`);
        } catch {
          continue;
        }
      }

      if (tag[0] === 'a' && tag[1]) {
        try {
          const [kindString, pubkey, identifier] = tag[1].split(':');
          const kind = Number(kindString);
          if (!pubkey || !identifier || Number.isNaN(kind)) {
            continue;
          }

          const relays = tag[2] ? [tag[2]] : undefined;
          references.add(`nostr:${nip19.naddrEncode({ kind, pubkey, identifier, relays })}`);
        } catch {
          continue;
        }
      }
    }

    return Array.from(references);
  }

  private parseProfileMetadata(content: string): {
    name?: string;
    display_name?: string;
    about?: string;
    nip05?: string;
    picture?: string;
  } {
    try {
      const metadata = JSON.parse(content || '{}') as {
        name?: string;
        display_name?: string;
        about?: string;
        nip05?: string | string[];
        picture?: string;
      };

      const nip05 = Array.isArray(metadata.nip05) ? metadata.nip05[0] : metadata.nip05;

      return {
        name: metadata.name,
        display_name: metadata.display_name,
        about: metadata.about,
        nip05,
        picture: metadata.picture,
      };
    } catch {
      return {};
    }
  }
}
