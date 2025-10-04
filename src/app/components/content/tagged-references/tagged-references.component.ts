import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { Event, nip19 } from 'nostr-tools';
import { ProfileDisplayNameComponent } from '../../user-profile/display-name/profile-display-name.component';
import { LayoutService } from '../../../services/layout.service';
import { DataService } from '../../../services/data.service';
import { NostrRecord } from '../../../interfaces';

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
}

@Component({
  selector: 'app-tagged-references',
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    ProfileDisplayNameComponent,
  ],
  templateUrl: './tagged-references.component.html',
  styleUrl: './tagged-references.component.scss',
})
export class TaggedReferencesComponent {
  private layout = inject(LayoutService);
  private data = inject(DataService);

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
      .filter(tag => tag[0] === 'a' && tag[1])
      .map(tag => {
        const parts = tag[1].split(':');
        if (parts.length !== 3) return null;

        return {
          kind: parseInt(parts[0], 10),
          pubkey: parts[1],
          identifier: parts[2],
          relay: tag[2] || undefined,
          marker: tag[3] || undefined,
        } as ParsedArticle;
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

  // Load article data when needed
  private async loadArticleData(article: ParsedArticle): Promise<void> {
    const key = `${article.kind}:${article.pubkey}:${article.identifier}`;

    if (this.articleData().has(key)) return;

    try {
      const eventData = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
        article.pubkey,
        article.kind,
        article.identifier,
        { cache: true, save: true }
      );

      this.articleData.update(map => {
        const newMap = new Map(map);
        newMap.set(key, eventData);
        return newMap;
      });
    } catch (error) {
      console.error('Failed to load article data:', error);
      this.articleData.update(map => {
        const newMap = new Map(map);
        newMap.set(key, null);
        return newMap;
      });
    }
  }

  onMentionClick(mention: ParsedMention): void {
    const npub = nip19.npubEncode(mention.pubkey);
    this.layout.openProfile(npub);
  }

  onArticleClick(article: ParsedArticle): void {
    const naddr = nip19.naddrEncode({
      identifier: article.identifier,
      kind: article.kind,
      pubkey: article.pubkey,
      relays: article.relay ? [article.relay] : undefined,
    });

    const key = `${article.kind}:${article.pubkey}:${article.identifier}`;
    const eventData = this.articleData().get(key);

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
      case 32100:
        return 'Playlist';
      case 39089:
        return 'Starter Pack';
      default:
        return `Kind ${kind}`;
    }
  }

  shouldShowReferences = computed<boolean>(() => {
    return this.mentions().length > 0 || this.articles().length > 0;
  });
}