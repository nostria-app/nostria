import { Component, Input, signal, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSliderModule } from '@angular/material/slider';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-audio-player',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatSliderModule, FormsModule],
  templateUrl: './audio-player.component.html',
  styleUrls: ['./audio-player.component.scss']
})
export class AudioPlayerComponent implements AfterViewInit {
  @Input() src = '';
  @Input() waveform: number[] = [];
  @Input() duration = 0;

  @ViewChild('audioElement') audioRef!: ElementRef<HTMLAudioElement>;

  isPlaying = signal(false);
  currentTime = signal(0);
  totalDuration = signal(0);

  ngAfterViewInit() {
    const audio = this.audioRef.nativeElement;

    audio.addEventListener('loadedmetadata', () => {
      this.totalDuration.set(audio.duration || this.duration);
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

  togglePlay() {
    const audio = this.audioRef.nativeElement;
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }

  seek(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const audio = this.audioRef.nativeElement;
    audio.currentTime = Number(value);
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private maxWaveformValue = 100;

  ngOnChanges() {
    if (this.waveform && this.waveform.length > 0) {
      this.maxWaveformValue = Math.max(...this.waveform, 1);
    }
  }

  getWaveformBarHeight(val: number): number {
    // Normalize based on the maximum value in the waveform
    const percentage = (val / this.maxWaveformValue) * 100;
    return Math.max(15, percentage); // Minimum height for visibility
  }

  onWaveformClick(event: MouseEvent) {
    // Only handle click if we have a waveform, otherwise slider handles it
    if (this.waveform.length === 0) return;

    const container = event.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percentage = x / rect.width;
    const audio = this.audioRef.nativeElement;
    audio.currentTime = percentage * (this.totalDuration() || 0);
  }
}
