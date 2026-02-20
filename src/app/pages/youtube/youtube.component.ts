import { ChangeDetectionStrategy, Component, inject, signal, effect, computed } from '@angular/core';

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
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { Event, Filter } from 'nostr-tools';
import { PanelHeaderComponent } from '../../components/panel-header/panel-header.component';

interface YouTubeChannelEntry {
  channelId: string;
  title: string;
  description: string;
  image: string;
  feedUrl: string;
}

interface YouTubeChannel extends YouTubeChannelEntry {
  videoCount: number;
  loading: boolean;
  error?: string;
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
    PanelHeaderComponent,
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
            <p class="cta-hint">Includes all premium features &bull; Cancel anytime</p>
          </div>
        </div>
      </div>
    } @else {
      <app-panel-header
        title="YouTube"
        [showBack]="false"
      >
        @if (oldBookmarkCount() > 0) {
          <button mat-icon-button (click)="migrateOldBookmarks()" [disabled]="migrating()" matTooltip="Migrate old bookmarks ({{ oldBookmarkCount() }})">
            <mat-icon>sync</mat-icon>
          </button>
        }
        <button mat-icon-button (click)="refreshAll()" [disabled]="loading()" matTooltip="Refresh all channels">
          <mat-icon>refresh</mat-icon>
        </button>
        <button mat-icon-button (click)="openAddChannelDialog()" matTooltip="Add YouTube channel">
          <mat-icon>add</mat-icon>
        </button>
      </app-panel-header>

      <div class="youtube-container">
        @if (loading() && channels().length === 0) {
          <div class="loading-container">
            <mat-spinner diameter="32" />
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
          <div class="channels-list">
            @for (channel of channels(); track channel.channelId) {
              <div
                class="channel-item"
                tabindex="0"
                role="button"
                (click)="openChannelVideos(channel)"
                (keydown.enter)="openChannelVideos(channel)"
                (keydown.space)="openChannelVideos(channel)"
              >
                <div class="channel-avatar-wrapper">
                  @if (channel.image) {
                    <img [src]="channel.image" [alt]="channel.title" class="channel-avatar" />
                  } @else {
                    <div class="channel-avatar-placeholder">
                      <mat-icon>smart_display</mat-icon>
                    </div>
                  }
                </div>
                <div class="channel-info">
                  <span class="channel-name">{{ channel.title }}</span>
                  <span class="channel-meta">
                    @if (channel.loading) {
                      Loading...
                    } @else if (channel.error) {
                      <span class="channel-error-text">Error loading videos</span>
                    } @else if (channel.videoCount > 0) {
                      {{ channel.videoCount }} videos
                    } @else {
                      No videos
                    }
                  </span>
                </div>
                <div class="channel-actions">
                  @if (channel.loading) {
                    <mat-spinner diameter="20" />
                  }
                  <button mat-icon-button [matMenuTriggerFor]="channelMenu" (click)="$event.stopPropagation()" matTooltip="Channel options">
                    <mat-icon>more_vert</mat-icon>
                  </button>
                  <mat-menu #channelMenu="matMenu">
                    <button mat-menu-item (click)="refreshChannel(channel)">
                      <mat-icon>refresh</mat-icon>
                      <span>Refresh</span>
                    </button>
                    <button mat-menu-item (click)="removeChannel(channel.channelId)">
                      <mat-icon>delete</mat-icon>
                      <span>Remove</span>
                    </button>
                  </mat-menu>
                </div>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
  styleUrl: './youtube.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class YouTubeComponent {
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly corsProxy = inject(CorsProxyService);
  private readonly nostrService = inject(NostrService);
  private readonly layout = inject(LayoutService);
  private readonly logger = inject(LoggerService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly app = inject(ApplicationService);

  readonly loading = signal(true);
  readonly channels = signal<YouTubeChannel[]>([]);
  readonly channelEntries = signal<YouTubeChannelEntry[]>([]);
  readonly migrating = signal(false);
  readonly oldBookmarkCount = signal(0);

  readonly isPremium = computed(() => {
    const subscription = this.accountState.subscription();
    return subscription?.expires && subscription.expires > Date.now();
  });

  constructor() {
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey && this.isPremium()) {
        setTimeout(() => {
          this.loadYouTubeBookmarks();
          this.checkForOldBookmarks();
        }, 0);
      }
    });
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

  openChannelVideos(channel: YouTubeChannel): void {
    this.layout.navigateToRightPanel(`youtube/channel/${channel.channelId}`, {
      state: {
        title: channel.title,
        feedUrl: channel.feedUrl,
        image: channel.image,
      },
    });
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
      this.logger.error('Error creating YouTube bookmark:', error);
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
      this.logger.error('Error removing YouTube channel:', error);
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
        this.logger.error('Failed to parse YouTube channels event content');
      }

      this.channelEntries.set(entries);

      const channelList: YouTubeChannel[] = entries.map(entry => ({
        ...entry,
        videoCount: 0,
        loading: false,
      }));

      this.channels.set(channelList);

      // Fetch video counts for each channel
      for (const channel of channelList) {
        this.fetchChannelVideoCount(channel);
      }
    } catch (error) {
      this.logger.error('Error loading YouTube bookmarks:', error);
    } finally {
      this.loading.set(false);
    }
  }

  async checkForOldBookmarks(): Promise<void> {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) return;

      const oldEvents = await this.accountRelay.getMany<Event>({
        kinds: [30003],
        authors: [pubkey],
        '#t': ['youtube'],
      } as Filter);

      // Count channels that are not already in the new format
      const existingIds = new Set(this.channelEntries().map(e => e.channelId));
      const newChannels = oldEvents.filter(event => {
        const channel = this.parseOldBookmarkEvent(event);
        return channel && !existingIds.has(channel.channelId);
      });

      this.oldBookmarkCount.set(newChannels.length);
    } catch (error) {
      this.logger.error('Error checking for old bookmarks:', error);
    }
  }

  parseOldBookmarkEvent(event: Event): YouTubeChannelEntry | null {
    const tags = event.tags;
    const feedUrl = tags.find(t => t[0] === 'r')?.[1];
    if (!feedUrl) return null;

    const title = tags.find(t => t[0] === 'title')?.[1] || 'Unknown Channel';
    const description = tags.find(t => t[0] === 'description')?.[1] || '';
    const image = tags.find(t => t[0] === 'image')?.[1] || '';

    // Extract channel ID from feed URL
    const match = feedUrl.match(/channel_id=([A-Za-z0-9_-]+)/);
    const channelId = match?.[1] || '';
    if (!channelId) return null;

    return { channelId, title, description, image, feedUrl };
  }

  async migrateOldBookmarks(): Promise<void> {
    this.migrating.set(true);
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) return;

      const oldEvents = await this.accountRelay.getMany<Event>({
        kinds: [30003],
        authors: [pubkey],
        '#t': ['youtube'],
      } as Filter);

      if (oldEvents.length === 0) {
        this.snackBar.open('No old bookmarks found.', 'Close', { duration: 3000 });
        return;
      }

      const existingIds = new Set(this.channelEntries().map(e => e.channelId));
      const newEntries: YouTubeChannelEntry[] = [];

      for (const event of oldEvents) {
        const entry = this.parseOldBookmarkEvent(event);
        if (entry && !existingIds.has(entry.channelId)) {
          newEntries.push(entry);
          existingIds.add(entry.channelId);
        }
      }

      if (newEntries.length === 0) {
        this.snackBar.open('All channels already imported.', 'Close', { duration: 3000 });
        this.oldBookmarkCount.set(0);
        return;
      }

      const updated = [...this.channelEntries(), ...newEntries];
      await this.publishYouTubeEvent(updated);

      this.snackBar.open(
        `Migrated ${newEntries.length} channel${newEntries.length > 1 ? 's' : ''} successfully!`,
        'Close',
        { duration: 3000 }
      );

      this.oldBookmarkCount.set(0);
      await this.loadYouTubeBookmarks();
    } catch (error) {
      this.logger.error('Error migrating old bookmarks:', error);
      this.snackBar.open('Failed to migrate bookmarks. Please try again.', 'Close', { duration: 3000 });
    } finally {
      this.migrating.set(false);
    }
  }

  private async fetchChannelVideoCount(channel: YouTubeChannel): Promise<void> {
    this.channels.update(channels =>
      channels.map(c => (c.channelId === channel.channelId ? { ...c, loading: true, error: undefined } : c))
    );

    try {
      const xmlText = await this.corsProxy.fetchText(channel.feedUrl);
      const count = this.countVideosInFeed(xmlText);

      this.channels.update(channels =>
        channels.map(c => (c.channelId === channel.channelId ? { ...c, videoCount: count, loading: false } : c))
      );
    } catch (error) {
      this.logger.error(`Error fetching videos for ${channel.title}:`, error);
      this.channels.update(channels =>
        channels.map(c =>
          c.channelId === channel.channelId
            ? { ...c, loading: false, error: 'Failed to load videos' }
            : c
        )
      );
    }
  }

  private countVideosInFeed(xmlText: string): number {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    return doc.querySelectorAll('entry').length;
  }

  refreshChannel(channel: YouTubeChannel): void {
    this.fetchChannelVideoCount(channel);
  }

  refreshAll(): void {
    for (const channel of this.channels()) {
      this.fetchChannelVideoCount(channel);
    }
  }
}
