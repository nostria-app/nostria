import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { VideoPlaybackService } from './video-playback.service';
import { WakeLockService } from './wake-lock.service';
import { AccountLocalStateService } from './account-local-state.service';
import { AccountStateService } from './account-state.service';
import { PanelNavigationService } from './panel-navigation.service';

describe('VideoPlaybackService', () => {
  let service: VideoPlaybackService;
  let showFeedsSignal: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    showFeedsSignal = signal(false);

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        VideoPlaybackService,
        /* eslint-disable @typescript-eslint/no-empty-function */
        { provide: WakeLockService, useValue: { enable: () => {}, disable: () => {} } },
        { provide: AccountLocalStateService, useValue: { getVolumeMuted: () => true, setVolumeMuted: () => {} } },
        /* eslint-enable @typescript-eslint/no-empty-function */
        { provide: AccountStateService, useValue: { pubkey: signal(null) } },
        { provide: PanelNavigationService, useValue: { showFeeds: showFeedsSignal } },
      ],
    }).compileComponents();

    service = TestBed.inject(VideoPlaybackService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('autoPlayAllowed', () => {
    it('should return true when feeds panel is visible', () => {
      showFeedsSignal.set(true);
      expect(service.autoPlayAllowed()).toBe(true);
    });

    it('should return false when feeds panel is hidden', () => {
      showFeedsSignal.set(false);
      expect(service.autoPlayAllowed()).toBe(false);
    });
  });

  describe('registerPlaying', () => {
    it('should pause previously playing video when new one starts', () => {
      const video1 = document.createElement('video');
      const video2 = document.createElement('video');
      spyOn(video1, 'pause');

      service.registerPlaying(video1);
      service.registerPlaying(video2);

      expect(video1.pause).toHaveBeenCalled();
    });

    it('should not pause the same video when registered again', () => {
      const video = document.createElement('video');
      spyOn(video, 'pause');

      service.registerPlaying(video);
      service.registerPlaying(video);

      expect(video.pause).not.toHaveBeenCalled();
    });
  });

  describe('pauseCurrentVideo', () => {
    it('should pause the currently playing video', () => {
      const video = document.createElement('video');
      spyOn(video, 'pause');

      service.registerPlaying(video);
      service.pauseCurrentVideo();

      expect(video.pause).toHaveBeenCalled();
    });

    it('should do nothing when no video is playing', () => {
      // Should not throw
      service.pauseCurrentVideo();
    });
  });

  describe('mute state', () => {
    it('should default to muted', () => {
      expect(service.isMuted()).toBe(true);
    });

    it('should toggle muted state', () => {
      const result = service.toggleMuted();
      expect(result).toBe(false);
      expect(service.isMuted()).toBe(false);
    });

    it('should set muted state', () => {
      service.setMuted(false);
      expect(service.isMuted()).toBe(false);
      service.setMuted(true);
      expect(service.isMuted()).toBe(true);
    });
  });
});
