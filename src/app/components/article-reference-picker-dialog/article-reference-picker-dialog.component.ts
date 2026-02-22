import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Event, nip19 } from 'nostr-tools';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BookmarkList, BookmarkService } from '../../services/bookmark.service';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { DatabaseService } from '../../services/database.service';

export interface ArticleReferencePickerResult {
  references: string[];
}

@Component({
  selector: 'app-article-reference-picker-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './article-reference-picker-dialog.component.html',
  styleUrl: './article-reference-picker-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleReferencePickerDialogComponent {
  dialogRef?: CustomDialogRef<ArticleReferencePickerDialogComponent, ArticleReferencePickerResult>;

  private readonly database = inject(DatabaseService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly bookmarkService = inject(BookmarkService);

  readonly query = signal('');
  readonly pastedReference = signal('');
  readonly activeTabIndex = signal(0);
  readonly profilesLoading = signal(false);
  readonly eventsLoading = signal(false);

  private readonly profileSearchResults = signal<Event[]>([]);
  private readonly eventSearchResults = signal<Event[]>([]);
  private readonly SEARCH_DEBOUNCE_MS = 250;
  private readonly MAX_SEARCH_RESULTS = 200;
  private searchDebounceTimer?: ReturnType<typeof setTimeout>;
  private activeSearchToken = 0;

  readonly bookmarkLists = this.bookmarkService.allBookmarkLists;

  readonly filteredProfiles = computed(() => this.profileSearchResults());

  readonly filteredEvents = computed(() => this.eventSearchResults());

  onSearchQueryChange(value: string): void {
    this.query.set(value);
    this.scheduleSearchForActiveTab();
  }

  onTabIndexChange(index: number): void {
    this.activeTabIndex.set(index);
    this.scheduleSearchForActiveTab();
  }

  private scheduleSearchForActiveTab(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = undefined;
    }

    const tabIndex = this.activeTabIndex();
    const q = this.query().trim();

    if (tabIndex !== 1 && tabIndex !== 2) {
      return;
    }

    if (!q) {
      if (tabIndex === 1) {
        this.profileSearchResults.set([]);
        this.profilesLoading.set(false);
      }
      if (tabIndex === 2) {
        this.eventSearchResults.set([]);
        this.eventsLoading.set(false);
      }
      return;
    }

    this.searchDebounceTimer = setTimeout(() => {
      void this.searchActiveTab(q, tabIndex);
    }, this.SEARCH_DEBOUNCE_MS);
  }

  private async searchActiveTab(query: string, tabIndex: number): Promise<void> {
    const token = ++this.activeSearchToken;

    if (tabIndex === 1) {
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

    if (tabIndex === 2) {
      this.eventsLoading.set(true);

      try {
        const allEvents = await this.database.getAllEvents();
        if (token !== this.activeSearchToken) {
          return;
        }

        this.eventSearchResults.set(this.filterEvents(allEvents, query));
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
      .filter((event) => {
        const title = this.getEventTitle(event).toLowerCase();
        const kind = String(event.kind);
        const id = event.id.toLowerCase();
        const pubkey = event.pubkey.toLowerCase();
        const content = (event.content || '').slice(0, 500).toLowerCase();
        return (
          title.includes(q) ||
          kind.includes(q) ||
          id.includes(q) ||
          pubkey.includes(q) ||
          content.includes(q)
        );
      })
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, this.MAX_SEARCH_RESULTS);
  }

  addPastedReference(): void {
    const normalized = this.normalizeReference(this.pastedReference());

    if (!normalized) {
      this.snackBar.open('Paste a valid npub, nevent, or naddr reference', 'Close', { duration: 3500 });
      return;
    }

    this.dialogRef?.close({ references: [normalized] });
  }

  insertProfileReference(pubkey: string): void {
    try {
      const npub = nip19.npubEncode(pubkey);
      this.dialogRef?.close({ references: [`nostr:${npub}`] });
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

    this.dialogRef?.close({ references: [reference] });
  }

  async insertBookmarkListReferences(list: BookmarkList): Promise<void> {
    try {
      if (list.isPrivate) {
        await this.bookmarkService.decryptPrivateList(list.id);
      }

      const currentList = this.bookmarkService.allBookmarkLists().find((item) => item.id === list.id);
      const event = currentList?.event;
      if (!event) {
        this.snackBar.open('No references found in this bookmark list', 'Close', { duration: 3000 });
        return;
      }

      const references = this.getReferencesFromBookmarkTags(event.tags);
      if (references.length === 0) {
        this.snackBar.open('No reference tags found in this bookmark list', 'Close', { duration: 3000 });
        return;
      }

      this.dialogRef?.close({ references });
    } catch (error) {
      console.error('Failed to insert bookmark list references:', error);
      this.snackBar.open('Failed to load bookmark list references', 'Close', { duration: 3000 });
    }
  }

  cancel(): void {
    this.dialogRef?.close({ references: [] });
  }

  getProfileDisplayName(event: Event): string {
    const metadata = this.parseProfileMetadata(event.content);
    return metadata.display_name || metadata.name || `${event.pubkey.slice(0, 12)}...`;
  }

  getProfileSubtitle(event: Event): string {
    const metadata = this.parseProfileMetadata(event.content);
    return metadata.nip05 || event.pubkey;
  }

  getEventTitle(event: Event): string {
    const title = event.tags.find((tag) => tag[0] === 'title')?.[1];
    const subject = event.tags.find((tag) => tag[0] === 'subject')?.[1];
    const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
    const fallbackContent = (event.content || '').replace(/\s+/g, ' ').trim().slice(0, 90);

    return title || subject || identifier || fallbackContent || `Event ${event.id.slice(0, 12)}...`;
  }

  private getReferenceForEvent(event: Event): string | null {
    try {
      const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1];
      const isAddressable = event.kind >= 30000 && event.kind < 40000 && !!dTag;

      if (isAddressable && dTag) {
        const naddr = nip19.naddrEncode({
          kind: event.kind,
          pubkey: event.pubkey,
          identifier: dTag,
        });
        return `nostr:${naddr}`;
      }

      const nevent = nip19.neventEncode({
        id: event.id,
        author: event.pubkey,
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
  } {
    try {
      const metadata = JSON.parse(content || '{}') as {
        name?: string;
        display_name?: string;
        about?: string;
        nip05?: string | string[];
      };

      const nip05 = Array.isArray(metadata.nip05) ? metadata.nip05[0] : metadata.nip05;

      return {
        name: metadata.name,
        display_name: metadata.display_name,
        about: metadata.about,
        nip05,
      };
    } catch {
      return {};
    }
  }
}
