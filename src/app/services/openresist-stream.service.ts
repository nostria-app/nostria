import { inject, Injectable } from '@angular/core';
import { WebRequest } from './web-request';

interface OpenResistAuthorizationPayload {
  scheme?: string;
  token?: string;
}

interface OpenResistStreamPayload {
  id?: string;
  url?: string;
  token?: string;
  authorization?: OpenResistAuthorizationPayload;
  createdAt?: string;
  expiresAt?: string;
  roomId?: number;
}

interface OpenResistStreamResult {
  pubkey?: string;
  subscriptionTier?: string;
  stream?: OpenResistStreamPayload;
}

interface OpenResistStreamResponse {
  success?: boolean;
  result?: OpenResistStreamResult;
}

export interface OpenResistWhipSession {
  url: string;
  token: string;
}

@Injectable({
  providedIn: 'root',
})
export class OpenResistStreamService {
  private static readonly STREAMS_API_URL = 'https://stream.openresist.com/api/streams';

  private readonly webRequest = inject(WebRequest);

  async createWhipSession(): Promise<OpenResistWhipSession> {
    const response = await this.webRequest.fetch(
      OpenResistStreamService.STREAMS_API_URL,
      { method: 'POST' },
      { kind: 27235 },
    );

    const payload = await response.json() as OpenResistStreamResponse;

    if (payload.success === false) {
      throw new Error('OpenResist rejected the stream session request.');
    }

    const stream = payload.result?.stream;
    const token = stream?.token ?? stream?.authorization?.token;
    const scheme = stream?.authorization?.scheme;

    if (scheme && scheme !== 'Bearer') {
      throw new Error(`OpenResist returned unsupported authorization scheme: ${scheme}.`);
    }

    if (!stream?.url || !token) {
      throw new Error('OpenResist did not return a WHIP URL and token.');
    }

    return {
      url: new URL(stream.url).toString(),
      token,
    };
  }
}