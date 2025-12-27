import {
  Component,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MediaPlayerService } from '../../../../services/media-player.service';

export interface LyricLine {
  time: number; // Time in seconds
  text: string;
}

interface LrcLibSearchResult {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

@Component({
  selector: 'app-lyrics-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="lyrics-container" [class.compact]="compact()">
      <div class="lyrics-header">
        <span class="lyrics-title">Lyrics</span>
        <button mat-icon-button class="close-btn" (click)="closeLyrics.emit()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="lyrics-content" #lyricsContent>
        @if (loading()) {
          <div class="lyrics-loading">
            <mat-spinner diameter="32"></mat-spinner>
            <span>Searching for lyrics...</span>
          </div>
        } @else if (syncedLyrics().length > 0) {
          <div class="synced-lyrics">
            @for (line of syncedLyrics(); track line.time) {
              <p 
                class="lyric-line" 
                [class.active]="isCurrentLine(line)"
                [class.past]="isPastLine(line)"
                [attr.data-time]="line.time">
                {{ line.text || '♪' }}
              </p>
            }
          </div>
        } @else if (plainLyrics()) {
          <div class="plain-lyrics">
            <p>{{ plainLyrics() }}</p>
          </div>
        } @else {
          <div class="lyrics-empty">
            <mat-icon>lyrics</mat-icon>
            <span>No lyrics found</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .lyrics-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--mat-sys-surface-container);
      border-radius: var(--mat-sys-corner-large);
      overflow: hidden;

      &.compact {
        border-radius: var(--mat-sys-corner-medium);
      }
    }

    .lyrics-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      flex-shrink: 0;

      .lyrics-title {
        font-size: 1rem;
        color: var(--mat-sys-on-surface);
      }

      .close-btn {
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .lyrics-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      scroll-behavior: smooth;
    }

    .lyrics-loading,
    .lyrics-error,
    .lyrics-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 12px;
      color: var(--mat-sys-on-surface-variant);
      text-align: center;

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        opacity: 0.5;
      }

      .lyrics-hint {
        font-size: 0.75rem;
        opacity: 0.7;
      }
    }

    .synced-lyrics {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 20px 0;

      .lyric-line {
        margin: 0;
        font-size: 1.25rem;
        line-height: 1.6;
        color: var(--mat-sys-on-surface-variant);
        opacity: 0.5;
        transition: all 0.3s ease;
        text-align: center;
        padding: 4px 8px;
        border-radius: var(--mat-sys-corner-small);

        &.active {
          color: var(--mat-sys-primary);
          opacity: 1;
          font-size: 1.5rem;
          background: var(--mat-sys-primary-container);
        }

        &.past {
          opacity: 0.4;
        }
      }
    }

    .plain-lyrics {
      p {
        margin: 0;
        font-size: 1rem;
        line-height: 1.8;
        color: var(--mat-sys-on-surface);
        white-space: pre-wrap;
        text-align: center;
      }
    }

    :host-context(.dark) {
      .lyrics-container {
        background: var(--mat-sys-surface-container);
      }
    }
  `],
})
export class LyricsViewComponent {
  private media = inject(MediaPlayerService);
  private lyricsContent = viewChild<ElementRef<HTMLDivElement>>('lyricsContent');

  compact = input(false);
  closeLyrics = output<void>();

  syncedLyrics = signal<LyricLine[]>([]);
  plainLyrics = signal<string | null>(null);
  loading = signal(false);

  // Track the current song to detect changes
  private currentTrackId = signal<string | null>(null);

  currentTime = computed(() => this.media.currentTimeSig());

  constructor() {
    // Watch for track changes and parse lyrics from MediaItem or fetch from API
    effect(() => {
      const current = this.media.current();
      const trackId = current?.source || current?.title || null;

      if (trackId !== this.currentTrackId()) {
        this.currentTrackId.set(trackId);
        if (current?.lyrics) {
          // Use embedded lyrics
          this.parseLyrics(current.lyrics);
        } else if (current?.title || current?.artist) {
          // Try to fetch from LRCLIB API
          this.fetchLyricsFromApi(current.title, current.artist);
        } else {
          this.clearLyrics();
        }
      }
    });

    // Auto-scroll to current lyric line
    effect(() => {
      const time = this.currentTime();
      const lyrics = this.syncedLyrics();
      if (lyrics.length === 0) return;

      // Find current line index
      let currentIndex = -1;
      for (let i = lyrics.length - 1; i >= 0; i--) {
        if (time >= lyrics[i].time) {
          currentIndex = i;
          break;
        }
      }

      if (currentIndex >= 0) {
        this.scrollToLine(currentIndex);
      }
    });
  }

  isCurrentLine(line: LyricLine): boolean {
    const time = this.currentTime();
    const lyrics = this.syncedLyrics();
    const index = lyrics.indexOf(line);
    if (index === -1) return false;

    const nextLine = lyrics[index + 1];
    return time >= line.time && (!nextLine || time < nextLine.time);
  }

  isPastLine(line: LyricLine): boolean {
    const time = this.currentTime();
    const lyrics = this.syncedLyrics();
    const index = lyrics.indexOf(line);
    if (index === -1) return false;

    const nextLine = lyrics[index + 1];
    return nextLine ? time >= nextLine.time : false;
  }

  private scrollToLine(index: number): void {
    const container = this.lyricsContent()?.nativeElement;
    if (!container) return;

    const lines = container.querySelectorAll('.lyric-line');
    const activeLine = lines[index] as HTMLElement;
    if (activeLine) {
      const containerHeight = container.clientHeight;
      const lineTop = activeLine.offsetTop;
      const lineHeight = activeLine.offsetHeight;
      const scrollTop = lineTop - containerHeight / 2 + lineHeight / 2;

      container.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'smooth',
      });
    }
  }

  private parseLyrics(lyrics: string): void {
    this.syncedLyrics.set([]);
    this.plainLyrics.set(null);

    // Check if it's LRC format (synced lyrics)
    const lrcParsed = this.parseLRC(lyrics);
    if (lrcParsed.length > 0) {
      this.syncedLyrics.set(lrcParsed);
    } else {
      // Plain text lyrics
      this.plainLyrics.set(lyrics);
    }
  }

  private parseLRC(lrc: string): LyricLine[] {
    const lines: LyricLine[] = [];
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g;
    let match;

    while ((match = regex.exec(lrc)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = parseInt(match[3].padEnd(3, '0'), 10);
      const time = minutes * 60 + seconds + milliseconds / 1000;
      const text = match[4].trim();

      lines.push({ time, text });
    }

    return lines.sort((a, b) => a.time - b.time);
  }

  private clearLyrics(): void {
    this.syncedLyrics.set([]);
    this.plainLyrics.set(null);
    this.loading.set(false);
  }

  private async fetchLyricsFromApi(title?: string, artist?: string): Promise<void> {
    if (!title && !artist) {
      this.clearLyrics();
      return;
    }

    this.loading.set(true);
    this.syncedLyrics.set([]);
    this.plainLyrics.set(null);

    try {
      const params = new URLSearchParams();
      if (title) params.set('track_name', title);
      if (artist) params.set('artist_name', artist);

      const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`);
      if (!response.ok) {
        this.clearLyrics();
        return;
      }

      const results: LrcLibSearchResult[] = await response.json();
      if (results.length === 0) {
        this.clearLyrics();
        return;
      }

      // Use the first result
      const bestMatch = results[0];
      if (bestMatch.syncedLyrics) {
        this.parseLyrics(bestMatch.syncedLyrics);
      } else if (bestMatch.plainLyrics) {
        this.parseLyrics(bestMatch.plainLyrics);
      } else {
        this.clearLyrics();
      }
    } catch {
      this.clearLyrics();
    } finally {
      this.loading.set(false);
    }
  }
}
