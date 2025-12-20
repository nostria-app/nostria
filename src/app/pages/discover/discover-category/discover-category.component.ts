import { Component, inject, OnInit, signal, computed, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, takeUntil } from 'rxjs';
import {
  DiscoveryService,
  CategoryConfig,
  CONTENT_CATEGORIES,
  MEDIA_CATEGORIES,
  DiscoveryCategory,
} from '../../../services/discovery.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { ArticleComponent } from '../../../components/article/article.component';
import { EventComponent } from '../../../components/event/event.component';

/** Curated article item with parsed addressable ID and relay hints */
interface CuratedArticle {
  id: string;
  pubkey: string;
  slug: string;
  kind: number;
  relayHints?: string[];
  createdAt: number;
}

/** Generic curated item for creators, events, videos */
interface CuratedItem {
  id: string;
  pubkey: string;
  title?: string;
  image?: string;
  kind: number;
  createdAt: number;
}

@Component({
  selector: 'app-discover-category',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
    ArticleComponent,
    EventComponent,
  ],
  templateUrl: './discover-category.component.html',
  styleUrl: './discover-category.component.scss',
})
export class DiscoverCategoryComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private discoveryService = inject(DiscoveryService);
  private destroy$ = new Subject<void>();

  // Route params
  readonly categoryType = signal<'content' | 'media'>('content');
  readonly categoryId = signal<DiscoveryCategory | null>(null);

  // Category config
  readonly category = computed<CategoryConfig | null>(() => {
    const id = this.categoryId();
    const type = this.categoryType();
    if (!id) return null;

    const categories = type === 'content' ? CONTENT_CATEGORIES : MEDIA_CATEGORIES;
    return categories.find((c) => c.id === id) || null;
  });

  // Loading state
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // Curated content - all categories can have any content type
  readonly creators = signal<CuratedItem[]>([]);
  readonly articles = signal<CuratedArticle[]>([]);
  readonly events = signal<CuratedItem[]>([]);
  readonly videos = signal<CuratedItem[]>([]);
  readonly pictures = signal<CuratedItem[]>([]);

  // Special section titles based on category
  readonly specialSectionTitle = computed(() => {
    const cat = this.category();
    if (!cat) return 'Featured';

    switch (cat.id) {
      case 'finance':
        return 'Angor Hubs';
      case 'live':
        return 'Streamers';
      case 'podcasts':
        return 'Shows';
      case 'music':
        return 'Artists';
      case 'photography':
        return 'Photographers';
      case 'gaming':
        return 'Gamers';
      default:
        return 'Featured Creators';
    }
  });

  ngOnInit(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const category = params['category'] as DiscoveryCategory;

      // Determine type from URL path
      const url = this.router.url;
      const type = url.includes('/discover/media/') ? 'media' : 'content';

      this.categoryType.set(type);
      this.categoryId.set(category);

      this.loadCategoryContent();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadCategoryContent(): Promise<void> {
    const cat = this.category();
    if (!cat) {
      this.error.set('Category not found');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      // Load all curated content types - any category can have any content type
      const [creatorsData, articlesData, eventsData, videosData, picturesData] = await Promise.all([
        this.discoveryService.loadCuratedCreators(cat.id),
        this.discoveryService.loadCuratedArticles(cat.id),
        this.discoveryService.loadCuratedEvents(cat.id),
        this.discoveryService.loadCuratedVideos(cat.id),
        this.discoveryService.loadCuratedPictures(cat.id),
      ]);

      this.creators.set(creatorsData);
      // Parse and deduplicate articles
      this.articles.set(this.parseAndDeduplicateArticles(articlesData));
      this.events.set(eventsData);
      this.videos.set(videosData);
      this.pictures.set(picturesData);
    } catch (err) {
      console.error('Error loading category content:', err);
      this.error.set('Failed to load content. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  goBack(): void {
    const type = this.categoryType();
    this.router.navigate(['/discover'], {
      queryParams: type === 'media' ? { tab: 'media' } : undefined,
    });
  }

  viewCreator(pubkey: string): void {
    this.router.navigate(['/p', pubkey]);
  }

  viewEvent(item: CuratedItem): void {
    // Navigate to event view
    this.router.navigate(['/e', item.id]);
  }

  viewVideo(item: CuratedItem): void {
    // Navigate to video view
    this.router.navigate(['/v', item.id]);
  }

  viewPicture(item: CuratedItem): void {
    // Navigate to picture/event view
    this.router.navigate(['/e', item.id]);
  }

  /**
   * Parse addressable IDs (kind:pubkey:slug) into CuratedArticle items and deduplicate.
   */
  private parseAndDeduplicateArticles(items: { id: string; pubkey: string; relay?: string; kind: number; createdAt: number }[]): CuratedArticle[] {
    const seen = new Set<string>();
    const result: CuratedArticle[] = [];

    for (const item of items) {
      // Skip duplicates
      if (seen.has(item.id)) continue;
      seen.add(item.id);

      // Parse addressable ID: kind:pubkey:slug
      const parts = item.id.split(':');
      if (parts.length >= 3) {
        const kind = parseInt(parts[0], 10);
        const pubkey = parts[1];
        const slug = parts.slice(2).join(':'); // d-tag may contain colons

        result.push({
          id: item.id,
          pubkey,
          slug,
          kind: isNaN(kind) ? item.kind : kind,
          relayHints: item.relay ? [item.relay] : undefined,
          createdAt: item.createdAt,
        });
      }
    }

    return result;
  }
}
