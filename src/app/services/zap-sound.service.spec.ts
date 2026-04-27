import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, provideZonelessChangeDetection, signal } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ZapSoundService } from './zap-sound.service';
import { SettingsService } from './settings.service';
import { MediaPlayerService } from './media-player.service';

describe('ZapSoundService', () => {
  const settings = signal({ zapSoundsEnabled: true });
  const isMusicPlaying = signal(false);
  let audioConstructor: ReturnType<typeof vi.fn>;
  let audioContextConstructor: ReturnType<typeof vi.fn>;
  let play: ReturnType<typeof vi.fn>;

  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.stubGlobal('document', {
      body: {},
      createElement: vi.fn(() => ({})),
    });
    play = vi.fn().mockResolvedValue(undefined);
    audioConstructor = vi.fn().mockImplementation(() => ({
      preload: '',
      currentTime: 0,
      volume: 1,
      play,
    }));
    audioContextConstructor = vi.fn();
    vi.stubGlobal('Audio', audioConstructor);
    vi.stubGlobal('AudioContext', audioContextConstructor);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ZapSoundService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: SettingsService,
          useValue: { settings },
        },
        {
          provide: MediaPlayerService,
          useValue: { isMusicPlaying },
        },
      ],
    });
  });

  afterEach(() => {
    settings.set({ zapSoundsEnabled: true });
    isMusicPlaying.set(false);
  });

  it('does not play like sounds while music is playing', () => {
    isMusicPlaying.set(true);

    TestBed.inject(ZapSoundService).playLikeSound();

    expect(audioConstructor).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('does not play zap sounds while music is playing', () => {
    isMusicPlaying.set(true);

    TestBed.inject(ZapSoundService).playZapSound(1000);

    expect(audioContextConstructor).not.toHaveBeenCalled();
  });
});
