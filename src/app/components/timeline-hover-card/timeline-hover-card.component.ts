import {
  Component,
  input,
  signal,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { UtilitiesService } from '../../services/utilities.service';
import { DatabaseService } from '../../services/database.service';
import { UserRelayService } from '../../services/relays/user-relay';
import { FavoritesService } from '../../services/favorites.service';
import { LayoutService } from '../../services/layout.service';
import { ParsingService, type ContentToken, type NostrData } from '../../services/parsing.service';
import { kinds } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import type { NostrRecord } from '../../interfaces';

@Component({
  selector: 'app-timeline-hover-card',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './timeline-hover-card.component.html',
  styleUrl: './timeline-hover-card.component.scss',
})
export class TimelineHoverCardComponent {
  private dataService = inject(DataService);
  private router = inject(Router);
  private utilities = inject(UtilitiesService);
  private database = inject(DatabaseService);
  private userRelayService = inject(UserRelayService);
  private favoritesService = inject(FavoritesService);
  private layout = inject(LayoutService);
  private parsing = inject(ParsingService);

  pubkey = input.required<string>();
  profile = signal<{ data?: { display_name?: string; name?: string; picture?: string } } | null>(null);
  recentNotes = signal<NostrRecord[]>([]);
  renderedNotes = signal<Map<string, string>>(new Map());
  isLoading = signal(false);

  npubValue = signal<string>('');

  profileUrl = computed(() => `/p/${this.npubValue()}`);

  // Expose isFavorite as a computed signal
  isFavorite = () => this.favoritesService.isFavorite(this.pubkey());

  isHovering = signal(false);
  effectTransform = signal('');

  // Track to prevent duplicate loads
  private loadedPubkey: string | null = null;
  private loadingPubkey: string | null = null;

  constructor() {
    effect(() => {
      const pubkey = this.pubkey();

      if (pubkey) {
        untracked(() => {
          // Skip if already loaded or currently loading this pubkey
          if (this.loadedPubkey === pubkey || this.loadingPubkey === pubkey) {
            return;
          }

          this.loadingPubkey = pubkey;
          this.npubValue.set(nip19.npubEncode(pubkey));
          this.loadProfile(pubkey);
          this.loadRecentNotes(pubkey);
        });
      }
    });
  }

  private async loadProfile(pubkey: string): Promise<void> {
    try {
      const profile = await this.dataService.getProfile(pubkey);
      // Only update if this is still the current pubkey
      if (this.pubkey() === pubkey) {
        this.profile.set(profile || null);
      }
    } catch (error) {
      console.error('Failed to load profile for timeline hover card:', error);
      if (this.pubkey() === pubkey) {
        this.profile.set(null);
      }
    }
  }

  private async loadRecentNotes(pubkey: string): Promise<void> {
    this.isLoading.set(true);

    try {
      // 1) Load from local database first for fast initial render
      const storageEvents = await this.database.getUserEvents(pubkey);

      // Only update if this is still the current pubkey
      if (this.pubkey() !== pubkey) {
        return;
      }

      const cachedNotes = storageEvents
        .filter(event => event.kind === kinds.ShortTextNote && this.utilities.isRootPost(event))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 5)
        .map(event => ({
          event,
          data: event.content,
        }));

      if (cachedNotes.length > 0) {
        this.recentNotes.set(cachedNotes);
        void this.renderNotes(cachedNotes, pubkey);
        // Show cached content immediately while refreshing from relay in background
        this.isLoading.set(false);
      }

      // 2) Fetch fresh data from relays in background
      // Fetch fresh data from relays to ensure we get recent posts
      // Calculate timestamp from 30 days ago
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

      const events = await this.userRelayService.query(pubkey, {
        kinds: [kinds.ShortTextNote],
        authors: [pubkey],
        since: thirtyDaysAgo,
        limit: 20, // Fetch more to ensure we have enough root posts
      });

      // Only update if this is still the current pubkey
      if (this.pubkey() !== pubkey) {
        return;
      }

      if (events && events.length > 0) {
        const notes = events
          .filter(event => this.utilities.isRootPost(event))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, 5)
          .map(event => ({
            event,
            data: event.content,
          }));

        const currentIds = this.recentNotes().map(note => note.event.id);
        const nextIds = notes.map(note => note.event.id);
        const hasChanged = currentIds.length !== nextIds.length || currentIds.some((id, index) => id !== nextIds[index]);

        if (hasChanged) {
          this.recentNotes.set(notes);
          void this.renderNotes(notes, pubkey);
        }
      } else {
        // Keep cached notes if available; clear only when we have no cached content
        if (this.recentNotes().length === 0) {
          this.renderedNotes.set(new Map());
        }
      }

      // Mark as successfully loaded
      this.loadedPubkey = pubkey;
    } catch (error) {
      console.error('Failed to load recent notes for timeline hover card:', error);
    } finally {
      if (this.pubkey() === pubkey) {
        this.isLoading.set(false);
        this.loadingPubkey = null;
      }
    }
  }

  private async renderNotes(notes: NostrRecord[], pubkey: string): Promise<void> {
    const rendered = new Map<string, string>();

    for (const note of notes) {
      try {
        const parsed = await this.parsing.parseContent(
          note.event.content || '',
          note.event.tags,
          note.event.pubkey
        );
        rendered.set(note.event.id, this.tokensToPreviewHtml(parsed.tokens));
      } catch {
        rendered.set(note.event.id, note.data || '');
      }
    }

    if (this.pubkey() === pubkey) {
      this.renderedNotes.set(rendered);
    }
  }

  onCardMouseMove(event: MouseEvent) {
    this.isHovering.set(true);
    const card = event.currentTarget as HTMLElement;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    this.effectTransform.set(`translate(${x}px, ${y}px) translate(-50%, -50%)`);
  }

  onCardMouseLeave() {
    this.isHovering.set(false);
  }

  getDisplayName(): string {
    const profileData = this.profile();
    if (!profileData?.data) return 'Anonymous';
    return profileData.data.display_name || profileData.data.name || 'Anonymous';
  }

  getAvatarUrl(): string | undefined {
    return this.profile()?.data?.picture;
  }

  getTimeAgo(timestamp: number): string {
    return this.utilities.getRelativeTime(timestamp);
  }

  private getProfileHref(nostrData?: NostrData): string | null {
    if (!nostrData) {
      return null;
    }

    if (nostrData.type === 'npub' && typeof nostrData.data === 'string') {
      return `/p/${this.utilities.getNpubFromPubkey(nostrData.data)}`;
    }

    if (nostrData.type === 'nprofile' && nostrData.data?.pubkey) {
      return `/p/${this.utilities.getNpubFromPubkey(nostrData.data.pubkey)}`;
    }

    return null;
  }

  private isValidExternalUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }

      // Validate hostname labels (DNS labels max 63 chars)
      const labels = parsed.hostname.split('.');
      if (labels.some(label => label.length === 0 || label.length > 63)) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  private isImageUrl(value: string): boolean {
    return /\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?$/i.test(value);
  }

  private tokensToPreviewHtml(tokens: ContentToken[]): string {
    return tokens
      .map(token => {
        switch (token.type) {
          case 'nostr-mention': {
            const displayName = token.nostrData?.displayName || token.content;
            const mentionText = displayName.startsWith('@') ? displayName : `@${displayName}`;
            const profileHref = this.getProfileHref(token.nostrData);

            if (profileHref) {
              return `<a class="nostr-mention" href="${this.utilities.escapeHtml(profileHref)}">${this.utilities.escapeHtml(mentionText)}</a>`;
            }

            return `<span class="nostr-mention">${this.utilities.escapeHtml(mentionText)}</span>`;
          }
          case 'hashtag': {
            const hashtag = token.content?.replace(/^#/, '') || '';
            return `<a class="hashtag-link" href="/f?t=${encodeURIComponent(hashtag)}">#${this.utilities.escapeHtml(hashtag)}</a>`;
          }
          case 'image': {
            if (!this.isValidExternalUrl(token.content)) {
              return this.utilities.escapeHtml(token.content || '');
            }
            const escapedUrl = this.utilities.escapeHtml(token.content);
            return `<a class="image-link" href="${escapedUrl}" target="_blank" rel="noopener noreferrer"><img class="note-image" src="${escapedUrl}" alt="Post image" loading="lazy" /></a>`;
          }
          case 'url':
            if (this.isImageUrl(token.content) && this.isValidExternalUrl(token.content)) {
              const escapedUrl = this.utilities.escapeHtml(token.content);
              return `<a class="image-link" href="${escapedUrl}" target="_blank" rel="noopener noreferrer"><img class="note-image" src="${escapedUrl}" alt="Post image" loading="lazy" /></a>`;
            }
            if (!this.isValidExternalUrl(token.content)) {
              return this.utilities.escapeHtml(token.content || '');
            }
            return `<a class="url-link" href="${this.utilities.escapeHtml(token.content)}" target="_blank" rel="noopener noreferrer">${this.utilities.escapeHtml(token.content)}</a>`;
          case 'youtube':
          case 'audio':
          case 'video':
            if (!this.isValidExternalUrl(token.content)) {
              return this.utilities.escapeHtml(token.content || '');
            }
            return `<a class="url-link" href="${this.utilities.escapeHtml(token.content)}" target="_blank" rel="noopener noreferrer">${this.utilities.escapeHtml(token.content)}</a>`;
          case 'linebreak':
            return '<br>';
          default:
            return this.utilities.escapeHtml(token.content || '');
        }
      })
      .join('')
      .trim();
  }

  getRenderedNoteContent(note: NostrRecord): string {
    return this.renderedNotes().get(note.event.id) ?? note.data;
  }

  onNoteContentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('a') as HTMLAnchorElement | null;
    if (!anchor) {
      return;
    }

    event.stopPropagation();

    const href = anchor.getAttribute('href');
    if (!href) {
      return;
    }

    // Keep default browser behavior for external links
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return;
    }

    // Route internal links through Angular Router to avoid full-page reload
    if (href.startsWith('/')) {
      event.preventDefault();
      void this.router.navigateByUrl(href);
    }
  }

  onNoteKeydown(event: KeyboardEvent, eventId: string, kind: number): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.navigateToEvent(eventId, kind);
    }
  }

  navigateToEvent(eventId: string, kind: number): void {
    const pubkey = this.pubkey();
    const neventId = nip19.neventEncode({
      id: eventId,
      author: pubkey,
      kind: kind,
    });

    if (kind === 30023) {
      this.layout.openArticle(neventId);
    } else {
      this.layout.openGenericEvent(neventId);
    }
  }

  onProfileClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.layout.openProfile(this.pubkey());
  }

  toggleFavorite(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.favoritesService.toggleFavorite(this.pubkey());
  }
}
