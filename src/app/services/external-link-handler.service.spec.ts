import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { nip19 } from 'nostr-tools';
import { ExternalLinkHandlerService } from './external-link-handler.service';
import { LoggerService } from './logger.service';
import { LocalStorageService } from './local-storage.service';

describe('ExternalLinkHandlerService', () => {
  let service: ExternalLinkHandlerService;
  let routerSpy: jasmine.SpyObj<Router>;
  let localStorageSpy: jasmine.SpyObj<LocalStorageService>;

  // Test data
  const testPubkey = '7460e57a4d77fc2e2e2e3e071a80f14745c3c3e98db0b16995a5e9a0bc104b27';
  const testNpub = nip19.npubEncode(testPubkey);
  const testPlaylistIdentifier = 'darkweb-1765800968679';
  const testTrackIdentifier = 'my-track-123';

  // Encode naddr for music playlist (kind 34139)
  const playlistNaddr = nip19.naddrEncode({
    kind: 34139,
    pubkey: testPubkey,
    identifier: testPlaylistIdentifier,
    relays: ['wss://relay.damus.io'],
  });

  // Encode naddr for music track (kind 36787)
  const trackNaddr = nip19.naddrEncode({
    kind: 36787,
    pubkey: testPubkey,
    identifier: testTrackIdentifier,
    relays: ['wss://relay.damus.io'],
  });

  // Encode naddr for article (kind 30023)
  const articleNaddr = nip19.naddrEncode({
    kind: 30023,
    pubkey: testPubkey,
    identifier: 'my-article',
  });

  beforeEach(() => {
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    routerSpy.navigate.and.returnValue(Promise.resolve(true));

    localStorageSpy = jasmine.createSpyObj('LocalStorageService', ['getObject', 'setObject']);
    localStorageSpy.getObject.and.returnValue(null); // Use default domains

    TestBed.configureTestingModule({
      providers: [
        ExternalLinkHandlerService,
        { provide: Router, useValue: routerSpy },
        { provide: LoggerService, useValue: { info: jasmine.createSpy(), warn: jasmine.createSpy(), error: jasmine.createSpy(), debug: jasmine.createSpy() } },
        { provide: LocalStorageService, useValue: localStorageSpy },
      ],
    });

    service = TestBed.inject(ExternalLinkHandlerService);
  });

  describe('sunami.app domain handling', () => {
    it('should include sunami.app in default domains', () => {
      const domains = service.getConfiguredDomains();
      expect(domains).toContain('sunami.app');
    });

    it('should handle sunami.app URLs internally', () => {
      expect(service.shouldHandleInternally('https://sunami.app/release/naddr1abc')).toBe(true);
    });
  });

  describe('handleLinkClick with sunami.app release URLs', () => {
    it('should route sunami.app /release/naddr1 playlist URL to music playlist page', () => {
      const url = `https://sunami.app/release/${playlistNaddr}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith([
        `/music/playlist/${testNpub}/${testPlaylistIdentifier}`
      ]);
    });

    it('should route sunami.app /release/naddr1 track URL to song detail page', () => {
      const url = `https://sunami.app/release/${trackNaddr}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith([
        `/music/song/${testNpub}/${testTrackIdentifier}`
      ]);
    });

    it('should route sunami.app /release/naddr1 article URL to article page', () => {
      const url = `https://sunami.app/release/${articleNaddr}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith([
        `/a/${articleNaddr}`
      ]);
    });
  });

  describe('handleLinkClick with naddr1 direct path', () => {
    it('should route direct /naddr1 playlist URL to music playlist page', () => {
      const url = `https://njump.me/${playlistNaddr}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith([
        `/music/playlist/${testNpub}/${testPlaylistIdentifier}`
      ]);
    });

    it('should route direct /naddr1 track URL to song detail page', () => {
      const url = `https://njump.me/${trackNaddr}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith([
        `/music/song/${testNpub}/${testTrackIdentifier}`
      ]);
    });

    it('should route direct /naddr1 article URL to article page', () => {
      const url = `https://njump.me/${articleNaddr}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith([
        `/a/${articleNaddr}`
      ]);
    });
  });

  describe('handleLinkClick with /a/ prefix naddr1', () => {
    it('should route /a/naddr1 playlist to music playlist page', () => {
      const url = `https://nostria.app/a/${playlistNaddr}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith([
        `/music/playlist/${testNpub}/${testPlaylistIdentifier}`
      ]);
    });

    it('should route /a/naddr1 track to song detail page', () => {
      const url = `https://nostria.app/a/${trackNaddr}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith([
        `/music/song/${testNpub}/${testTrackIdentifier}`
      ]);
    });
  });

  describe('handleLinkClick with modifier keys', () => {
    it('should not handle internally when ctrl key is pressed', () => {
      const url = `https://sunami.app/release/${playlistNaddr}`;
      const event = { ctrlKey: true, altKey: false, shiftKey: false } as MouseEvent;
      const result = service.handleLinkClick(url, event);

      expect(result).toBe(false);
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });
  });

  describe('handleLinkClick with non-configured domains', () => {
    it('should not handle URLs from unknown domains', () => {
      const url = `https://unknown-domain.com/release/${playlistNaddr}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(false);
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });
  });

  describe('existing nostria.app music routes', () => {
    it('should handle nostria.app music playlist route', () => {
      const url = `https://nostria.app/music/playlist/${testNpub}/${testPlaylistIdentifier}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith([
        '/music/playlist', testNpub, testPlaylistIdentifier
      ]);
    });

    it('should handle nostria.app music song route', () => {
      const url = `https://nostria.app/music/song/${testNpub}/${testTrackIdentifier}`;
      const result = service.handleLinkClick(url);

      expect(result).toBe(true);
      expect(routerSpy.navigate).toHaveBeenCalledWith([
        '/music/song', testNpub, testTrackIdentifier
      ]);
    });
  });
});
