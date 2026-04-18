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

interface DesktopMediaMetadata {
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  duration?: number;
  artworkUrl?: string;
}

interface DesktopPlaybackInfo {
  status: 'playing' | 'paused' | 'stopped';
  position: number;
  shuffle: boolean;
  repeatMode: 'none' | 'track' | 'list';
  playbackRate: number;
}

@Injectable({
  providedIn: 'root',
})
export class NativeMediaSessionService {
  private readonly desktopEventName = 'native-media-action';
  private readonly appId = 'nostria';
  private readonly appName = 'Nostria';
  private readonly mobileUserAgentPattern = /Android|iPhone|iPad|iPod/i;

  private readonly app: ApplicationService;

  private pluginListener?: PluginListener;
  private unlistenDesktop?: UnlistenFn;
  private actionHandler?: (event: NativeMediaActionEvent) => void;
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

  async updateState(update: NativeMediaState): Promise<void> {
    if (!this.isSupportedRuntime()) {
      return;
    }

    this.state = {
      ...this.state,
      ...update,
    };

    await this.ensureInitialized();

    if (this.isMobileTauriRuntime()) {
      await invoke('plugin:media-session|update_state', update);
      return;
    }

    await this.updateDesktopState();
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

    if (this.isMobileTauriRuntime()) {
      await invoke('plugin:media-session|update_timeline', update);
      return;
    }

    await this.updateDesktopPlaybackInfo();
  }

  async clear(): Promise<void> {
    if (!this.isSupportedRuntime()) {
      return;
    }

    this.state = {};

    if (this.isMobileTauriRuntime()) {
      await invoke('plugin:media-session|clear');
      this.initialized = false;
      return;
    }

    await this.ensureInitialized();
    await invoke('plugin:media|set_playback_status', { status: 'stopped' });
    await invoke('plugin:media|clear_metadata');
  }

  private async registerListeners(): Promise<void> {
    if (this.isMobileTauriRuntime()) {
      this.pluginListener = await addPluginListener<NativeMediaActionEvent>(
        'media-session',
        'media_action',
        payload => this.actionHandler?.(payload)
      );
      return;
    }

    if (this.isDesktopTauriRuntime()) {
      this.unlistenDesktop = await listen<NativeMediaActionEvent>(
        this.desktopEventName,
        event => this.actionHandler?.(event.payload)
      );
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.isMobileTauriRuntime()) {
      await invoke('plugin:media-session|initialize');
    } else if (this.isDesktopTauriRuntime()) {
      await invoke('plugin:media|initialize_session', {
        request: {
          appId: this.appId,
          appName: this.appName,
        },
      });
    }

    this.initialized = true;
  }

  private async updateDesktopState(): Promise<void> {
    await invoke('plugin:media|set_metadata', {
      metadata: this.getDesktopMetadata(),
    });

    await this.updateDesktopPlaybackInfo();
  }

  private async updateDesktopPlaybackInfo(): Promise<void> {
    await invoke('plugin:media|set_playback_info', {
      info: this.getDesktopPlaybackInfo(),
    });
  }

  private getDesktopMetadata(): DesktopMediaMetadata {
    return {
      title: this.state.title ?? this.appName,
      artist: this.state.artist,
      album: this.state.album,
      albumArtist: this.state.artist,
      duration: this.normalizeNumber(this.state.duration),
      artworkUrl: this.state.artworkUrl,
    };
  }

  private getDesktopPlaybackInfo(): DesktopPlaybackInfo {
    return {
      status: this.state.isPlaying === false ? 'paused' : 'playing',
      position: this.normalizeNumber(this.state.position) ?? 0,
      shuffle: false,
      repeatMode: 'none',
      playbackRate: this.normalizeNumber(this.state.playbackSpeed) ?? 1,
    };
  }

  private normalizeNumber(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    return value;
  }

  private isSupportedRuntime(): boolean {
    return this.app.isBrowser() && isTauri();
  }

  private isMobileTauriRuntime(): boolean {
    return this.isSupportedRuntime() && this.mobileUserAgentPattern.test(navigator.userAgent);
  }

  private isDesktopTauriRuntime(): boolean {
    return this.isSupportedRuntime() && !this.mobileUserAgentPattern.test(navigator.userAgent);
  }
}