import { effect, inject, Injectable, signal } from '@angular/core';

import { AccountStateService } from './account-state.service';
import { LoggerService } from './logger.service';
import { WebRequest } from './web-request';
import { environment } from '../../environments/environment';

export interface XConnectionStatus {
  connected: boolean;
  username?: string;
  userId?: string;
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

  readonly status = signal<XConnectionStatus>({ connected: false });
  readonly loading = signal(false);
  readonly connecting = signal(false);

  constructor() {
    effect(() => {
      const pubkey = this.accountState.pubkey();

      if (!pubkey) {
        this.status.set({ connected: false });
        return;
      }

      void this.refreshStatus();
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
      const disconnected = { connected: false } satisfies XConnectionStatus;
      this.status.set(disconnected);
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
      return response.data;
    } catch (error) {
      this.logger.warn('Failed to refresh X connection status', { error });
      const disconnected = { connected: false } satisfies XConnectionStatus;
      this.status.set(disconnected);
      return disconnected;
    } finally {
      this.loading.set(false);
    }
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

      this.status.set({ connected: false });
    } finally {
      this.loading.set(false);
    }
  }

  async publishText(text: string): Promise<void> {
    const pubkey = this.getPubkey();

    await this.webRequest.fetchJson(
      this.getApiUrl(`api/x/post/${pubkey}`),
      {
        method: 'POST',
        body: JSON.stringify({ text }),
      },
      { kind: 27235 }
    );
  }
}