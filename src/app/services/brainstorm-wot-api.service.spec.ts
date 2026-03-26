import '@angular/compiler';
import { signal } from '@angular/core';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { BrainstormWotApiService } from './brainstorm-wot-api.service';

describe('BrainstormWotApiService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates NIP-98 compliant kind 27235 auth event with u and method tags', async () => {
    const createEvent = vi.fn().mockReturnValue({ kind: 27235, content: '', tags: [] });
    const signEvent = vi.fn().mockResolvedValue({ id: 'signed-event-id' });

    const service = Object.create(BrainstormWotApiService.prototype) as BrainstormWotApiService;
    Object.assign(service as object, {
      nostr: { createEvent, signEvent },
      logger: { warn: vi.fn() },
      baseUrl: 'https://brainstormserver.nosfabrica.com',
      authToken: signal<string | null>(null),
      authenticatedPubkey: signal<string | null>(null),
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { challenge: 'challenge-123' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { token: 'token-abc' } }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const token = await (service as any).ensureAuthToken('pubkey123');

    expect(token).toBe('token-abc');
    expect(createEvent).toHaveBeenCalledWith(27235, '', [
      ['u', 'https://brainstormserver.nosfabrica.com/authChallenge/pubkey123/verify'],
      ['method', 'POST'],
      ['challenge', 'challenge-123'],
      ['t', 'brainstorm_login'],
    ]);
    expect(signEvent).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'https://brainstormserver.nosfabrica.com/authChallenge/pubkey123/verify',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
