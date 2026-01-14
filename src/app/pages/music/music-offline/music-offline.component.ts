import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { OfflineMusicService, OfflineMusicTrack } from '../../../services/offline-music.service';
import { MediaPlayerService } from '../../../services/media-player.service';
import { ApplicationService } from '../../../services/application.service';
import { MediaItem } from '../../../interfaces';

@Component({
  selector: 'app-music-offline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="offline-music-container">
      <div class="header">
        <h1>Offline Library</h1>
        <span class="spacer"></span>
        @if (tracks().length > 0) {
          <span class="storage-info">{{ totalStorage() }}</span>
        }
      </div>

      @if (!isOnline()) {
        <div class="offline-banner">
          <mat-icon>wifi_off</mat-icon>
          <span>You are offline. Only downloaded tracks are available.</span>
        </div>
      }

      @if (tracks().length === 0) {
        <div class="empty-state">
          <mat-icon>cloud_download</mat-icon>
          <h2>No offline music</h2>
          <p>Save tracks for offline listening by toggling "Make available offline" on any track.</p>
          <button mat-flat-button (click)="goToMusic()">
            <mat-icon>library_music</mat-icon>
            Browse Music
          </button>
        </div>
      } @else {
        <div class="track-list">
          @for (track of tracks(); track track.id) {
            <div class="track-card" (click)="openTrack(track)" (keydown.enter)="openTrack(track)" 
                 tabindex="0" role="button" [attr.aria-label]="'Play ' + track.title">
              
              <div class="track-cover">
                @if (track.imageUrl) {
                  <img [src]="track.imageUrl" [alt]="track.title" loading="lazy" />
                } @else {
                  <div class="cover-placeholder">
                    <mat-icon>music_note</mat-icon>
                  </div>
                }
              </div>

              <div class="track-info">
                <h4 class="track-title">{{ track.title }}</h4>
                <span class="track-artist">{{ track.artist }}</span>
                <span class="track-size">{{ formatSize(track.audioSize) }}</span>
              </div>

              <div class="track-actions">
                <button mat-icon-button (click)="playTrack($event, track)" aria-label="Play">
                  <mat-icon>play_arrow</mat-icon>
                </button>
                <button mat-icon-button (click)="removeTrack($event, track)" aria-label="Remove from offline">
                  <mat-icon>delete_outline</mat-icon>
                </button>
              </div>
            </div>
          }
        </div>

        <div class="actions-footer">
          <button mat-stroked-button (click)="clearAll()">
            <mat-icon>delete_sweep</mat-icon>
            Clear All Offline Music
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .offline-music-container {
      display: flex;
      flex-direction: column;
      padding: 1rem;
      padding-bottom: 120px;
      max-width: 800px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;

      h1 {
        margin: 0;
        font-size: 1.5rem;
        color: var(--mat-sys-on-surface);
      }

      .spacer {
        flex: 1;
      }

      .storage-info {
        color: var(--mat-sys-on-surface-variant);
        font-size: 0.875rem;
      }
    }

    .offline-banner {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background-color: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      border-radius: var(--mat-sys-corner-medium);
      margin-bottom: 1rem;

      mat-icon {
        font-size: 1.25rem;
        width: 1.25rem;
        height: 1.25rem;
      }
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem 2rem;
      gap: 1rem;
      text-align: center;

      mat-icon {
        font-size: 4rem;
        width: 4rem;
        height: 4rem;
        color: var(--mat-sys-on-surface-variant);
        opacity: 0.5;
      }

      h2 {
        margin: 0;
        color: var(--mat-sys-on-surface);
      }

      p {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
        max-width: 300px;
      }
    }

    .track-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .track-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      background-color: var(--mat-sys-surface-container-low);
      border-radius: var(--mat-sys-corner-medium);
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover {
        background-color: var(--mat-sys-surface-container);
      }
    }

    .track-cover {
      width: 56px;
      height: 56px;
      border-radius: var(--mat-sys-corner-small);
      overflow: hidden;
      flex-shrink: 0;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .cover-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, var(--mat-sys-primary-container) 0%, var(--mat-sys-secondary-container) 100%);

        mat-icon {
          font-size: 1.5rem;
          width: 1.5rem;
          height: 1.5rem;
          color: var(--mat-sys-on-primary-container);
          opacity: 0.7;
        }
      }
    }

    .track-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;

      .track-title {
        margin: 0;
        font-size: 1rem;
        color: var(--mat-sys-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .track-artist {
        font-size: 0.875rem;
        color: var(--mat-sys-on-surface-variant);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .track-size {
        font-size: 0.75rem;
        color: var(--mat-sys-outline);
      }
    }

    .track-actions {
      display: flex;
      align-items: center;
      gap: 0.25rem;

      button {
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .actions-footer {
      display: flex;
      justify-content: center;
      margin-top: 2rem;
    }
  `],
})
export class MusicOfflineComponent {
  private router = inject(Router);
  private offlineMusicService = inject(OfflineMusicService);
  private mediaPlayer = inject(MediaPlayerService);
  private app = inject(ApplicationService);
  private snackBar = inject(MatSnackBar);

  tracks = this.offlineMusicService.offlineTracks;

  totalStorage = computed(() => {
    const bytes = this.offlineMusicService.totalStorageUsed();
    return this.offlineMusicService.formatBytes(bytes);
  });

  isOnline(): boolean {
    return this.offlineMusicService.isOnline();
  }

  formatSize(bytes?: number): string {
    if (!bytes) return '';
    return this.offlineMusicService.formatBytes(bytes);
  }

  goBack(): void {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      this.router.navigate(['/music']);
    }
  }

  goToMusic(): void {
    this.router.navigate(['/music']);
  }

  openTrack(track: OfflineMusicTrack): void {
    // Navigate to the track detail page
    this.router.navigate(['/music/song', track.pubkey, track.dTag]);
  }

  async playTrack(event: MouseEvent, track: OfflineMusicTrack): Promise<void> {
    event.stopPropagation();

    // Get cached URL (creates blob URL)
    const cachedUrl = await this.offlineMusicService.getCachedAudioUrl(track.audioUrl);

    let cachedImageUrl = track.imageUrl;
    if (track.imageUrl) {
      cachedImageUrl = await this.offlineMusicService.getCachedImageUrl(track.imageUrl);
    }

    const mediaItem: MediaItem = {
      source: cachedUrl,
      title: track.title,
      artist: track.artist,
      artwork: cachedImageUrl || '/icons/icon-192x192.png',
      type: 'Music',
      eventPubkey: track.pubkey,
      eventIdentifier: track.dTag,
    };

    this.mediaPlayer.play(mediaItem);
  }

  async removeTrack(event: MouseEvent, track: OfflineMusicTrack): Promise<void> {
    event.stopPropagation();

    const success = await this.offlineMusicService.removeTrackOffline(track.pubkey, track.dTag);
    if (success) {
      this.snackBar.open('Removed from offline library', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to remove track', 'Close', { duration: 3000 });
    }
  }

  async clearAll(): Promise<void> {
    // Could show a confirmation dialog here
    await this.offlineMusicService.clearAllOfflineData();
    this.snackBar.open('All offline music cleared', 'Close', { duration: 2000 });
  }
}
