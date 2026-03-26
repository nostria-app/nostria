import { Injectable, inject, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';

interface ApiEnvelope<T> {
  code?: number;
  message?: string | null;
  data: T;
}

interface ChallengeResponse {
  challenge: string;
}

interface AuthTokenResponse {
  token: string;
}

interface BrainstormPubkeyInstance {
  brainstorm_pubkey: string;
}

export interface BrainstormRequestInstance {
  private_id: number;
  status: string;
  ta_status: string | null;
  internal_publication_status: string | null;
  result: string | null;
  count_values: string | null;
  password: string;
  algorithm: string;
  parameters: string;
  how_many_others_with_priority: number;
  pubkey: string | null;
  created_at: string;
  updated_at: string;
}

type ConfigTag = [string, string, string];

interface ConfigTagObject {
  tag?: unknown;
}

type RawConfigTag = [unknown, unknown, unknown, ...unknown[]];

@Injectable({
  providedIn: 'root',
})
export class BrainstormWotApiService {
  private readonly nostr = inject(NostrService);
  private readonly logger = inject(LoggerService);

  private readonly baseUrl = 'https://brainstormserver.nosfabrica.com';
  private readonly authToken = signal<string | null>(null);
  private readonly authenticatedPubkey = signal<string | null>(null);

  async getLatestGraperank(pubkey: string): Promise<BrainstormRequestInstance | null> {
    const token = await this.ensureAuthToken(pubkey);
    const response = await this.fetchJson<ApiEnvelope<BrainstormRequestInstance | null>>(
      `${this.baseUrl}/user/graperankResult`,
      {
        headers: {
          access_token: token,
        },
      },
    );

    return response.data;
  }

  async startGraperank(pubkey: string): Promise<BrainstormRequestInstance | null> {
    const token = await this.ensureAuthToken(pubkey);
    const response = await this.fetchJson<ApiEnvelope<BrainstormRequestInstance | null>>(
      `${this.baseUrl}/user/graperank`,
      {
        method: 'POST',
        headers: {
          access_token: token,
        },
      },
    );

    return response.data;
  }

  async get10040ConfigTags(customerPubkey: string): Promise<ConfigTag[] | null> {
    const endpoint = `${this.baseUrl}/config/10040/${customerPubkey}`;

    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        if (response.status === 404 || response.status === 501) {
          return null;
        }
        throw new Error(`Config request failed (${response.status})`);
      }

      const payload = await response.json() as unknown;
      return this.normalizeConfigTags(payload);
    } catch (error) {
      this.logger.warn('Failed to fetch Brainstorm 10040 config tags', error);
      return null;
    }
  }

  async getPublisherPubkey(customerPubkey: string): Promise<string> {
    const response = await this.fetchJson<ApiEnvelope<BrainstormPubkeyInstance>>(
      `${this.baseUrl}/brainstormPubkey/${customerPubkey}`,
    );

    return response.data.brainstorm_pubkey;
  }

  private async ensureAuthToken(pubkey: string): Promise<string> {
    const cachedToken = this.authToken();
    if (cachedToken && this.authenticatedPubkey() === pubkey) {
      return cachedToken;
    }

    const challengeResponse = await this.fetchJson<ApiEnvelope<ChallengeResponse>>(
      `${this.baseUrl}/authChallenge/${pubkey}`,
    );

    const verificationUrl = `${this.baseUrl}/authChallenge/${pubkey}/verify`;
    const challenge = challengeResponse.data.challenge;
    const unsignedEvent = this.nostr.createEvent(27235, '', [
      ['u', verificationUrl],
      ['method', 'POST'],
      ['challenge', challenge],
      ['t', 'brainstorm_login'],
    ]);
    const signedEvent = await this.nostr.signEvent(unsignedEvent);

    const verificationResponse = await this.fetchJson<ApiEnvelope<AuthTokenResponse>>(
      verificationUrl,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          signed_event: signedEvent,
        }),
      },
    );

    const token = verificationResponse.data.token;
    this.authToken.set(token);
    this.authenticatedPubkey.set(pubkey);
    return token;
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Request failed (${response.status}): ${body || 'Unknown error'}`);
    }

    return await response.json() as T;
  }

  private normalizeConfigTags(payload: unknown): ConfigTag[] {
    if (!Array.isArray(payload)) {
      return [];
    }

    const directTags = payload
      .filter(item => this.isRawConfigTag(item))
      .map(item => [String(item[0]), String(item[1]), String(item[2])] as ConfigTag);

    if (directTags.length > 0) {
      return directTags;
    }

    const objectTags = payload
      .filter(item => this.isConfigTagObject(item))
      .map(item => item.tag)
      .filter(tag => this.isRawConfigTag(tag))
      .map(tag => [String(tag[0]), String(tag[1]), String(tag[2])] as ConfigTag);

    return objectTags;
  }

  private isConfigTagObject(value: unknown): value is ConfigTagObject {
    return typeof value === 'object' && value !== null && 'tag' in value;
  }

  private isRawConfigTag(value: unknown): value is RawConfigTag {
    return Array.isArray(value) && value.length >= 3;
  }
}
