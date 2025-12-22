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
          <mat-label>Channel ID or Feed URL</mat-label>
          <input
            matInput
            [(ngModel)]="channelInput"
            (ngModelChange)="onInputChange()"
            placeholder="UC1XvxnHFtWruS9egyFasP1Q or full feed URL"
          />
          <mat-hint>Enter a YouTube channel ID or the RSS feed URL</mat-hint>
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

    // Parse input to get channel ID and feed URL
    let channelId = '';
    let feedUrl = '';

    if (input.includes('youtube.com/feeds/videos.xml')) {
      // Full feed URL provided
      feedUrl = input;
      const match = input.match(/channel_id=([A-Za-z0-9_-]+)/);
      if (match) {
        channelId = match[1];
      }
    } else if (input.includes('youtube.com/channel/')) {
      // Channel page URL
      const match = input.match(/youtube\.com\/channel\/([A-Za-z0-9_-]+)/);
      if (match) {
        channelId = match[1];
        feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      }
    } else if (input.includes('youtube.com/@')) {
      // Handle URL - we can't directly get the channel ID from this
      this.error.set('Please use the channel ID or feed URL. Handle URLs (@username) are not supported.');
      return;
    } else if (/^UC[A-Za-z0-9_-]{22}$/.test(input)) {
      // Just the channel ID (starts with UC and is 24 chars)
      channelId = input;
      feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    } else {
      // Assume it's a channel ID even if it doesn't match the pattern
      channelId = input;
      feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    }

    if (!feedUrl) {
      this.error.set('Invalid input. Please enter a channel ID or feed URL.');
      return;
    }

    this.channelId.set(channelId);
    this.feedUrl.set(feedUrl);
    this.loading.set(true);
    this.error.set('');

    try {
      const xmlText = await this.corsProxy.fetchText(feedUrl);
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');

      // Check for parsing errors
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        throw new Error('Invalid RSS feed');
      }

      // Get channel title from feed
      const titleElement = doc.querySelector('feed > title');
      const fetchedTitle = titleElement?.textContent || '';

      if (!fetchedTitle) {
        throw new Error('Could not find channel title in feed');
      }

      this.channelTitle.set(fetchedTitle);

      // Pre-fill title if empty
      if (!this.title) {
        this.title = fetchedTitle;
      }

      // Try to get channel image from author URI or construct from channel ID
      // YouTube doesn't include the avatar in the RSS feed, but we can try to get it
      // For now, leave it empty and let user provide it
      this.channelImage.set('');
    } catch (err) {
      console.error('Error fetching channel:', err);
      this.error.set('Failed to fetch channel. Please check the ID/URL and try again.');
      this.channelTitle.set('');
    } finally {
      this.loading.set(false);
    }
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
