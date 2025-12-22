import { Component, inject, signal, effect, computed } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { RouterModule } from '@angular/router';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { CorsProxyService } from '../../services/cors-proxy.service';
import { Event, Filter } from 'nostr-tools';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DatePipe, SlicePipe } from '@angular/common';

interface YouTubeChannel {
  id: string;
  title: string;
  description: string;
  image: string;
  feedUrl: string;
  videos: YouTubeVideo[];
  loading: boolean;
  error?: string;
}

interface YouTubeVideo {
  videoId: string;
  title: string;
  link: string;
  published: Date;
  thumbnail: string;
  description: string;
  views: number;
  channelTitle: string;
  channelId: string;
}

@Component({
  selector: 'app-youtube',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatTooltipModule,
    MatMenuModule,
    RouterModule,
    DatePipe,
    SlicePipe,
  ],
  template: `
    @if (!app.authenticated()) {
      <div class="unauthenticated-state">
        <mat-icon>account_circle</mat-icon>
        <h2>Sign in to use YouTube</h2>
        <p>Watch your favorite YouTube channels from Nostr bookmark sets.</p>
      </div>
    } @else if (!isPremium()) {
      <div class="premium-gate">
        <!-- Blurred preview background -->
        <div class="preview-backdrop">
          <div class="mock-videos-grid">
            <div class="mock-video-card">
              <div class="mock-thumbnail"></div>
              <div class="mock-title"></div>
              <div class="mock-channel"></div>
            </div>
            <div class="mock-video-card">
              <div class="mock-thumbnail"></div>
              <div class="mock-title"></div>
              <div class="mock-channel"></div>
            </div>
            <div class="mock-video-card">
              <div class="mock-thumbnail"></div>
              <div class="mock-title"></div>
              <div class="mock-channel"></div>
            </div>
            <div class="mock-video-card">
              <div class="mock-thumbnail"></div>
              <div class="mock-title"></div>
              <div class="mock-channel"></div>
            </div>
            <div class="mock-video-card">
              <div class="mock-thumbnail"></div>
              <div class="mock-title"></div>
              <div class="mock-channel"></div>
            </div>
            <div class="mock-video-card">
              <div class="mock-thumbnail"></div>
              <div class="mock-title"></div>
              <div class="mock-channel"></div>
            </div>
          </div>
        </div>

        <!-- Premium CTA overlay -->
        <div class="premium-cta-overlay">
          <div class="premium-badge">
            <mat-icon>smart_display</mat-icon>
          </div>
          <h1 class="premium-title">Unlock YouTube</h1>
          <p class="premium-subtitle">
            Watch your favorite YouTube channels directly in Nostria
          </p>

          <div class="features-grid">
            <div class="feature-card">
              <div class="feature-icon">
                <mat-icon>bookmark</mat-icon>
              </div>
              <h3>Nostr Bookmarks</h3>
              <p>Subscribe to channels using Nostr bookmark sets</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <mat-icon>rss_feed</mat-icon>
              </div>
              <h3>RSS Feeds</h3>
              <p>Get latest videos from your subscribed channels</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <mat-icon>play_circle</mat-icon>
              </div>
              <h3>In-App Viewing</h3>
              <p>Watch videos without leaving Nostria</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">
                <mat-icon>cloud_off</mat-icon>
              </div>
              <h3>No Google Account</h3>
              <p>Watch without signing into YouTube</p>
            </div>
          </div>

          <div class="cta-section">
            <a mat-flat-button routerLink="/premium/upgrade" class="upgrade-btn">
              <mat-icon>stars</mat-icon>
              Upgrade to Premium
            </a>
            <p class="cta-hint">Includes all premium features • Cancel anytime</p>
          </div>
        </div>
      </div>
    } @else {
      <div class="youtube-container">
        <header class="youtube-header">
          <h1>
            YouTube
            <mat-icon class="premium-icon">diamond</mat-icon>
          </h1>
          <div class="header-actions">
            <button mat-icon-button (click)="refreshAll()" [disabled]="loading()" matTooltip="Refresh all channels">
              <mat-icon>refresh</mat-icon>
            </button>
          </div>
        </header>

        @if (loading() && channels().length === 0) {
          <div class="loading-container">
            <mat-spinner />
            <p>Loading your YouTube subscriptions...</p>
          </div>
        } @else if (channels().length === 0) {
          <div class="empty-state">
            <mat-icon>smart_display</mat-icon>
            <h2>No YouTube subscriptions</h2>
            <p>Add YouTube channels to your bookmark sets with the "youtube" tag to see them here.</p>
            <div class="help-section">
              <h3>How to add a YouTube channel:</h3>
              <ol>
                <li>Create a bookmark set (kind 30003) with a "t" tag set to "youtube"</li>
                <li>Add an "r" tag with the YouTube RSS feed URL</li>
                <li>Optionally add "title", "description", and "image" tags</li>
              </ol>
            </div>
          </div>
        } @else {
          <!-- Currently playing video -->
          @if (currentVideo()) {
            <div class="video-player-section">
              <div class="video-player-container">
                <iframe
                  [src]="getEmbedUrl(currentVideo()!.videoId)"
                  frameborder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowfullscreen
                  class="video-player"
                ></iframe>
              </div>
              <div class="video-info">
                <h2>{{ currentVideo()!.title }}</h2>
                <div class="video-meta">
                  <span class="channel-name">{{ currentVideo()!.channelTitle }}</span>
                  <span class="separator">•</span>
                  <span class="views">{{ formatViews(currentVideo()!.views) }} views</span>
                  <span class="separator">•</span>
                  <span class="date">{{ currentVideo()!.published | date:'mediumDate' }}</span>
                </div>
                <button mat-button (click)="closeVideo()">
                  <mat-icon>close</mat-icon>
                  Close
                </button>
              </div>
            </div>
          }

          <!-- Channel sections -->
          @for (channel of channels(); track channel.id) {
            <section class="channel-section">
              <div class="channel-header">
                <div class="channel-info">
                  @if (channel.image) {
                    <img [src]="channel.image" [alt]="channel.title" class="channel-avatar" />
                  } @else {
                    <div class="channel-avatar-placeholder">
                      <mat-icon>smart_display</mat-icon>
                    </div>
                  }
                  <div class="channel-details">
                    <h2>{{ channel.title }}</h2>
                    @if (channel.description) {
                      <p class="channel-description">{{ channel.description | slice:0:150 }}{{ channel.description.length > 150 ? '...' : '' }}</p>
                    }
                  </div>
                </div>
                <div class="channel-actions">
                  @if (channel.loading) {
                    <mat-spinner diameter="24" />
                  }
                  <button mat-icon-button (click)="refreshChannel(channel)" [disabled]="channel.loading" matTooltip="Refresh">
                    <mat-icon>refresh</mat-icon>
                  </button>
                </div>
              </div>

              @if (channel.error) {
                <div class="channel-error">
                  <mat-icon>error_outline</mat-icon>
                  <span>{{ channel.error }}</span>
                </div>
              }

              @if (channel.videos.length > 0) {
                <div class="videos-grid">
                  @for (video of channel.videos; track video.videoId) {
                    <div class="video-card" tabindex="0" role="button" (click)="playVideo(video)" (keydown.enter)="playVideo(video)" (keydown.space)="playVideo(video)">
                      <div class="video-thumbnail">
                        <img [src]="video.thumbnail" [alt]="video.title" loading="lazy" />
                        <div class="play-overlay">
                          <mat-icon>play_circle</mat-icon>
                        </div>
                      </div>
                      <div class="video-details">
                        <h3 class="video-title">{{ video.title }}</h3>
                        <div class="video-meta">
                          <span class="views">{{ formatViews(video.views) }} views</span>
                          <span class="separator">•</span>
                          <span class="date">{{ video.published | date:'mediumDate' }}</span>
                        </div>
                      </div>
                    </div>
                  }
                </div>
              } @else if (!channel.loading) {
                <p class="no-videos">No videos found</p>
              }
            </section>
          }
        }
      </div>
    }
  `,
  styleUrl: './youtube.component.scss',
})
export class YouTubeComponent {
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly corsProxy = inject(CorsProxyService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly app = inject(ApplicationService);

  readonly loading = signal(true);
  readonly channels = signal<YouTubeChannel[]>([]);
  readonly currentVideo = signal<YouTubeVideo | null>(null);

  readonly isPremium = computed(() => {
    const subscription = this.accountState.subscription();
    return subscription?.expires && subscription.expires > Date.now();
  });

  constructor() {
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey && this.isPremium()) {
        setTimeout(() => this.loadYouTubeBookmarks(), 0);
      }
    });
  }

  async loadYouTubeBookmarks(): Promise<void> {
    this.loading.set(true);
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) return;

      // Fetch bookmark sets (kind 30003) with "youtube" tag
      const events = await this.accountRelay.getMany<Event>({
        kinds: [30003],
        authors: [pubkey],
        '#t': ['youtube'],
      } as Filter);

      if (events.length === 0) {
        this.channels.set([]);
        this.loading.set(false);
        return;
      }

      // Parse each bookmark set into a channel
      const channelList: YouTubeChannel[] = [];
      for (const event of events) {
        const channel = this.parseBookmarkEvent(event);
        if (channel) {
          channelList.push(channel);
        }
      }

      this.channels.set(channelList);

      // Load videos for each channel
      for (const channel of channelList) {
        this.fetchChannelVideos(channel);
      }
    } catch (error) {
      console.error('Error loading YouTube bookmarks:', error);
    } finally {
      this.loading.set(false);
    }
  }

  private parseBookmarkEvent(event: Event): YouTubeChannel | null {
    const tags = event.tags;
    const dTag = tags.find(t => t[0] === 'd')?.[1];
    const title = tags.find(t => t[0] === 'title')?.[1] || 'Unknown Channel';
    const description = tags.find(t => t[0] === 'description')?.[1] || '';
    const image = tags.find(t => t[0] === 'image')?.[1] || '';
    const feedUrl = tags.find(t => t[0] === 'r')?.[1];

    if (!feedUrl || !dTag) {
      return null;
    }

    return {
      id: dTag,
      title,
      description,
      image,
      feedUrl,
      videos: [],
      loading: false,
    };
  }

  async fetchChannelVideos(channel: YouTubeChannel): Promise<void> {
    // Update channel loading state
    this.channels.update(channels =>
      channels.map(c => (c.id === channel.id ? { ...c, loading: true, error: undefined } : c))
    );

    try {
      // Use our CORS proxy to fetch the RSS feed
      const xmlText = await this.corsProxy.fetchText(channel.feedUrl);
      const videos = this.parseRssFeed(xmlText, channel.title, channel.id);

      this.channels.update(channels =>
        channels.map(c => (c.id === channel.id ? { ...c, videos, loading: false } : c))
      );
    } catch (error) {
      console.error(`Error fetching videos for ${channel.title}:`, error);
      this.channels.update(channels =>
        channels.map(c =>
          c.id === channel.id
            ? { ...c, loading: false, error: 'Failed to load videos. Try refreshing.' }
            : c
        )
      );
    }
  }

  private parseRssFeed(xmlText: string, channelTitle: string, channelId: string): YouTubeVideo[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');

    const entries = doc.querySelectorAll('entry');
    const videos: YouTubeVideo[] = [];

    entries.forEach(entry => {
      const videoId = entry.querySelector('videoId')?.textContent || '';
      const title = entry.querySelector('title')?.textContent || '';
      const link = entry.querySelector('link[rel="alternate"]')?.getAttribute('href') || '';
      const publishedStr = entry.querySelector('published')?.textContent || '';
      const thumbnail = entry.querySelector('thumbnail')?.getAttribute('url') || 
                        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const description = entry.querySelector('description')?.textContent || '';
      const viewsStr = entry.querySelector('statistics')?.getAttribute('views') || '0';

      if (videoId && title) {
        videos.push({
          videoId,
          title,
          link,
          published: new Date(publishedStr),
          thumbnail,
          description,
          views: parseInt(viewsStr, 10) || 0,
          channelTitle,
          channelId,
        });
      }
    });

    return videos;
  }

  playVideo(video: YouTubeVideo): void {
    this.currentVideo.set(video);
    // Scroll to top to see the video player
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  closeVideo(): void {
    this.currentVideo.set(null);
  }

  getEmbedUrl(videoId: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube.com/embed/${videoId}?autoplay=1`
    );
  }

  formatViews(views: number): string {
    if (views >= 1_000_000) {
      return `${(views / 1_000_000).toFixed(1)}M`;
    } else if (views >= 1_000) {
      return `${(views / 1_000).toFixed(1)}K`;
    }
    return views.toString();
  }

  refreshChannel(channel: YouTubeChannel): void {
    this.fetchChannelVideos(channel);
  }

  refreshAll(): void {
    for (const channel of this.channels()) {
      this.fetchChannelVideos(channel);
    }
  }
}
