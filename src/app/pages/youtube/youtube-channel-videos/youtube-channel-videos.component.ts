import { ChangeDetectionStrategy, Component, inject, signal, effect } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DatePipe } from '@angular/common';
import { PanelHeaderComponent } from '../../../components/panel-header/panel-header.component';
import { CorsProxyService } from '../../../services/cors-proxy.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LoggerService } from '../../../services/logger.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { MediaItem } from '../../../interfaces';

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
  selector: 'app-youtube-channel-videos',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
    MatSnackBarModule,
    DatePipe,
    PanelHeaderComponent,
  ],
  template: `
    <app-panel-header
      [title]="channelTitle()"
      [showBack]="true"
      (backClick)="goBack()"
    >
      <button mat-icon-button (click)="refresh()" [disabled]="loading()" matTooltip="Refresh">
        <mat-icon>refresh</mat-icon>
      </button>
    </app-panel-header>

    <div class="videos-container">
      @if (loading()) {
        <div class="loading-container">
          <mat-spinner diameter="32" />
          <p>Loading videos...</p>
        </div>
      } @else if (error()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
          <button mat-flat-button (click)="refresh()">
            <mat-icon>refresh</mat-icon>
            Retry
          </button>
        </div>
      } @else if (videos().length === 0) {
        <div class="empty-state">
          <mat-icon>smart_display</mat-icon>
          <p>No videos found</p>
        </div>
      } @else {
        @for (video of videos(); track video.videoId) {
          <div class="video-item" tabindex="0" role="button" (click)="playNow(video)" (keydown.enter)="playNow(video)" (keydown.space)="playNow(video)">
            <div class="video-thumbnail">
              <img [src]="video.thumbnail" [alt]="video.title" loading="lazy" />
              <div class="play-overlay">
                <mat-icon>play_circle</mat-icon>
              </div>
            </div>
            <div class="video-info">
              <h3 class="video-title">{{ video.title }}</h3>
              <div class="video-meta">
                <span class="views">{{ formatViews(video.views) }} views</span>
                <span class="separator">&middot;</span>
                <span class="date">{{ video.published | date:'mediumDate' }}</span>
              </div>
            </div>
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
        }
      }
    </div>
  `,
  styleUrl: './youtube-channel-videos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class YouTubeChannelVideosComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly corsProxy = inject(CorsProxyService);
  private readonly mediaPlayer = inject(MediaPlayerService);
  private readonly logger = inject(LoggerService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly panelNav = inject(PanelNavigationService);

  readonly channelTitle = signal('Channel');
  readonly videos = signal<YouTubeVideo[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private channelId = '';
  private feedUrl = '';

  constructor() {
    effect(() => {
      const id = this.route.snapshot.paramMap.get('channelId');
      if (id) {
        this.channelId = id;
        const state = history.state;
        if (state?.title) {
          this.channelTitle.set(state.title);
        }
        if (state?.feedUrl) {
          this.feedUrl = state.feedUrl;
          this.fetchVideos();
        }
      }
    });
  }

  goBack(): void {
    this.panelNav.goBackRight();
  }

  refresh(): void {
    if (this.feedUrl) {
      this.fetchVideos();
    }
  }

  private async fetchVideos(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const xmlText = await this.corsProxy.fetchText(this.feedUrl);
      const videos = this.parseRssFeed(xmlText, this.channelTitle(), this.channelId);
      this.videos.set(videos);
    } catch (err) {
      this.logger.error(`Error fetching videos for ${this.channelTitle()}:`, err);
      this.error.set('Failed to load videos. Try refreshing.');
    } finally {
      this.loading.set(false);
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

  formatViews(views: number): string {
    if (views >= 1_000_000) {
      return `${(views / 1_000_000).toFixed(1)}M`;
    } else if (views >= 1_000) {
      return `${(views / 1_000).toFixed(1)}K`;
    }
    return views.toString();
  }
}
