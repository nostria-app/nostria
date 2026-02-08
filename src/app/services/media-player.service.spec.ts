import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MediaPlayerService } from './media-player.service';
import { ApplicationService } from './application.service';
import { LocalStorageService } from './local-storage.service';
import { LayoutService } from './layout.service';
import { UtilitiesService } from './utilities.service';
import { WakeLockService } from './wake-lock.service';
import { OfflineMusicService } from './offline-music.service';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService } from './account-local-state.service';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';

describe('MediaPlayerService - Media Session API', () => {
  let service: MediaPlayerService;
  let mockMediaSession: any;
  let setActionHandlerSpy: jasmine.Spy;

  beforeEach(async () => {
    // Mock Media Session API
    setActionHandlerSpy = jasmine.createSpy('setActionHandler');
    mockMediaSession = {
      setActionHandler: setActionHandlerSpy,
      metadata: null,
      playbackState: 'none',
    };

    // Add mediaSession to navigator mock
    Object.defineProperty(navigator, 'mediaSession', {
      value: mockMediaSession,
      writable: true,
      configurable: true,
    });

    // Mock ApplicationService with browser detection
    const mockAppService = {
      isBrowser: () => true,
      initialized: jasmine.createSpy('initialized').and.returnValue(false),
    };

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MediaPlayerService,
        { provide: ApplicationService, useValue: mockAppService },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {}, removeItem: () => {} } },
        { provide: LayoutService, useValue: {} },
        { provide: UtilitiesService, useValue: {} },
        { provide: WakeLockService, useValue: {} },
        { provide: OfflineMusicService, useValue: {} },
        { provide: AccountStateService, useValue: { pubkey: () => null } },
        { provide: AccountLocalStateService, useValue: {} },
        { provide: DomSanitizer, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    }).compileComponents();

    service = TestBed.inject(MediaPlayerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should NOT initialize media session handlers in constructor', () => {
    // Media session handlers should not be set during construction (bootstrap)
    expect(setActionHandlerSpy).not.toHaveBeenCalled();
  });

  it('should handle missing Media Session API gracefully', async () => {
    // Remove mediaSession from navigator
    Object.defineProperty(navigator, 'mediaSession', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    // Recreate the service through TestBed with undefined mediaSession
    const testBed = TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MediaPlayerService,
        { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {}, removeItem: () => {} } },
        { provide: LayoutService, useValue: {} },
        { provide: UtilitiesService, useValue: {} },
        { provide: WakeLockService, useValue: {} },
        { provide: OfflineMusicService, useValue: {} },
        { provide: AccountStateService, useValue: { pubkey: () => null } },
        { provide: AccountLocalStateService, useValue: {} },
        { provide: DomSanitizer, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });
    
    const newService = testBed.inject(MediaPlayerService);
    
    // Should not throw any errors during construction
    expect(newService).toBeTruthy();
  });

  it('should handle partial Media Session API support', async () => {
    // Simulate environment where navigator.mediaSession exists but is null/undefined
    Object.defineProperty(navigator, 'mediaSession', {
      value: null,
      writable: true,
      configurable: true,
    });

    // Recreate service through TestBed
    const testBed = TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MediaPlayerService,
        { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {}, removeItem: () => {} } },
        { provide: LayoutService, useValue: {} },
        { provide: UtilitiesService, useValue: {} },
        { provide: WakeLockService, useValue: {} },
        { provide: OfflineMusicService, useValue: {} },
        { provide: AccountStateService, useValue: { pubkey: () => null } },
        { provide: AccountLocalStateService, useValue: {} },
        { provide: DomSanitizer, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });

    // Should not throw errors
    const newService = testBed.inject(MediaPlayerService);
    expect(newService).toBeTruthy();
  });

  it('should detect when Media Session API is supported', () => {
    // Access the private property using bracket notation
    const isSupported = (service as any).isMediaSessionSupported;
    expect(isSupported).toBe(true);
  });

  it('should detect when Media Session API is not supported', async () => {
    // Remove mediaSession
    Object.defineProperty(navigator, 'mediaSession', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    // Recreate service through TestBed
    const testBed = TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MediaPlayerService,
        { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {}, removeItem: () => {} } },
        { provide: LayoutService, useValue: {} },
        { provide: UtilitiesService, useValue: {} },
        { provide: WakeLockService, useValue: {} },
        { provide: OfflineMusicService, useValue: {} },
        { provide: AccountStateService, useValue: { pubkey: () => null } },
        { provide: AccountLocalStateService, useValue: {} },
        { provide: DomSanitizer, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });

    // Check support on a fresh instance
    const newService = testBed.inject(MediaPlayerService);
    const isSupported = (newService as any).isMediaSessionSupported;
    expect(isSupported).toBe(false);
  });

  it('should not set playbackState when Media Session API is unavailable', async () => {
    // Remove mediaSession
    Object.defineProperty(navigator, 'mediaSession', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    // Recreate service through TestBed
    const testBed = TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MediaPlayerService,
        { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {}, removeItem: () => {} } },
        { provide: LayoutService, useValue: {} },
        { provide: UtilitiesService, useValue: {} },
        { provide: WakeLockService, useValue: {} },
        { provide: OfflineMusicService, useValue: {} },
        { provide: AccountStateService, useValue: { pubkey: () => null } },
        { provide: AccountLocalStateService, useValue: {} },
        { provide: DomSanitizer, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });

    const newService = testBed.inject(MediaPlayerService);
    
    // Try to pause (which normally sets playbackState)
    // Should not throw error
    expect(() => newService.pause()).not.toThrow();
  });

  it('should handle errors when initializing media session handlers', async () => {
    // Mock setActionHandler to throw an error
    const errorMediaSession = {
      setActionHandler: jasmine.createSpy('setActionHandler').and.throwError('Test error'),
      metadata: null,
      playbackState: 'none',
    };

    Object.defineProperty(navigator, 'mediaSession', {
      value: errorMediaSession,
      writable: true,
      configurable: true,
    });

    // Recreate service through TestBed
    const testBed = TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MediaPlayerService,
        { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {}, removeItem: () => {} } },
        { provide: LayoutService, useValue: {} },
        { provide: UtilitiesService, useValue: {} },
        { provide: WakeLockService, useValue: {} },
        { provide: OfflineMusicService, useValue: {} },
        { provide: AccountStateService, useValue: { pubkey: () => null } },
        { provide: AccountLocalStateService, useValue: {} },
        { provide: DomSanitizer, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });

    const newService = testBed.inject(MediaPlayerService);
    
    // Call the private initializeMediaSession method
    // Should catch the error and not crash
    expect(() => (newService as any).initializeMediaSession()).not.toThrow();
  });
});
