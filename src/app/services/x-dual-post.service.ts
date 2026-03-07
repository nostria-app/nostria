import { effect, inject, Injectable, signal } from '@angular/core';

import { AccountStateService } from './account-state.service';
import { LoggerService } from './logger.service';
import { WebRequest } from './web-request';
import { environment } from '../../environments/environment';

export interface XConnectionStatus {
  connected: boolean;
  username?: string;
  userId?: string;
  totalPosts: number;
  postsLast24h: number;
  lastPosted?: number;
  limit24h?: number;
  remaining24h?: number;
}

export interface XPostMediaItem {
  url: string;
  mimeType?: string;
  fallbackUrls?: string[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class XDualPostService {
  private readonly accountState = inject(AccountStateService);
  private readonly logger = inject(LoggerService);
  private readonly webRequest = inject(WebRequest);
  private lastPubkey = '';

  readonly status = signal<XConnectionStatus>({ connected: false, totalPosts: 0, postsLast24h: 0 });
  readonly loading = signal(false);
  readonly connecting = signal(false);
  readonly loaded = signal(false);

  constructor() {
    effect(() => {
      const pubkey = this.accountState.pubkey();

      if (!pubkey) {
        this.lastPubkey = '';
        this.status.set({ connected: false, totalPosts: 0, postsLast24h: 0 });
        this.loaded.set(false);
        return;
      }

      if (this.lastPubkey !== pubkey) {
        this.lastPubkey = pubkey;
        this.status.set({ connected: false, totalPosts: 0, postsLast24h: 0 });
        this.loaded.set(false);
      }
    });
  }

  private getApiUrl(path: string): string {
    return new URL(path, environment.backendUrl).toString();
  }

  private getPubkey(): string {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      throw new Error('You must be logged in to use X dual-posting');
    }

    return pubkey;
  }

  async refreshStatus(): Promise<XConnectionStatus> {
    const pubkey = this.accountState.pubkey();

    if (!pubkey) {
      const disconnected = { connected: false, totalPosts: 0, postsLast24h: 0 } satisfies XConnectionStatus;
      this.status.set(disconnected);
      this.loaded.set(false);
      return disconnected;
    }

    this.loading.set(true);

    try {
      const response = await this.webRequest.fetchJson(
        this.getApiUrl(`api/x/status/${pubkey}`),
        {
          method: 'GET',
        },
        { kind: 27235 }
      ) as ApiEnvelope<XConnectionStatus>;

      this.status.set(response.data);
      this.loaded.set(true);
      return response.data;
    } catch (error) {
      this.logger.warn('Failed to refresh X connection status', { error });
      const disconnected = { connected: false, totalPosts: 0, postsLast24h: 0 } satisfies XConnectionStatus;
      this.status.set(disconnected);
      this.loaded.set(false);
      return disconnected;
    } finally {
      this.loading.set(false);
    }
  }

  ensureStatusLoaded(): void {
    if (this.loaded() || this.loading()) {
      return;
    }

    void this.refreshStatus();
  }

  async connect(): Promise<void> {
    const pubkey = this.getPubkey();
    this.connecting.set(true);

    try {
      const response = await this.webRequest.fetchJson(
        this.getApiUrl(`api/x/connect/${pubkey}`),
        {
          method: 'POST',
        },
        { kind: 27235 }
      ) as ApiEnvelope<{ authorizeUrl: string }>;

      if (!response.data?.authorizeUrl) {
        throw new Error(response.message || 'X authorization URL was not returned');
      }

      if (typeof window !== 'undefined') {
        window.location.href = response.data.authorizeUrl;
      }
    } finally {
      this.connecting.set(false);
    }
  }

  async disconnect(): Promise<void> {
    const pubkey = this.getPubkey();
    this.loading.set(true);

    try {
      await this.webRequest.fetchJson(
        this.getApiUrl(`api/x/connection/${pubkey}`),
        {
          method: 'DELETE',
        },
        { kind: 27235 }
      );

      this.status.update(status => ({ ...status, connected: false, username: undefined, userId: undefined }));
      this.loaded.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  async publishPost(text: string, media: XPostMediaItem[] = []): Promise<void> {
    const pubkey = this.getPubkey();

    await this.webRequest.fetchJson(
      this.getApiUrl(`api/x/post/${pubkey}`),
      {
        method: 'POST',
        body: JSON.stringify({ text, media }),
      },
      { kind: 27235 }
    );
  }
}