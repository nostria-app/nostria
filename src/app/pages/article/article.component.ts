import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, type ParamMap, RouterModule } from '@angular/router';
import { type Event, kinds, nip19 } from 'nostr-tools';
import type { Subscription } from 'rxjs';
import { DateToggleComponent } from '../../components/date-toggle/date-toggle.component';
import { EventMenuComponent } from '../../components/event/event-menu/event-menu.component';
import { RepostButtonComponent } from '../../components/event/repost-button/repost-button.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import type { NostrRecord } from '../../interfaces';
import { AccountStateService } from '../../services/account-state.service';
import { BookmarkService } from '../../services/bookmark.service';
import { Cache } from '../../services/cache';
import { DataService } from '../../services/data.service';
import { FormatService } from '../../services/format/format.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { UrlUpdateService } from '../../services/url-update.service';
import { UserDataFactoryService } from '../../services/user-data-factory.service';
import { UtilitiesService } from '../../services/utilities.service';

@Component({
  selector: 'app-article',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
    DateToggleComponent,
    CommonModule,
    RouterModule,
    RepostButtonComponent,
    EventMenuComponent,
  ],
  templateUrl: './article.component.html',
  styleUrl: './article.component.scss',
})
export class ArticleComponent implements OnDestroy {
  private route = inject(ActivatedRoute);
  private utilities = inject(UtilitiesService);
  private readonly userDataFactory = inject(UserDataFactoryService);
  private logger = inject(LoggerService);
  private data = inject(DataService);
  private layout = inject(LayoutService);
  private formatService = inject(FormatService);
  private url = inject(UrlUpdateService);
  private readonly cache = inject(Cache);
  bookmark = inject(BookmarkService);
  accountState = inject(AccountStateService);
  link = '';

  private routeSubscription?: Subscription;

  event = signal<Event | undefined>(undefined);
  isLoading = signal(false);
  error = signal<string | null>(null);

  constructor() {
    if (!this.layout.isBrowser()) {
      return;
    }

    // Subscribe to route parameter changes
    this.routeSubscription = this.route.paramMap.subscribe(params => {
      const addrParam = params.get('id');
      if (addrParam) {
        this.loadArticle(addrParam, params);
        // Scroll to top when navigating to a new article
        setTimeout(() => this.layout.scrollMainContentToTop(), 100);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  bookmarkArticle() {
    this.bookmark.toggleBookmark(this.id(), 'a');
  }

  id = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return `${this.event()?.kind}:${this.authorPubkey()}:${this.slug()}`;
  });

  slug = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('d', ev.tags)[0] || '';
  });

  async loadArticle(naddr: string, params?: ParamMap): Promise<void> {
    const receivedData = history.state.event as Event | undefined;

    let pubkey = '';
    let slug = '';

    if (receivedData) {
      const encoded = nip19.naddrEncode({
        identifier: receivedData.tags.find(tag => tag[0] === 'd')?.[1] || '',
        kind: receivedData.kind,
        pubkey: receivedData.pubkey,
      });
      this.link = encoded;

      this.logger.debug('Received event from navigation state:', receivedData);
      this.event.set(receivedData);
      this.isLoading.set(false);
      // Scroll to top when article is received from navigation state
      setTimeout(() => this.layout.scrollMainContentToTop(), 50);
      return;
    } else if (naddr.startsWith('naddr1')) {
      this.link = naddr;

      // Decode the naddr1 parameter using nip19.decode()
      const decoded = this.utilities.decode(naddr);

      if (decoded.type !== 'naddr') {
        throw new Error('Invalid article address format');
      }

      const addrData = decoded.data as {
        pubkey: string;
        identifier: string;
        kind: number;
      };
      this.logger.debug('Decoded naddr:', addrData);

      pubkey = addrData.pubkey;
      slug = decoded.data.identifier;
    } else {
      const slugParam = params?.get('slug') || this.route.snapshot.paramMap.get('slug');

      // If we have slug, the
      if (slugParam) {
        slug = slugParam;
        pubkey = this.utilities.getPubkeyFromNpub(naddr);

        // Let's make the URL nicer, TODO add support for replacing with username, for now replace with npub.
        const npub = this.utilities.getNpubFromPubkey(pubkey);
        this.url.updatePathSilently(['/a', npub, slug]);

        const encoded = nip19.naddrEncode({
          identifier: slug,
          kind: kinds.LongFormArticle,
          pubkey: pubkey,
        });
        this.link = encoded;
      }
    }

    try {
      this.isLoading.set(true);
      this.error.set(null);

      const isNotCurrentUser = !this.accountState.isCurrentUser(pubkey);
      let event: NostrRecord | null = null;

      if (isNotCurrentUser) {
        event = await this.userDataFactory.borrow(pubkey, uds =>
          uds.getEventByPubkeyAndKindAndReplaceableEvent(
            pubkey,
            kinds.LongFormArticle,
            slug,
            { save: false, cache: false }
          )
        );
      } else {
        event = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
          pubkey,
          kinds.LongFormArticle,
          slug,
          { save: false, cache: false }
        );
      }

      if (event) {
        this.logger.debug('Loaded article event from storage or relays:', event);
        this.event.set(event.event);
        this.isLoading.set(false);
        return;
      }
    } catch (error) {
      this.logger.error('Error loading article:', error);
      this.error.set('Failed to load article');
    } finally {
      this.isLoading.set(false);
      // Scroll to top after article loads (whether successful or not)
      setTimeout(() => this.layout.scrollMainContentToTop(), 100);
    }
  }

  // Computed properties for parsed event data
  title = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('title', ev.tags)[0] || '';
  });

  image = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('image', ev.tags)[0] || '';
  });

  summary = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('summary', ev.tags)[0] || '';
  });

  publishedAt = computed(() => {
    const ev = this.event();
    if (!ev) return null;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return new Date(parseInt(publishedAtTag) * 1000);
    }
    return new Date(ev.created_at * 1000);
  });

  publishedAtTimestamp = computed(() => {
    const ev = this.event();
    if (!ev) return 0;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return parseInt(publishedAtTag);
    }
    return ev.created_at;
  });

  hashtags = computed(() => {
    const ev = this.event();
    if (!ev) return [];
    return this.utilities.getTagValues('t', ev.tags);
  });

  content = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    try {
      // Try to parse as JSON first, fall back to raw content
      const parsed = JSON.parse(ev.content);
      return typeof parsed === 'string' ? parsed : ev.content;
    } catch {
      return ev.content;
    }
  });

  // Signal to hold the parsed markdown content
  private _parsedContent = signal<SafeHtml>('');

  // Computed property that returns the parsed content signal value
  parsedContent = computed(() => this._parsedContent()); // Effect to handle async content parsing

  private parseContentEffect = effect(async () => {
    const content = this.content();
    if (!content) {
      this._parsedContent.set('');
      return;
    }

    this._parsedContent.set(await this.formatService.markdownToHtml(content));
  });

  authorPubkey = computed(() => {
    const ev = this.event();
    return ev?.pubkey || '';
  });

  formatLocalDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  retryLoad(): void {
    const addrParam = this.route.snapshot.paramMap.get('id');
    if (addrParam) {
      this.loadArticle(addrParam);
    }
  }

  async shareArticle() {
    const event = this.event();
    if (!event) return;

    // Parse title and summary from the Nostr event tags
    const title = this.title();
    const summary = this.summary();

    const shareData: ShareData = {
      title: title || 'Nostr Article',
      text: summary || `Check out this article: ${title || 'Nostr Article'}`,
      url: window.location.href,
    };

    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback to clipboard
        const textToShare = `${title || 'Nostr Article'}\n\n${summary || ''}\n\n${window.location.href}`;
        await navigator.clipboard.writeText(textToShare);

        // You might want to show a toast/snackbar here indicating the content was copied
        console.log('Article details copied to clipboard');
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Error sharing article:', error);
        // Fallback to clipboard if sharing fails
        try {
          const textToShare = `${title || 'Nostr Article'}\n\n${summary || ''}\n\n${window.location.href}`;
          await navigator.clipboard.writeText(textToShare);
          console.log('Article details copied to clipboard');
        } catch (clipboardError) {
          console.error('Failed to copy to clipboard:', clipboardError);
        }
      }
    }
  }
}
