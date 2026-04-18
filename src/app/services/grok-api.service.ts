import { Injectable, inject } from '@angular/core';

import { ApiConfiguration } from '../api/api-configuration';
import { Payment } from '../api/models';
import { NostrService } from './nostr.service';

export interface GrokResponseModelConfig {
  enabled: boolean;
  inputTokenNanosUsd: number;
  outputTokenNanosUsd: number;
}

export interface GrokImageModelConfig {
  enabled: boolean;
  imageNanosUsd: number;
  includedQuotaEligible: boolean;
}

export interface GrokPublicConfig {
  enabled: boolean;
  allowResponses: boolean;
  allowImages: boolean;
  allowServerSideTools: boolean;
  defaults: {
    responseModel: string;
    imageModel: string;
  };
  topUp: {
    minimumCents: number;
    maximumCents: number;
    defaultOptionsCents: number[];
    nanosUsdPerCent: number;
  };
  quotas: {
    basic: {
      includedImagesPerMonth: number;
    };
    premium: {
      includedImagesPerMonth: number;
    };
    premiumPlus: {
      includedImagesPerMonth: number;
      dailyImageLimit: number;
    };
  };
  pricing: {
    responses: Record<string, GrokResponseModelConfig>;
    images: Record<string, GrokImageModelConfig>;
  };
}

export interface GrokStatus {
  tier: 'basic' | 'premium' | 'premium_plus';
  enabled: boolean;
  allowResponses: boolean;
  allowImages: boolean;
  defaultResponseModel: string;
  defaultImageModel: string;
  minimumTopUpCents: number;
  maximumTopUpCents: number;
  defaultTopUpOptionsCents: number[];
  balanceNanosUsd: number;
  totalSpentNanosUsd: number;
  totalToppedUpNanosUsd: number;
  includedImagesPerMonth: number;
  includedImagesRemaining: number;
  imagesUsedThisMonth: number;
  imagesUsedToday: number;
  dailyImageLimit?: number;
  canGenerateImagesToday: boolean;
}

export interface GrokHostedPayment extends Payment {
  purpose?: 'subscription' | 'grok_topup';
  creditNanosUsd?: number;
  applied?: number;
}

export interface GrokResponseResult {
  data: Record<string, unknown>;
  billing: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class GrokApiService {
  private readonly config = inject(ApiConfiguration);
  private readonly nostr = inject(NostrService);

  private get rootUrl(): string {
    return this.config.rootUrl.replace(/\/$/, '');
  }

  async getPublicConfig(): Promise<GrokPublicConfig> {
    return this.request<GrokPublicConfig>('/grok/config');
  }

  async getStatus(pubkey: string): Promise<GrokStatus> {
    return this.request<GrokStatus>(`/grok/status/${encodeURIComponent(pubkey)}`, {
      authenticated: true,
    });
  }

  async createTopUp(pubkey: string, amountCents: number): Promise<GrokHostedPayment> {
    return this.request<GrokHostedPayment>(`/grok/topup/${encodeURIComponent(pubkey)}`, {
      method: 'POST',
      authenticated: true,
      body: { amountCents },
    });
  }

  async createResponse(pubkey: string, payload: Record<string, unknown>): Promise<GrokResponseResult> {
    return this.request<GrokResponseResult>(`/grok/responses/${encodeURIComponent(pubkey)}`, {
      method: 'POST',
      authenticated: true,
      body: payload,
    });
  }

  async createImages(pubkey: string, payload: Record<string, unknown>): Promise<GrokResponseResult> {
    return this.request<GrokResponseResult>(`/grok/images/${encodeURIComponent(pubkey)}`, {
      method: 'POST',
      authenticated: true,
      body: payload,
    });
  }

  async getPayment(pubkey: string, paymentId: string): Promise<GrokHostedPayment> {
    return this.request<GrokHostedPayment>(`/payment/${encodeURIComponent(pubkey)}/${encodeURIComponent(paymentId)}`);
  }

  private async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      authenticated?: boolean;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const method = options.method || 'GET';
    const url = `${this.rootUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.authenticated) {
      const token = await this.nostr.getNIP98AuthToken({ url, method });
      headers['Authorization'] = `Nostr ${token}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};

    if (!response.ok) {
      const message = typeof payload['error'] === 'string'
        ? payload['error']
        : typeof payload['message'] === 'string'
          ? payload['message']
          : `HTTP error! status: ${response.status}`;
      throw new Error(message);
    }

    if (payload['success'] === true && 'data' in payload) {
      return payload['data'] as T;
    }

    return payload as T;
  }
}