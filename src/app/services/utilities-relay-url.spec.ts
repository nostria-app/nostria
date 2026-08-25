import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { UtilitiesService } from './utilities.service';
import { IgnoredRelayAuditService } from './ignored-relay-audit.service';
import { LoggerService } from './logger.service';
import { RegionService } from './region.service';

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

    it('accepts the Yggdrasil IPv6 URL from issue #632 without rewriting to wss://', () => {
      expect(service.normalizeRelayUrl('ws://[31b:6f20:c7f2:3ddf::3221]')).toBe(
        'ws://[31b:6f20:c7f2:3ddf::3221]/'
      );
    });

    it('accepts typical I2P and Tor ws:// hosts', () => {
      expect(service.normalizeRelayUrl('ws://relay.example.i2p')).toBe('ws://relay.example.i2p/');
      expect(
        service.normalizeRelayUrl('ws://abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopq.onion')
      ).toBe('ws://abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopq.onion/');
    });

    it('preserves a path on a ws:// URL', () => {
      expect(service.normalizeRelayUrl('ws://relay.example.i2p/inbox')).toBe(
        'ws://relay.example.i2p/inbox'
      );
    });

    it('rejects http(s) and scheme-less input', () => {
      expect(service.normalizeRelayUrl('https://relay.damus.io')).toBe('');
      expect(service.normalizeRelayUrl('relay.damus.io')).toBe('');
    });

    it('rejects malformed autocomplete hostnames', () => {
      expect(service.normalizeRelayUrl('wss://was//snort.social')).toBe('');
    });
  });

  describe('isValidRelayUrl', () => {
    it('accepts wss:// and overlay-network ws:// URLs', () => {
      expect(service.isValidRelayUrl('wss://nos.lol/')).toBe(true);
      expect(service.isValidRelayUrl('ws://[31b:6f20:c7f2:3ddf::3221]')).toBe(true);
      expect(service.isValidRelayUrl('ws://relay.example.b32.i2p')).toBe(true);
    });

    it('rejects non-websocket schemes', () => {
      expect(service.isValidRelayUrl('http://relay.damus.io')).toBe(false);
    });
  });
});
