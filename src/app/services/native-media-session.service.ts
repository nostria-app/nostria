import { Injectable } from '@angular/core';
import { addPluginListener, invoke, isTauri, PluginListener } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { ApplicationService } from './application.service';

export type NativeMediaAction = 'play' | 'pause' | 'stop' | 'next' | 'previous' | 'seek' | 'toggle';

export interface NativeMediaActionEvent {
  action: NativeMediaAction;
  seekPosition?: number;
}

export interface NativeMediaState extends Record<string, unknown> {
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  duration?: number;
  position?: number;
  playbackSpeed?: number;
  isPlaying?: boolean;
  canPrev?: boolean;
  canNext?: boolean;
  canSeek?: boolean;
}

export interface NativeMediaTimelineUpdate extends Record<string, unknown> {
  duration?: number;
  position?: number;
  playbackSpeed?: number;
}

export interface NativeAudioPlayRequest extends Record<string, unknown> {
  source: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  position?: number;
  playbackSpeed?: number;
  canPrev?: boolean;
  canNext?: boolean;
  canSeek?: boolean;
}

export interface NativeAudioPlaybackEvent {
  isPlaying?: boolean;
  position?: number;
  duration?: number;
  playbackSpeed?: number;
  ended?: boolean;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class NativeMediaSessionService {
  private readonly mobileUserAgentPattern = /Android|iPhone|iPad|iPod/i;

  private readonly app: ApplicationService;

  private pluginListener?: PluginListener;
  private playbackListener?: PluginListener;
  private desktopUnlisten?: UnlistenFn;
  private actionHandler?: (event: NativeMediaActionEvent) => void;
  private playbackStateHandler?: (event: NativeAudioPlaybackEvent) => void;
  private initialized = false;
  private state: NativeMediaState = {};

  constructor(app: ApplicationService) {
    this.app = app;

    if (!this.isSupportedRuntime()) {
      return;
    }

    void this.registerListeners();
  }

  setActionHandler(handler: (event: NativeMediaActionEvent) => void): void {
    this.actionHandler = handler;
  }

  setPlaybackStateHandler(handler: (event: NativeAudioPlaybackEvent) => void): void {
    this.playbackStateHandler = handler;
  }

  async updateState(update: NativeMediaState): Promise<void> {
    if (!this.isSupportedRuntime()) {
      return;
    }

    this.state = {
      ...this.state,
      ...update,
    };

    await this.ensureInitialized();
    await invoke('plugin:media-session|update_state', update);
  }

  async updateTimeline(update: NativeMediaTimelineUpdate): Promise<void> {
    if (!this.isSupportedRuntime()) {
      return;
    }

    this.state = {
      ...this.state,
      ...update,
    };

    await this.ensureInitialized();
    await invoke('plugin:media-session|update_timeline', update);
  }

  async clear(): Promise<void> {
    if (!this.isSupportedRuntime()) {
      return;
    }

    this.state = {};

    await invoke('plugin:media-session|clear');
    this.initialized = false;
  }

  async playAudio(request: NativeAudioPlayRequest): Promise<void> {
    if (!this.isAndroidRuntime()) {
      return;
    }

    await invoke('plugin:media-session|play_audio', { request });
    this.initialized = true;
  }

  async pauseAudio(): Promise<void> {
    if (!this.isAndroidRuntime()) {
      return;
    }

    await invoke('plugin:media-session|pause_audio');
  }

  async resumeAudio(): Promise<void> {
    if (!this.isAndroidRuntime()) {
      return;
    }

    await invoke('plugin:media-session|resume_audio');
  }

  async stopAudio(): Promise<void> {
    if (!this.isAndroidRuntime()) {
      return;
    }

    await invoke('plugin:media-session|stop_audio');
  }

  async seekAudio(position: number): Promise<void> {
    if (!this.isAndroidRuntime()) {
      return;
    }

    await invoke('plugin:media-session|seek_audio', { request: { position } });
  }

  async setAudioRate(playbackSpeed: number): Promise<void> {
    if (!this.isAndroidRuntime()) {
      return;
    }

    await invoke('plugin:media-session|set_audio_rate', { request: { playbackSpeed } });
  }

  private async registerListeners(): Promise<void> {
    if (this.isMobileRuntime()) {
      this.pluginListener = await addPluginListener<NativeMediaActionEvent>(
        'media-session',
        'media_action',
        payload => this.actionHandler?.(payload)
      );

      this.playbackListener = await addPluginListener<NativeAudioPlaybackEvent>(
        'media-session',
        'playback_state',
        payload => this.playbackStateHandler?.(payload)
      );
      return;
    }

    this.desktopUnlisten = await listen<NativeMediaActionEvent>('media_action', event => this.actionHandler?.(event.payload));
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await invoke('plugin:media-session|initialize');

    this.initialized = true;
  }

  private isSupportedRuntime(): boolean {
    return this.app.isBrowser() && isTauri();
  }

  isAndroidRuntime(): boolean {
    return this.isSupportedRuntime() && /Android/i.test(navigator.userAgent);
  }

  private isMobileRuntime(): boolean {
    return this.mobileUserAgentPattern.test(navigator.userAgent);
  }
}