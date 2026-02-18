import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Event, nip19 } from 'nostr-tools';
import { ProfileDisplayNameComponent } from '../../user-profile/display-name/profile-display-name.component';
import { LayoutService } from '../../../services/layout.service';
import { DataService } from '../../../services/data.service';
import { NostrRecord } from '../../../interfaces';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { DatabaseService } from '../../../services/database.service';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService, ANONYMOUS_PUBKEY } from '../../../services/account-local-state.service';
import { Router } from '@angular/router';
import { LocalStorageService } from '../../../services/local-storage.service';

const RELAY_SET_KIND = 30002;
const CLIPS_RELAY_SET_D_TAG = 'clips';
const DEFAULT_CLIPS_RELAYS = [
  'wss://nos.lol/',
  'wss://relay.damus.io/',
  'wss://relay3.openvine.co/',
  'wss://relay.divine.video/',
];
const CLIPS_CURRENT_EVENT_STORAGE_PREFIX = 'clips-current-event';

interface ParsedMention {
  pubkey: string;
  relay?: string;
  marker?: string;
}

interface ParsedArticle {
  kind: number;
  pubkey: string;
  identifier: string;
  relay?: string;
  marker?: string;
  image?: string; // Add image property
  title?: string; // Add title property for caching
  description?: string; // Add description property for caching
}

@Component({
  selector: 'app-tagged-references',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    ProfileDisplayNameComponent
  ],
  templateUrl: './tagged-references.component.html',
  styleUrl: './tagged-references.component.scss',
})
export class TaggedReferencesComponent {
  private layout = inject(LayoutService);
  private data = inject(DataService);
  private relayPool = inject(RelayPoolService);
  private database = inject(DatabaseService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private localStorage = inject(LocalStorageService);
  private router = inject(Router);

  private clipsRelayUrlsPromise: Promise<string[]> | null = null;

  event = input<Event | null>(null);

  // Parse p tags (user mentions) from the event
  mentions = computed<ParsedMention[]>(() => {
    const event = this.event();
    if (!event || !event.tags) return [];

    const mentions = event.tags
      .filter(tag => tag[0] === 'p' && tag[1])
      .map(tag => ({
        pubkey: tag[1],
        relay: tag[2] || undefined,
        marker: tag[3] || undefined,
      }))
      .filter((mention, index, array) =>
        // Remove duplicates based on pubkey
        array.findIndex(m => m.pubkey === mention.pubkey) === index
      );

    return mentions;
  });

  // Parse a tags (article references) from the event
  articles = computed<ParsedArticle[]>(() => {
    const event = this.event();
    if (!event || !event.tags) return [];

    const validArticles = event.tags
      .filter(tag => (tag[0] === 'a' || tag[0] === 'A') && tag[1])
      .map(tag => {
        const parts = tag[1].split(':');
        if (parts.length !== 3) return null;

        const article: ParsedArticle = {
          kind: parseInt(parts[0], 10),
          pubkey: parts[1],
          identifier: parts[2],
          relay: tag[2] || undefined,
          marker: tag[3] || undefined,
        };

        // Don't load data here - will be done in effect
        return article;
      })
      .filter((article): article is ParsedArticle => article !== null);

    // Remove duplicates
    const articles = validArticles.filter((article, index, array) =>
      array.findIndex(a =>
        a.kind === article.kind &&
        a.pubkey === article.pubkey &&
        a.identifier === article.identifier
      ) === index
    );

    return articles;
  });

  // Track which articles have been loaded
  articleData = signal<Map<string, NostrRecord | null>>(new Map());

  // Track loading state for each article
  articleLoadingState = signal<Map<string, 'loading' | 'loaded' | 'failed'>>(new Map());

  constructor() {
    // Effect to load article data when articles list changes
    effect(() => {
      const articles = this.articles();

      untracked(() => {
        articles.forEach(article => {
          this.loadArticleData(article);
        });
      });
    });
  }

  // Load article data when needed
  private async loadArticleData(article: ParsedArticle): Promise<void> {
    const key = `${article.kind}:${article.pubkey}:${article.identifier}`;

    if (this.articleData().has(key)) return;

    // Mark as loading
    this.articleLoadingState.update(map => {
      const newMap = new Map(map);
      newMap.set(key, 'loading');
      return newMap;
    });

    try {
      let eventData = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
        article.pubkey,
        article.kind,
        article.identifier,
        { cache: true, save: true }
      );

      if (!eventData && article.kind === 34236) {
        eventData = await this.loadKind34236FromClipsRelays(article);
      }

      // Cache image, title, and description in the article object
      if (eventData?.event) {
        const event = eventData.event;

        // Look for image in event tags
        const imageTag = event.tags?.find(tag => tag[0] === 'image');
        const bannerTag = event.tags?.find(tag => tag[0] === 'banner');
        const pictureTag = event.tags?.find(tag => tag[0] === 'picture');
        const thumbTag = event.tags?.find(tag => tag[0] === 'thumb');

        const imetaTag = event.tags?.find(tag => tag[0] === 'imeta');
        const parsedImeta = imetaTag ? this.utilities.parseImetaTag(imetaTag, true) : null;
        const imetaImage = parsedImeta?.['image'] || null;

        if (thumbTag?.[1]) {
          article.image = thumbTag[1];
        } else if (imetaImage) {
          article.image = imetaImage;
        } else if (imageTag?.[1]) {
          article.image = imageTag[1];
        } else if (bannerTag?.[1]) {
          article.image = bannerTag[1];
        } else if (pictureTag?.[1]) {
          article.image = pictureTag[1];
        }        // Look for title
        const titleTag = event.tags?.find(tag => tag[0] === 'title');
        if (titleTag?.[1]) {
          article.title = titleTag[1];
        }

        // Look for summary/description
        const summaryTag = event.tags?.find(tag => tag[0] === 'summary');
        if (summaryTag?.[1]) {
          article.description = summaryTag[1];
        }
      }

      this.articleData.update(map => {
        const newMap = new Map(map);
        newMap.set(key, eventData);
        return newMap;
      });

      this.articleLoadingState.update(map => {
        const newMap = new Map(map);
        newMap.set(key, eventData ? 'loaded' : 'failed');
        return newMap;
      });
    } catch (error) {
      console.error('Failed to load article data:', error);
      this.articleData.update(map => {
        const newMap = new Map(map);
        newMap.set(key, null);
        return newMap;
      });

      this.articleLoadingState.update(map => {
        const newMap = new Map(map);
        newMap.set(key, 'failed');
        return newMap;
      });
    }
  }

  onMentionClick(mention: ParsedMention): void {
    const npub = nip19.npubEncode(mention.pubkey);
    this.layout.openProfile(npub);
  }

  onArticleClick(event: globalThis.Event, article: ParsedArticle): void {
    // Stop propagation to prevent the parent event card from opening
    event.stopPropagation();

    const naddr = nip19.naddrEncode({
      identifier: article.identifier,
      kind: article.kind,
      pubkey: article.pubkey,
      relays: article.relay ? [article.relay] : undefined,
    });

    const key = `${article.kind}:${article.pubkey}:${article.identifier}`;
    const eventData = this.articleData().get(key);

    if (article.kind === 34236 && eventData?.event) {
      this.accountLocalState.setClipsLastForYouEventId(this.getAccountKey(), eventData.event.id);
      this.persistCurrentClipToStorage(eventData.event);
      void this.router.navigateByUrl('/clips');
      return;
    }

    if (article.kind === 30023) {
      // Long-form article
      this.layout.openArticle(naddr, eventData?.event);
    } else {
      // Other types of events
      if (eventData?.event) {
        this.layout.openEvent(eventData.event.id, eventData.event);
      }
    }
  }

  getArticleTitle(article: ParsedArticle): string {
    const key = `${article.kind}:${article.pubkey}:${article.identifier}`;
    const eventData = this.articleData().get(key);

    if (eventData?.event) {
      // Try to get title from tags
      const titleTag = eventData.event.tags.find(tag => tag[0] === 'title');
      if (titleTag?.[1]) {
        return titleTag[1];
      }

      // Fallback to identifier or first part of content
      if (eventData.event.content) {
        const firstLine = eventData.event.content.split('\n')[0];
        if (firstLine.length > 0 && firstLine.length <= 100) {
          return firstLine;
        }
      }
    }

    // Fallback to identifier
    return article.identifier.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  getArticleDescription(article: ParsedArticle): string {
    const key = `${article.kind}:${article.pubkey}:${article.identifier}`;
    const eventData = this.articleData().get(key);

    if (eventData?.event) {
      // Try to get summary from tags
      const summaryTag = eventData.event.tags.find(tag => tag[0] === 'summary');
      if (summaryTag?.[1]) {
        return summaryTag[1];
      }

      // Fallback to first part of content
      if (eventData.event.content) {
        const content = eventData.event.content.trim();
        if (content.length > 150) {
          return content.substring(0, 150) + '...';
        }
        return content;
      }
    }

    return `${this.getKindDisplayName(article.kind)} by author`;
  }

  getKindDisplayName(kind: number): string {
    switch (kind) {
      case 30023:
        return 'Article';
      case 30311:
        return 'Live Event';
      case 32100:
        return 'Playlist';
      case 34236:
        return 'Short Video';
      case 39089:
        return 'Starter Pack';
      default:
        return `Kind ${kind}`;
    }
  }

  getArticleImage(article: ParsedArticle): string | null {
    // First check if we have cached image data
    if (article.image) {
      return article.image;
    }

    // If no cached data, try to get from loaded event data
    const key = `${article.kind}:${article.pubkey}:${article.identifier}`;
    const eventData = this.articleData().get(key);

    if (eventData?.event) {
      // Try to get thumb from tags (for live events)
      const thumbTag = eventData.event.tags.find(tag => tag[0] === 'thumb');
      if (thumbTag?.[1]) {
        return thumbTag[1];
      }

      const imetaTag = eventData.event.tags.find(tag => tag[0] === 'imeta');
      if (imetaTag) {
        const parsedImeta = this.utilities.parseImetaTag(imetaTag, true);
        if (parsedImeta['image']) {
          return parsedImeta['image'];
        }
      }

      // Try to get image from tags
      const imageTag = eventData.event.tags.find(tag => tag[0] === 'image');
      if (imageTag?.[1]) {
        return imageTag[1];
      }

      // Try to get banner from tags (for articles)
      const bannerTag = eventData.event.tags.find(tag => tag[0] === 'banner');
      if (bannerTag?.[1]) {
        return bannerTag[1];
      }

      // Try to get picture from tags
      const pictureTag = eventData.event.tags.find(tag => tag[0] === 'picture');
      if (pictureTag?.[1]) {
        return pictureTag[1];
      }
    }

    return null;
  }

  getArticleIcon(kind: number): string {
    switch (kind) {
      case 30023:
        return 'article';
      case 30311:
        return 'sensors';
      case 32100:
        return 'queue_music';
      case 34236:
        return 'smart_display';
      case 39089:
        return 'group_add';
      default:
        return 'description';
    }
  }

  getArticleLoadingState(article: ParsedArticle): 'loading' | 'loaded' | 'failed' | undefined {
    const key = `${article.kind}:${article.pubkey}:${article.identifier}`;
    return this.articleLoadingState().get(key);
  }

  shouldShowReferences = computed<boolean>(() => {
    return this.mentions().length > 0 || this.articles().length > 0;
  });

  private async loadKind34236FromClipsRelays(article: ParsedArticle): Promise<NostrRecord | null> {
    const relayUrls = await this.getClipsRelayUrlsForResolution();
    if (relayUrls.length === 0) {
      return null;
    }

    const events = await this.relayPool.query(
      relayUrls,
      {
        kinds: [34236],
        authors: [article.pubkey],
        '#d': [article.identifier],
        limit: 1,
      },
      5000
    );

    if (!events || events.length === 0) {
      return null;
    }

    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    await this.database.saveEvent({ ...latest, dTag: article.identifier });
    return this.utilities.toRecord(latest);
  }

  private getClipsRelayUrlsForResolution(): Promise<string[]> {
    if (this.clipsRelayUrlsPromise) {
      return this.clipsRelayUrlsPromise;
    }

    this.clipsRelayUrlsPromise = this.resolveClipsRelayUrls();
    return this.clipsRelayUrlsPromise;
  }

  private async resolveClipsRelayUrls(): Promise<string[]> {
    const accountPubkey = this.accountState.pubkey();
    if (!accountPubkey) {
      return [...DEFAULT_CLIPS_RELAYS];
    }

    try {
      const relaySetEvent = await this.database.getParameterizedReplaceableEvent(
        accountPubkey,
        RELAY_SET_KIND,
        CLIPS_RELAY_SET_D_TAG
      );

      const configuredRelays = relaySetEvent
        ? relaySetEvent.tags
          .filter(tag => tag[0] === 'relay' && !!tag[1])
          .map(tag => tag[1])
        : [];

      const merged = this.utilities.getUniqueNormalizedRelayUrls([
        ...configuredRelays,
        ...DEFAULT_CLIPS_RELAYS,
      ]);

      return this.relaysService.getOptimalRelays(merged, 8);
    } catch {
      return [...DEFAULT_CLIPS_RELAYS];
    }
  }

  private getAccountKey(): string {
    return this.accountState.pubkey() || ANONYMOUS_PUBKEY;
  }

  private persistCurrentClipToStorage(event: Event): void {
    const payload = {
      version: 1,
      savedAt: this.utilities.currentDate(),
      event,
    };

    this.localStorage.setObject(
      `${CLIPS_CURRENT_EVENT_STORAGE_PREFIX}:${this.getAccountKey()}`,
      payload
    );
  }
}