import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { UtilitiesService } from './utilities.service';
import { IgnoredRelayAuditService } from './ignored-relay-audit.service';
import { LoggerService } from './logger.service';
import { RegionService } from './region.service';

const YGG_URL = 'ws://[31b:6f20:c7f2:3ddf::3221]';
const YGG_NORMALIZED = 'ws://[31b:6f20:c7f2:3ddf::3221]/';
const ALLOW_WS = { allowWs: true } as const;

describe('UtilitiesService relay URL validation', () => {
  let service: UtilitiesService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DomSanitizer, useValue: {} },
        { provide: IgnoredRelayAuditService, useValue: {} },
        { provide: LoggerService, useValue: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} } },
        { provide: RegionService, useValue: { rewriteAppRelayUrl: (url: string) => url } },
      ],
    });

    service = TestBed.inject(UtilitiesService);
  });

  describe('normalizeRelayUrl', () => {
    it('keeps existing wss:// relays and adds a trailing slash', () => {
      expect(service.normalizeRelayUrl('wss://relay.damus.io')).toBe('wss://relay.damus.io/');
    });

    it('rejects overlay ws:// by default', () => {
      expect(service.normalizeRelayUrl(YGG_URL)).toBe('');
      expect(service.normalizeRelayUrl('ws://relay.example.i2p')).toBe('');
    });

    it('accepts the Yggdrasil IPv6 URL from issue #632 without rewriting to wss://', () => {
      expect(service.normalizeRelayUrl(YGG_URL, false, ALLOW_WS)).toBe(YGG_NORMALIZED);
    });

    it('accepts typical I2P and Tor ws:// hosts when allowWs is set', () => {
      expect(service.normalizeRelayUrl('ws://relay.example.i2p', false, ALLOW_WS)).toBe(
        'ws://relay.example.i2p/'
      );
      expect(
        service.normalizeRelayUrl(
          'ws://abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopq.onion',
          false,
          ALLOW_WS
        )
      ).toBe('ws://abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopq.onion/');
    });

    it('preserves a path on an allowed ws:// URL', () => {
      expect(service.normalizeRelayUrl('ws://relay.example.i2p/inbox', false, ALLOW_WS)).toBe(
        'ws://relay.example.i2p/inbox'
      );
    });

    it('rejects clearnet ws:// even when allowWs is set', () => {
      expect(service.normalizeRelayUrl('ws://evil.example.com', false, ALLOW_WS)).toBe('');
    });

    it('rejects javascript:, http(s):, credentials, localhost, [::1], and empty host', () => {
      expect(service.normalizeRelayUrl('javascript:alert(1)')).toBe('');
      expect(service.normalizeRelayUrl('http://relay.damus.io')).toBe('');
      expect(service.normalizeRelayUrl('https://relay.damus.io')).toBe('');
      expect(service.normalizeRelayUrl('wss://user:pass@relay.damus.io')).toBe('');
      expect(service.normalizeRelayUrl('wss://localhost')).toBe('');
      expect(service.normalizeRelayUrl('wss://[::1]')).toBe('');
      expect(service.normalizeRelayUrl('ws://localhost', false, ALLOW_WS)).toBe('');
      expect(service.normalizeRelayUrl('ws://[::1]', false, ALLOW_WS)).toBe('');
      expect(service.normalizeRelayUrl('wss://')).toBe('');
      expect(service.normalizeRelayUrl('ws:///')).toBe('');
    });

    it('rejects scheme-less input', () => {
      expect(service.normalizeRelayUrl('relay.damus.io')).toBe('');
    });

    it('rejects malformed autocomplete hostnames', () => {
      expect(service.normalizeRelayUrl('wss://was//snort.social')).toBe('');
    });
  });

  describe('isValidRelayUrl', () => {
    it('accepts wss:// and rejects overlay ws:// without allowWs', () => {
      expect(service.isValidRelayUrl('wss://nos.lol/')).toBe(true);
      expect(service.isValidRelayUrl(YGG_URL)).toBe(false);
    });

    it('accepts overlay-network ws:// URLs when allowWs is set', () => {
      expect(service.isValidRelayUrl(YGG_URL, ALLOW_WS)).toBe(true);
      expect(service.isValidRelayUrl('ws://relay.example.b32.i2p', ALLOW_WS)).toBe(true);
    });

    it('rejects non-websocket schemes and clearnet ws://', () => {
      expect(service.isValidRelayUrl('http://relay.damus.io')).toBe(false);
      expect(service.isValidRelayUrl('ws://evil.example.com', ALLOW_WS)).toBe(false);
    });
  });
});
