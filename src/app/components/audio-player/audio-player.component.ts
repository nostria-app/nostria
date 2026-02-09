import { ChangeDetectionStrategy, Component, input, signal, ViewChild, ElementRef, AfterViewInit, OnDestroy, effect } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSliderModule } from '@angular/material/slider';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { formatDuration } from '../../utils/format-duration';

@Component({
  selector: 'app-audio-player',
  imports: [MatIconModule, MatButtonModule, MatSliderModule, FormsModule, MatProgressSpinnerModule],
  templateUrl: './audio-player.component.html',
  styleUrls: ['./audio-player.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioPlayerComponent implements AfterViewInit, OnDestroy {
  src = input('');
  waveform = input<number[]>([]);
  duration = input(0);

  @ViewChild('audioElement') audioRef!: ElementRef<HTMLAudioElement>;

  isPlaying = signal(false);
  isLoading = signal(false);
  currentTime = signal(0);
  totalDuration = signal(0);
  currentSrc = signal('');

  private isRetryingWithBlob = false;
  private blobUrl: string | null = null;

  ngAfterViewInit() {
    const audio = this.audioRef.nativeElement;

    audio.addEventListener('loadedmetadata', () => {
      const duration = audio.duration;
      if (duration && isFinite(duration)) {
        this.totalDuration.set(duration);
      } else {
        this.totalDuration.set(this.duration());
      }
    });

    audio.addEventListener('error', async (e) => {
      const target = e.target as HTMLAudioElement;
      const error = target.error;
      console.error('Audio playback error:', error?.code, error?.message);
      this.isPlaying.set(false);

      // If network error (2) or not supported (4), try blob fallback
      if (this.src() && !this.isRetryingWithBlob && (error?.code === 2 || error?.code === 4)) {
        console.log('Attempting to load audio as Blob...');
        this.isRetryingWithBlob = true;
        await this.loadAsBlob(this.src());
      }
    });

    audio.addEventListener('timeupdate', () => {
      this.currentTime.set(audio.currentTime);
    });

    audio.addEventListener('ended', () => {
      this.isPlaying.set(false);
      this.currentTime.set(0);
    });

    audio.addEventListener('play', () => this.isPlaying.set(true));
    audio.addEventListener('pause', () => this.isPlaying.set(false));
  }

  async loadAsBlob(url: string) {
    try {
      this.isLoading.set(true);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      // Security check: Validate Content-Type to prevent XSS via Blob
      const contentType = response.headers.get('Content-Type')?.toLowerCase() || '';
      if (contentType.includes('html') || contentType.includes('script') || contentType.includes('svg') || contentType.includes('xml')) {
        throw new Error(`Security blocked: Unsafe content type '${contentType}'`);
      }

      const blob = await response.blob();
      this.blobUrl = URL.createObjectURL(blob);
      this.currentSrc.set(this.blobUrl);
      console.log('Blob loaded successfully, starting playback...');

      // Allow change detection to update the src
      setTimeout(async () => {
        const audio = this.audioRef?.nativeElement;
        if (audio) {
          audio.load();
          try {
            await audio.play();
          } catch (e) {
            console.error("Playback failed after blob fallback:", e);
          }
        }
      });
    } catch (err) {
      console.error('Failed to load audio as blob:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  ngOnDestroy() {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
    }
  }

  async togglePlay() {
    if (this.isLoading()) return;
    const audio = this.audioRef.nativeElement;
    if (audio.paused) {
      try {
        await audio.play();
      } catch (err) {
        console.error('Error playing audio:', err);
        this.isPlaying.set(false);
      }
    } else {
      audio.pause();
    }
  }

  seek(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const audio = this.audioRef.nativeElement;
    audio.currentTime = Number(value);
  }

  formatTime = formatDuration;

  private maxWaveformValue = 100;
  private isFirstSrcChange = true;

  constructor() {
    effect(() => {
      const src = this.src();
      // Cleanup previous blob
      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = null;
      }
      this.isRetryingWithBlob = false;
      this.currentSrc.set(src);

      if (!this.isFirstSrcChange) {
        const audio = this.audioRef?.nativeElement;
        if (audio) {
          audio.load();
          this.isPlaying.set(false);
          this.currentTime.set(0);
        }
      }
      this.isFirstSrcChange = false;
    });

    effect(() => {
      const waveform = this.waveform();
      if (waveform && waveform.length > 0) {
        this.maxWaveformValue = Math.max(...waveform, 1);
      }
    });

    effect(() => {
      const duration = this.duration();
      // If we have a duration input, set it initially.
      // This helps when audio metadata hasn't loaded yet or is infinite (streaming/webm).
      if (duration) {
        // Only set if we don't have a valid audio duration yet
        const audio = this.audioRef?.nativeElement;
        if (!audio || !audio.duration || !isFinite(audio.duration)) {
          this.totalDuration.set(duration);
        }
      }
    });
  }

  getWaveformBarHeight(val: number): number {
    // Normalize based on the maximum value in the waveform
    const percentage = (val / this.maxWaveformValue) * 100;
    return Math.max(15, percentage); // Minimum height for visibility
  }

  onWaveformClick(event: MouseEvent) {
    // Only handle click if we have a waveform, otherwise slider handles it
    if (this.waveform().length === 0) return;

    const container = event.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percentage = x / rect.width;
    const audio = this.audioRef.nativeElement;
    audio.currentTime = percentage * (this.totalDuration() || 0);
  }
}
