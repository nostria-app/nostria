import { isPlatformBrowser } from '@angular/common';
import { Injectable, OnDestroy, PLATFORM_ID, inject, signal } from '@angular/core';

export type EventTtsPlaybackStatus = 'loading' | 'playing' | 'paused';

export interface EventTtsPlaybackState {
  requestId: number;
  eventId: string;
  modelLabel: string;
  status: EventTtsPlaybackStatus;
}

@Injectable({ providedIn: 'root' })
export class EventTtsPlaybackService implements OnDestroy {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private audio: HTMLAudioElement | null = null;
  private audioSrc: string | null = null;
  private nextRequestId = 0;

  readonly state = signal<EventTtsPlaybackState | null>(null);

  start(eventId: string, modelLabel: string): number {
    this.close();

    const requestId = ++this.nextRequestId;
    this.state.set({
      requestId,
      eventId,
      modelLabel,
      status: 'loading',
    });

    return requestId;
  }

  isCurrent(requestId: number): boolean {
    return this.state()?.requestId === requestId;
  }

  isActiveFor(eventId: string): boolean {
    return this.state()?.eventId === eventId;
  }

  async play(requestId: number, audioSrc: string): Promise<void> {
    const current = this.state();
    if (!this.isBrowser || !current || current.requestId !== requestId || typeof Audio === 'undefined') {
      this.revokeAudioSrc(audioSrc);
      return;
    }

    this.stopAudio();
    this.audioSrc = audioSrc;
    this.audio = new Audio(audioSrc);
    this.audio.onended = () => this.close(requestId);
    this.audio.onpause = () => {
      const state = this.state();
      if (state?.requestId === requestId && this.audio && !this.audio.ended) {
        this.state.set({ ...state, status: 'paused' });
      }
    };
    this.audio.onplay = () => {
      const state = this.state();
      if (state?.requestId === requestId) {
        this.state.set({ ...state, status: 'playing' });
      }
    };

    this.state.set({ ...current, status: 'playing' });

    try {
      await this.audio.play();
    } catch (error) {
      this.close(requestId);
      throw error;
    }
  }

  toggle(): void {
    const current = this.state();
    if (!current || current.status === 'loading' || !this.audio) {
      return;
    }

    if (this.audio.paused) {
      void this.audio.play();
    } else {
      this.audio.pause();
    }
  }

  close(requestId?: number): void {
    if (requestId !== undefined && this.state()?.requestId !== requestId) {
      return;
    }

    this.stopAudio();
    this.state.set(null);
  }

  ngOnDestroy(): void {
    this.close();
  }

  private stopAudio(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio.load();
      this.audio = null;
    }

    if (this.audioSrc) {
      this.revokeAudioSrc(this.audioSrc);
      this.audioSrc = null;
    }
  }

  private revokeAudioSrc(audioSrc: string): void {
    if (this.isBrowser && audioSrc.startsWith('blob:')) {
      URL.revokeObjectURL(audioSrc);
    }
  }
}
