import { Component, inject, signal, effect, computed } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterModule } from '@angular/router';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { CorsProxyService } from '../../services/cors-proxy.service';
import { NostrService } from '../../services/nostr.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { LayoutService } from '../../services/layout.service';
import { MediaItem } from '../../interfaces';
import { Event } from 'nostr-tools';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DatePipe, SlicePipe } from '@angular/common';

interface YouTubeChannelEntry {
  channelId: string;
  title: string;
  description: string;
  image: string;
  feedUrl: string;
}

interface YouTubeChannel extends YouTubeChannelEntry {
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
    MatTooltipModule,
    MatMenuModule,
    MatDialogModule,
    MatSnackBarModule,
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
            <button mat-flat-button (click)="openAddChannelDialog()" matTooltip="Add YouTube channel">
              <mat-icon>add</mat-icon>
              Add Channel
            </button>
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
            <p>Add YouTube channels to watch your favorite content directly in Nostria.</p>
            <button mat-flat-button (click)="openAddChannelDialog()">
              <mat-icon>add</mat-icon>
              Add Your First Channel
            </button>
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
                <div class="video-actions">
                  <button mat-button (click)="closeVideo()">
                    <mat-icon>close</mat-icon>
                    Close
                  </button>
                  <button mat-button (click)="playNow(currentVideo()!)">
                    <mat-icon>play_arrow</mat-icon>
                    Play now
                  </button>
                  <button mat-button (click)="addToQueue(currentVideo()!)">
                    <mat-icon>queue</mat-icon>
                    Add to queue
                  </button>
                </div>
              </div>
            </div>
          }

          <!-- Channel sections -->
          @for (channel of channels(); track channel.channelId) {
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
                  <button mat-icon-button (click)="removeChannel(channel.channelId)" matTooltip="Remove channel">
                    <mat-icon>delete</mat-icon>
                  </button>
                  <button mat-icon-button (click)="toggleChannel(channel.channelId)" [matTooltip]="isChannelCollapsed(channel.channelId) ? 'Expand' : 'Collapse'">
                    <mat-icon>{{ isChannelCollapsed(channel.channelId) ? 'expand_more' : 'expand_less' }}</mat-icon>
                  </button>
                </div>
              </div>

              @if (channel.error) {
                <div class="channel-error">
                  <mat-icon>error_outline</mat-icon>
                  <span>{{ channel.error }}</span>
                </div>
              }

              @if (!isChannelCollapsed(channel.channelId)) {
                @if (channel.videos.length > 0) {
                  <div class="videos-grid">
                    @for (video of channel.videos; track video.videoId) {
                      <div class="video-card">
                        <div class="video-thumbnail" tabindex="0" role="button" (click)="playVideo(video)" (keydown.enter)="playVideo(video)" (keydown.space)="playVideo(video)">
                          <img [src]="video.thumbnail" [alt]="video.title" loading="lazy" />
                          <div class="play-overlay">
                            <mat-icon>play_circle</mat-icon>
                          </div>
                        </div>
                        <div class="video-details">
                          <div class="video-title-row">
                            <h3 class="video-title">{{ video.title }}</h3>
                            <button mat-icon-button [matMenuTriggerFor]="videoMenu" class="video-menu-btn" (click)="$event.stopPropagation()">
                              <mat-icon>more_vert</mat-icon>
                            </button>
                            <mat-menu #videoMenu="matMenu">
                              <button mat-menu-item (click)="playNow(video)">
                                <mat-icon>play_arrow</mat-icon>
                                <span>Play now</span>
                              </button>
                              <button mat-menu-item (click)="addToQueue(video)">
                                <mat-icon>queue</mat-icon>
                                <span>Add to queue</span>
                              </button>
                            </mat-menu>
                          </div>
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
  private readonly nostrService = inject(NostrService);
  private readonly mediaPlayer = inject(MediaPlayerService);
  private readonly layout = inject(LayoutService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly app = inject(ApplicationService);

  readonly loading = signal(true);
  readonly channels = signal<YouTubeChannel[]>([]);
  readonly channelEntries = signal<YouTubeChannelEntry[]>([]);
  readonly currentVideo = signal<YouTubeVideo | null>(null);
  readonly collapsedChannels = signal<Set<string>>(new Set());

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

  toggleChannel(channelId: string): void {
    this.collapsedChannels.update(set => {
      const newSet = new Set(set);
      if (newSet.has(channelId)) {
        newSet.delete(channelId);
      } else {
        newSet.add(channelId);
      }
      return newSet;
    });
  }

  isChannelCollapsed(channelId: string): boolean {
    return this.collapsedChannels().has(channelId);
  }

  async openAddChannelDialog(): Promise<void> {
    const { AddYouTubeChannelDialogComponent } = await import(
      './add-youtube-channel-dialog/add-youtube-channel-dialog.component'
    );

    const dialogRef = this.dialog.open(AddYouTubeChannelDialogComponent, {
      width: '500px',
      maxWidth: '95vw',
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      await this.createYouTubeBookmarkSet(result);
    }
  }

  private async createYouTubeBookmarkSet(data: {
    channelId: string;
    feedUrl: string;
    title: string;
    description: string;
    image: string;
  }): Promise<void> {
    try {
      const entry: YouTubeChannelEntry = {
        channelId: data.channelId,
        title: data.title,
        description: data.description,
        image: data.image,
        feedUrl: data.feedUrl,
      };

      // Get existing channels and add the new one
      const existing = this.channelEntries();
      const updated = [...existing, entry];

      await this.publishYouTubeEvent(updated);

      this.snackBar.open('YouTube channel added!', 'Close', { duration: 3000 });

      // Reload channels to include the new one
      await this.loadYouTubeBookmarks();
    } catch (error) {
      console.error('Error creating YouTube bookmark:', error);
      this.snackBar.open('Failed to add channel. Please try again.', 'Close', { duration: 3000 });
    }
  }

  async removeChannel(channelId: string): Promise<void> {
    try {
      const existing = this.channelEntries();
      const updated = existing.filter(e => e.channelId !== channelId);

      await this.publishYouTubeEvent(updated);

      this.snackBar.open('YouTube channel removed.', 'Close', { duration: 3000 });

      // Remove from local state immediately
      this.channels.update(channels => channels.filter(c => c.channelId !== channelId));
      this.channelEntries.set(updated);
    } catch (error) {
      console.error('Error removing YouTube channel:', error);
      this.snackBar.open('Failed to remove channel. Please try again.', 'Close', { duration: 3000 });
    }
  }

  private async publishYouTubeEvent(entries: YouTubeChannelEntry[]): Promise<void> {
    const content = JSON.stringify(entries);
    const tags: string[][] = [
      ['d', 'youtube-channels'],
    ];

    const event = this.nostrService.createEvent(30078, content, tags);
    const signedEvent = await this.nostrService.signEvent(event);

    if (!signedEvent) {
      throw new Error('Failed to sign event');
    }

    await this.accountRelay.publish(signedEvent);
  }

  async loadYouTubeBookmarks(): Promise<void> {
    this.loading.set(true);
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) return;

      // Fetch the single kind 30078 YouTube channels event
      const events = await this.accountRelay.getMany<Event>({
        kinds: [30078],
        authors: [pubkey],
        '#d': ['youtube-channels'],
      });

      if (events.length === 0) {
        this.channels.set([]);
        this.channelEntries.set([]);
        this.loading.set(false);
        return;
      }

      // Use the most recent event
      const latestEvent = events.reduce((a, b) =>
        a.created_at > b.created_at ? a : b
      );

      // Parse channels from content JSON
      let entries: YouTubeChannelEntry[] = [];
      try {
        entries = JSON.parse(latestEvent.content);
      } catch {
        console.error('Failed to parse YouTube channels event content');
      }

      this.channelEntries.set(entries);

      const channelList: YouTubeChannel[] = entries.map(entry => ({
        ...entry,
        videos: [],
        loading: false,
      }));

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

  async fetchChannelVideos(channel: YouTubeChannel): Promise<void> {
    // Update channel loading state
    this.channels.update(channels =>
      channels.map(c => (c.channelId === channel.channelId ? { ...c, loading: true, error: undefined } : c))
    );

    try {
      // Use our CORS proxy to fetch the RSS feed
      const xmlText = await this.corsProxy.fetchText(channel.feedUrl);
      const videos = this.parseRssFeed(xmlText, channel.title, channel.channelId);

      this.channels.update(channels =>
        channels.map(c => (c.channelId === channel.channelId ? { ...c, videos, loading: false } : c))
      );
    } catch (error) {
      console.error(`Error fetching videos for ${channel.title}:`, error);
      this.channels.update(channels =>
        channels.map(c =>
          c.channelId === channel.channelId
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

  private createMediaItem(video: YouTubeVideo): MediaItem {
    return {
      artwork: video.thumbnail,
      title: video.title,
      artist: video.channelTitle,
      source: `https://www.youtube.com/watch?v=${video.videoId}`,
      type: 'YouTube',
    };
  }

  playNow(video: YouTubeVideo): void {
    const mediaItem = this.createMediaItem(video);
    this.mediaPlayer.play(mediaItem);
    this.snackBar.open('Playing in media player', 'Close', { duration: 2000 });
  }

  addToQueue(video: YouTubeVideo): void {
    const mediaItem = this.createMediaItem(video);
    this.mediaPlayer.enque(mediaItem);
    this.snackBar.open('Added to queue', 'Close', { duration: 2000 });
  }

  playVideo(video: YouTubeVideo): void {
    this.currentVideo.set(video);
    // Scroll to top to see the video player
    this.layout.scrollToTop();
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
