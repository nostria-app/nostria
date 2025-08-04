import { Component, inject, signal, computed, effect } from '@angular/core';

import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { LoadingOverlayComponent } from '../../components/loading-overlay/loading-overlay.component';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AgoPipe } from '../../pipes/ago.pipe';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { Event, kinds, nip19, NostrEvent } from 'nostr-tools';
import { RelayService } from '../../services/relay.service';
import { standardizedTag } from '../../standardized-tags';
import { ApplicationService } from '../../services/application.service';
import { UtilitiesService } from '../../services/utilities.service';
import { DataService } from '../../services/data.service';

interface Article {
  id: string;
  title: string;
  summary: string;
  content: string;
  author: {
    pubkey: string;
    name?: string;
    picture?: string;
  };
  publishedAt: number;
  tags: string[];
  readTimeMinutes: number;
  imageUrl?: string;
  event: Event;
}

@Component({
  selector: 'app-articles',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule,
    MatMenuModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    LoadingOverlayComponent,
    AgoPipe,
  ],
  templateUrl: './articles.component.html',
  styleUrl: './articles.component.scss',
})
export class ArticlesComponent {
  private router = inject(Router);
  private nostrService = inject(NostrService);
  private relaysService = inject(RelayService);
  private readonly app = inject(ApplicationService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private readonly utilities = inject(UtilitiesService);
  private readonly data = inject(DataService);

  isLoading = signal(true);
  articles = signal<Article[]>([]);
  error = signal<string | null>(null);
  selectedTag = signal<string | null>(null);

  // Extract unique tags from all articles
  availableTags = computed(() => {
    const tagSet = new Set<string>();
    this.articles().forEach(article => {
      article.tags.forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet);
  });

  // Filter articles based on selected tag
  filteredArticles = computed(() => {
    const tag = this.selectedTag();
    if (!tag) return this.articles();
    return this.articles().filter(article => article.tags.includes(tag));
  });

  constructor() {
    // Load articles when component is initialized
    effect(() => {
      if (this.app.initialized()) {
        this.loadArticles();
      }
    });
  }

  async loadArticles(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      // Get relay URLs from the nostr service
      const relayUrls = this.relaysService.relays.map(relay => relay.url);

      if (!relayUrls || relayUrls.length === 0) {
        this.error.set('No relays available to fetch articles');
        this.isLoading.set(false);
        return;
      }

      // Create a temporary pool for fetching articles
      const pool = this.relaysService.createPool();

      // Subscribe to long-form content (kind 30023 for long-form articles in Nostr)
      const articlesEvents = await pool.subscribe(
        relayUrls,
        {
          kinds: [kinds.LongFormArticle],
          limit: 50,
        },
        {
          onevent: async (event: NostrEvent) => {
            // const content = JSON.parse(event.content);
            const content = event.content;

            // Extract image URL from tags if available
            let imageUrl;
            const imageTags = event.tags.filter(tag => tag[0] === 'image');
            if (imageTags.length > 0 && imageTags[0][1]) {
              imageUrl = imageTags[0][1];
            }

            // Extract article tags
            const articleTags = event.tags
              .filter(tag => tag[0] === 't')
              .map(tag => tag[1]);

            // Calculate approximate read time (average reading speed: 200 words per minute)
            const wordCount = content?.split(/\s+/).length || 0;
            const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

            const titleTag = this.nostrService.getTags(
              event,
              standardizedTag.title
            );
            const imageTag = this.nostrService.getTags(
              event,
              standardizedTag.image
            );
            const summaryTag = this.nostrService.getTags(
              event,
              standardizedTag.summary
            );
            const published_atTag = this.nostrService.getTags(
              event,
              standardizedTag.published_at
            );

            const article = {
              event: event,
              id: event.id,
              title: titleTag[0],
              summary: summaryTag[0] || this.generateSummary(content),
              content: content,
              author: {
                pubkey: event.pubkey,
                // We'll fetch author metadata separately
              },
              publishedAt: published_atTag[0]
                ? parseInt(published_atTag[0])
                : event.created_at,
              tags: articleTags.length > 0 ? articleTags : ['uncategorized'],
              readTimeMinutes,
              imageUrl,
            };

            // Sort articles by published date (newest first)
            // articles.sort((a, b) => b.publishedAt - a.publishedAt);

            // Set the articles signal
            // this.articles.set(articles);

            this.articles.update(articles => [...articles, article]);
          },
        }
      );

      //   this.logger.debug('Fetched article events:', articlesEvents);

      //   // Convert Nostr events to our Article interface
      //   const articles: Article[] = articlesEvents
      //     .filter(event => {
      //       try {
      //         // Ensure the event has valid JSON content with at least a title
      //         const content = JSON.parse(event.content);
      //         return !!content.title;
      //       } catch (e) {
      //         return false;
      //       }
      //     })
      //     .map(event => {
      //       try {

      //       } catch (e) {
      //         this.logger.error('Error parsing article:', e);
      //         return null;
      //       }
      //     })
      //     .filter(Boolean) as Article[];

      // Load author metadata for each article
      this.loadArticleAuthors();
    } catch (error) {
      this.logger.error('Error loading articles:', error);
      this.error.set('Failed to load articles');
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadArticleAuthors(): Promise<void> {
    // Get unique author pubkeys
    const authors = [
      ...new Set(this.articles().map(article => article.author)),
    ];
    const pubkeys = authors.map(author => author.pubkey);

    try {
      // Fetch metadata for all authors
      const metadata = await this.data.getProfiles(pubkeys);
      // const metadata = await this.nostrService.getMetadataForUsers(pubkeys);

      // Update articles with author information
      this.articles.update(articles => {
        return articles.map(article => {
          const authorMetadata = metadata?.find(
            author => author.event.pubkey === article.author.pubkey
          );
          if (authorMetadata) {
            try {
              // const parsed = JSON.parse(authorMetadata.content);
              return {
                ...article,
                author: {
                  ...article.author,
                  name:
                    authorMetadata.data.name ||
                    authorMetadata.data.display_name,
                  picture: authorMetadata.data.picture,
                },
              };
            } catch (e) {
              return article;
            }
          }
          return article;
        });
      });
    } catch (error) {
      this.logger.error('Error loading article authors:', error);
    }
  }

  private generateSummary(content: string): string {
    if (!content) return '';
    // Create a summary from the first ~150 chars of content
    const summary = content.slice(0, 150).trim();
    return summary.length < content.length ? `${summary}...` : summary;
  }

  selectTag(tag: string | null): void {
    this.selectedTag.set(tag);
  }

  viewArticle(article: Article): void {
    this.logger.debug('Viewing article:', article);
    const dTag = this.utilities.getDTagValueFromTags(article.event.tags);

    if (!dTag) {
      // For now, we'll show a message since we don't have an article detail page yet
      this.snackBar.open('No article slug found. Cannot open.', 'Close', {
        duration: 3000,
      });
      return;
    }

    const pointer: nip19.AddressPointer = {
      identifier: dTag,
      pubkey: article.author.pubkey,
      kind: kinds.LongFormArticle,
    };

    const encodedUri = nip19.naddrEncode(pointer);

    console.log('Encoded Nostr Address:', encodedUri);
    this.router.navigate(['/a', encodedUri], {
      state: { event: article.event },
    });
  }

  copyArticleLink(article: Article, event: globalThis.Event): void {
    event.stopPropagation();
    // In a real implementation, create and copy a shareable link
    const link = `https://nostria.app/a/${article.id}`;
    navigator.clipboard
      .writeText(link)
      .then(() => {
        this.snackBar.open('Article link copied to clipboard', 'Close', {
          duration: 3000,
        });
      })
      .catch(err => {
        this.logger.error('Failed to copy article link:', err);
        this.snackBar.open('Failed to copy link', 'Close', {
          duration: 3000,
        });
      });
  }

  shareArticle(article: Article, event: globalThis.Event): void {
    event.stopPropagation();
    // In a real implementation, open native share dialog if available
    if (navigator.share) {
      navigator
        .share({
          title: article.title,
          text: article.summary,
          url: `https://nostria.app/a/${article.id}`,
        })
        .catch(err => {
          this.logger.error('Error sharing article:', err);
        });
    } else {
      this.copyArticleLink(article, event);
    }
  }

  refreshArticles(): void {
    this.loadArticles();
  }
}
