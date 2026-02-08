import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CorsProxyService } from '../../../services/cors-proxy.service';

export interface AddYouTubeChannelData {
  channelId: string;
  feedUrl: string;
  title: string;
  description: string;
  image: string;
}

@Component({
  selector: 'app-add-youtube-channel-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>Add YouTube Channel</h2>
    <mat-dialog-content>
      <div class="form-container">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Channel URL, ID, or Feed URL</mat-label>
          <input
            matInput
            [(ngModel)]="channelInput"
            (ngModelChange)="onInputChange()"
            placeholder="https://www.youtube.com/&#64;NASA or channel ID"
          />
          <mat-hint>Paste a YouTube channel URL, &#64;handle, channel ID, or RSS feed URL</mat-hint>
          @if (error()) {
            <mat-error>{{ error() }}</mat-error>
          }
        </mat-form-field>

        @if (loading()) {
          <div class="loading-indicator">
            <mat-spinner diameter="24" />
            <span>Fetching channel info...</span>
          </div>
        }

        @if (channelTitle()) {
          <div class="channel-preview">
            @if (channelImage()) {
              <img [src]="channelImage()" [alt]="channelTitle()" class="channel-preview-image" />
            }
            <div class="channel-preview-info">
              <span class="channel-preview-title">{{ channelTitle() }}</span>
              <span class="channel-preview-id">{{ channelId() }}</span>
            </div>
          </div>
        }

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Title</mat-label>
          <input matInput [(ngModel)]="title" placeholder="Channel name" />
          <mat-hint>Will be auto-filled from the feed if left empty</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Description (optional)</mat-label>
          <textarea
            matInput
            [(ngModel)]="description"
            rows="3"
            placeholder="Description of this channel"
          ></textarea>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Image URL (optional)</mat-label>
          <input matInput [(ngModel)]="image" placeholder="https://..." />
          <mat-hint>Channel avatar or thumbnail URL</mat-hint>
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
      @if (!channelTitle()) {
        <button
          mat-flat-button
          (click)="fetchAndValidate()"
          [disabled]="loading() || !channelInput.trim()"
        >
          <mat-icon>search</mat-icon>
          Fetch Channel
        </button>
      } @else {
        <button
          mat-flat-button
          (click)="fetchAndValidate()"
          [disabled]="loading()"
        >
          <mat-icon>add</mat-icon>
          Add Channel
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [
    `
      .form-container {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 400px;
        max-width: 500px;
      }

      .full-width {
        width: 100%;
      }

      .loading-indicator {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: var(--mat-sys-surface-container);
        border-radius: 8px;
      }

      .loading-indicator span {
        color: var(--mat-sys-on-surface-variant);
      }

      .channel-preview {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: var(--mat-sys-surface-container);
        border-radius: 8px;
        border: 1px solid var(--mat-sys-outline-variant);
      }

      .channel-preview-image {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        object-fit: cover;
      }

      .channel-preview-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .channel-preview-title {
        color: var(--mat-sys-on-surface);
      }

      .channel-preview-id {
        font-size: 0.85rem;
        color: var(--mat-sys-on-surface-variant);
      }

      @media (max-width: 599px) {
        .form-container {
          min-width: unset;
          width: 100%;
        }
      }
    `,
  ],
})
export class AddYouTubeChannelDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AddYouTubeChannelDialogComponent>);
  private readonly corsProxy = inject(CorsProxyService);

  channelInput = '';
  title = '';
  description = '';
  image = '';

  readonly loading = signal(false);
  readonly error = signal('');
  readonly channelId = signal('');
  readonly channelTitle = signal('');
  readonly channelImage = signal('');
  readonly feedUrl = signal('');

  onInputChange(): void {
    // Reset preview when input changes
    this.channelTitle.set('');
    this.channelImage.set('');
    this.error.set('');
  }

  async fetchAndValidate(): Promise<void> {
    const input = this.channelInput.trim();
    if (!input) return;

    // If we already have channel info, save and close
    if (this.channelTitle()) {
      this.save();
      return;
    }

    this.loading.set(true);
    this.error.set('');

    try {
      // Parse input to get channel ID and feed URL
      const parsed = await this.resolveChannelInput(input);
      if (!parsed) return; // Error already set by resolveChannelInput

      this.channelId.set(parsed.channelId);
      this.feedUrl.set(parsed.feedUrl);

      // Fetch and parse the RSS feed to get channel title
      const xmlText = await this.corsProxy.fetchText(parsed.feedUrl);
      const feedInfo = this.parseChannelFeed(xmlText);

      this.channelTitle.set(feedInfo.title);

      // Pre-fill title if empty
      if (!this.title) {
        this.title = feedInfo.title;
      }

      // Set channel image from page metadata or feed
      if (parsed.thumbnailUrl) {
        this.channelImage.set(parsed.thumbnailUrl);
        if (!this.image) {
          this.image = parsed.thumbnailUrl;
        }
      }
    } catch (err) {
      console.error('Error fetching channel:', err);
      this.error.set('Failed to fetch channel. Please check the input and try again.');
      this.channelTitle.set('');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Resolves user input (channel ID, feed URL, channel URL, or handle URL)
   * into a channel ID, feed URL, and optional thumbnail URL.
   */
  async resolveChannelInput(input: string): Promise<{ channelId: string; feedUrl: string; thumbnailUrl: string } | null> {
    if (input.includes('youtube.com/feeds/videos.xml')) {
      // Full feed URL provided
      const match = input.match(/channel_id=([A-Za-z0-9_-]+)/);
      const channelId = match ? match[1] : '';
      // Try to fetch thumbnail from channel page
      const thumbnailUrl = channelId ? await this.fetchChannelThumbnail(channelId) : '';
      return { channelId, feedUrl: input, thumbnailUrl };
    }

    if (input.includes('youtube.com/channel/')) {
      // Channel page URL with ID
      const match = input.match(/youtube\.com\/channel\/([A-Za-z0-9_-]+)/);
      if (match) {
        const channelId = match[1];
        const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const thumbnailUrl = await this.fetchChannelThumbnail(channelId);
        return { channelId, feedUrl, thumbnailUrl };
      }
    }

    if (input.includes('youtube.com/@') || input.startsWith('@')) {
      // Handle URL or bare handle - resolve by fetching the channel page
      let channelUrl: string;
      if (input.startsWith('@')) {
        channelUrl = `https://www.youtube.com/${input}`;
      } else {
        // Normalize: ensure it has the protocol
        channelUrl = input.startsWith('http') ? input : `https://${input}`;
      }

      const pageInfo = await this.resolveHandleUrl(channelUrl);
      if (!pageInfo) {
        this.error.set('Could not resolve YouTube handle. Please check the URL and try again.');
        return null;
      }
      return pageInfo;
    }

    // Assume it's a channel ID (with or without the UC prefix pattern)
    const channelId = input;
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const thumbnailUrl = await this.fetchChannelThumbnail(channelId);
    return { channelId, feedUrl, thumbnailUrl };
  }

  /**
   * Fetches a YouTube channel page (by handle URL) and extracts
   * the channel ID and thumbnail from the HTML metadata.
   */
  async resolveHandleUrl(channelUrl: string): Promise<{ channelId: string; feedUrl: string; thumbnailUrl: string } | null> {
    try {
      const html = await this.corsProxy.fetchText(channelUrl);

      const channelId = this.extractChannelIdFromHtml(html);
      if (!channelId) {
        return null;
      }

      const thumbnailUrl = this.extractThumbnailFromHtml(html);
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

      return { channelId, feedUrl, thumbnailUrl };
    } catch (err) {
      console.error('Error resolving handle URL:', err);
      return null;
    }
  }

  /**
   * Fetches the channel page by channel ID to extract the thumbnail.
   */
  async fetchChannelThumbnail(channelId: string): Promise<string> {
    try {
      const url = `https://www.youtube.com/channel/${channelId}`;
      const html = await this.corsProxy.fetchText(url);
      return this.extractThumbnailFromHtml(html);
    } catch {
      return '';
    }
  }

  /**
   * Extracts the channel ID from YouTube page HTML.
   * Looks for patterns like:
   * - <meta itemprop="channelId" content="UC...">
   * - <link rel="canonical" href="https://www.youtube.com/channel/UC...">
   * - "channelId":"UC..."
   * - <meta property="og:url" content="https://www.youtube.com/channel/UC...">
   */
  extractChannelIdFromHtml(html: string): string {
    // Try meta itemprop="channelId"
    const metaMatch = html.match(/<meta\s+itemprop=["']channelId["']\s+content=["']([^"']+)["']/i);
    if (metaMatch) return metaMatch[1];

    // Try canonical link
    const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']https?:\/\/www\.youtube\.com\/channel\/([A-Za-z0-9_-]+)["']/i);
    if (canonicalMatch) return canonicalMatch[1];

    // Try og:url meta tag
    const ogMatch = html.match(/<meta\s+property=["']og:url["']\s+content=["']https?:\/\/www\.youtube\.com\/channel\/([A-Za-z0-9_-]+)["']/i);
    if (ogMatch) return ogMatch[1];

    // Try JSON-LD or inline script data
    const jsonMatch = html.match(/"channelId"\s*:\s*"([A-Za-z0-9_-]+)"/);
    if (jsonMatch) return jsonMatch[1];

    // Try externalId in ytInitialData
    const externalIdMatch = html.match(/"externalId"\s*:\s*"([A-Za-z0-9_-]+)"/);
    if (externalIdMatch) return externalIdMatch[1];

    return '';
  }

  /**
   * Extracts the channel thumbnail/avatar URL from YouTube page HTML.
   * Looks for og:image meta tag which contains the channel avatar.
   */
  extractThumbnailFromHtml(html: string): string {
    // Try og:image meta tag (usually the channel avatar)
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogImageMatch) return ogImageMatch[1];

    // Try name="og:image" variant
    const ogImageNameMatch = html.match(/<meta\s+name=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogImageNameMatch) return ogImageNameMatch[1];

    // Try twitter:image
    const twitterImageMatch = html.match(/<meta\s+(?:name|property)=["']twitter:image["']\s+content=["']([^"']+)["']/i);
    if (twitterImageMatch) return twitterImageMatch[1];

    return '';
  }

  /**
   * Parses the RSS feed XML and extracts the channel title.
   */
  parseChannelFeed(xmlText: string): { title: string } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');

    // Check for parsing errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error('Invalid RSS feed');
    }

    // Get channel title from feed
    const titleElement = doc.querySelector('feed > title');
    const title = titleElement?.textContent || '';

    if (!title) {
      throw new Error('Could not find channel title in feed');
    }

    return { title };
  }

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (!this.channelTitle() || !this.feedUrl()) {
      return;
    }

    const result: AddYouTubeChannelData = {
      channelId: this.channelId(),
      feedUrl: this.feedUrl(),
      title: this.title.trim() || this.channelTitle(),
      description: this.description.trim(),
      image: this.image.trim(),
    };

    this.dialogRef.close(result);
  }
}
