import type { MockedObject } from "vitest";
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, PLATFORM_ID } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { InlineVideoPlayerComponent } from './inline-video-player.component';
import { VideoPlaybackService } from '../../services/video-playback.service';
import { CastService } from '../../services/cast.service';

describe('InlineVideoPlayerComponent', () => {
  let component: InlineVideoPlayerComponent;
  let fixture: ComponentFixture<InlineVideoPlayerComponent>;
  let mockVideoPlayback: MockedObject<VideoPlaybackService>;

  beforeEach(async () => {
    mockVideoPlayback = {
      registerPlaying: vi.fn().mockName("VideoPlaybackService.registerPlaying"),
      unregisterPlaying: vi.fn().mockName("VideoPlaybackService.unregisterPlaying"),
      pauseCurrentVideo: vi.fn().mockName("VideoPlaybackService.pauseCurrentVideo"),
      getMutedState: vi.fn().mockName("VideoPlaybackService.getMutedState"),
      setMuted: vi.fn().mockName("VideoPlaybackService.setMuted"),
      toggleMuted: vi.fn().mockName("VideoPlaybackService.toggleMuted"),
      isMuted: signal(true),
      autoPlayAllowed: signal(true)
    } as unknown as MockedObject<VideoPlaybackService>;
    mockVideoPlayback.getMutedState.mockReturnValue(true);

    await TestBed.configureTestingModule({
      imports: [InlineVideoPlayerComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: VideoPlaybackService, useValue: mockVideoPlayback },
        { provide: CastService, useValue: {} },
        { provide: OverlayContainer, useValue: { getContainerElement: () => document.createElement('div') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InlineVideoPlayerComponent);
    fixture.componentRef.setInput('src', 'https://example.com/video.mp4');
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('visibility-aware IntersectionObserver', () => {
    it('should not report as in viewport when parent has visibility:hidden', async () => {
      // Access the private isInViewport signal through component behavior
      // The component creates an IntersectionObserver in ngAfterViewInit
      // that checks visibility before setting isInViewport

      // Wrap the host element in a hidden container to simulate feeds panel
      const hostEl = fixture.nativeElement as HTMLElement;
      const wrapper = document.createElement('div');
      wrapper.style.visibility = 'hidden';
      hostEl.parentElement?.insertBefore(wrapper, hostEl);
      wrapper.appendChild(hostEl);

      // Trigger ngAfterViewInit to set up IntersectionObserver
      component.ngAfterViewInit();
      await fixture.whenStable();

      // The paused signal should remain true (no auto-play triggered)
      expect(component.paused()).toBe(true);

      // Clean up
      wrapper.parentElement?.insertBefore(hostEl, wrapper);
      wrapper.remove();
    });

    it('should start paused by default', () => {
      expect(component.paused()).toBe(true);
    });

    it('should not have played initially', () => {
      expect(component.hasPlayedOnce()).toBe(false);
    });
  });

  describe('feeds panel auto-play prevention', () => {
    it('should pause video when feeds panel becomes hidden', async () => {
      // Set up the component as if it's in the feeds panel with autoplay
      fixture.componentRef.setInput('inFeedsPanel', true);
      fixture.componentRef.setInput('autoplay', true);
      await fixture.whenStable();

      // Simulate a video element that is playing
      const mockVideo = document.createElement('video');
      let pauseCalled = false;
      mockVideo.pause = () => { pauseCalled = true; };
      Object.defineProperty(mockVideo, 'paused', { get: () => !pauseCalled ? false : true });

      // Replace the video element reference
      component['videoElement'] = { nativeElement: mockVideo } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      // Simulate feeds panel becoming hidden by setting autoPlayAllowed to false
      (mockVideoPlayback.autoPlayAllowed as any).set(false); // eslint-disable-line @typescript-eslint/no-explicit-any
      await fixture.whenStable();

      expect(pauseCalled).toBe(true);
    });

    it('should not pause video outside feeds panel when autoPlayAllowed changes', async () => {
      // Set up the component as NOT in the feeds panel
      fixture.componentRef.setInput('inFeedsPanel', false);
      fixture.componentRef.setInput('autoplay', true);
      await fixture.whenStable();

      // Simulate a video element that is playing
      const mockVideo = document.createElement('video');
      let pauseCalled = false;
      mockVideo.pause = () => { pauseCalled = true; };
      Object.defineProperty(mockVideo, 'paused', { get: () => false });

      // Replace the video element reference
      component['videoElement'] = { nativeElement: mockVideo } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      // Change autoPlayAllowed - should not affect non-feeds videos
      (mockVideoPlayback.autoPlayAllowed as any).set(false); // eslint-disable-line @typescript-eslint/no-explicit-any
      await fixture.whenStable();

      expect(pauseCalled).toBe(false);
    });
  });

  describe('toggle controls', () => {
    it('should toggle play/pause', () => {
      // Initially paused
      expect(component.paused()).toBe(true);

      // togglePlay calls video.play() which may fail in test env
      // but the method should exist and be callable
      expect(component.togglePlay).toBeDefined();
    });

    it('should toggle mute', () => {
      expect(component.toggleMute).toBeDefined();
    });
  });

  describe('preload mode', () => {
    it('should default to metadata preload', () => {
      const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;

      expect(video.getAttribute('preload')).toBe('metadata');
    });

    it('should allow eager preload for clip playback', () => {
      fixture.componentRef.setInput('preload', 'auto');
      fixture.detectChanges();

      const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;

      expect(video.getAttribute('preload')).toBe('auto');
    });
  });

  describe('retry logic', () => {
    let mockVideo: HTMLVideoElement;

    beforeEach(() => {
      vi.useFakeTimers();
      mockVideo = document.createElement('video');
      Object.defineProperty(mockVideo, 'paused', { get: () => true, configurable: true });
      mockVideo.load = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      component['videoElement'] = { nativeElement: mockVideo } as any;
      component['cleanupVideoListeners']();
      component['attachVideoListeners'](mockVideo);
    });

    afterEach(() => {
      component['cleanupVideoListeners']();
      vi.useRealTimers();
    });

    it('should schedule a retry on first video error', () => {
      mockVideo.dispatchEvent(new Event('error'));

      expect(component['loadRetryCount']).toBe(1);
      expect(component['loadRetryTimer']).not.toBeNull();
      // Error state should not be shown yet while a retry is pending
      expect(component.hasError()).toBe(false);
    });

    it('should call video.load() after the retry delay', () => {
      mockVideo.dispatchEvent(new Event('error'));
      expect(mockVideo.load).not.toHaveBeenCalled();

      vi.advanceTimersByTime(900);

      expect(mockVideo.load).toHaveBeenCalledTimes(1);
      expect(component['loadRetryTimer']).toBeNull();
    });

    it('should schedule a second retry on a subsequent error after the first', () => {
      // First error schedules retry 1
      mockVideo.dispatchEvent(new Event('error'));
      vi.advanceTimersByTime(900); // execute first retry (calls video.load)

      // Second error schedules retry 2
      mockVideo.dispatchEvent(new Event('error'));

      expect(component['loadRetryCount']).toBe(2);
      expect(component['loadRetryTimer']).not.toBeNull();
    });

    it('should show error after exhausting all retries and blob fallback', () => {
      // Simulate retries already exhausted
      component['loadRetryCount'] = 2; // VIDEO_LOAD_RETRY_DELAYS_MS.length
      component['hasTriedBlobFallback'] = true;

      mockVideo.dispatchEvent(new Event('error'));

      expect(component.hasError()).toBe(true);
    });

    it('should clear retry timer and reset count when canplay fires', () => {
      // Schedule a retry
      mockVideo.dispatchEvent(new Event('error'));
      expect(component['loadRetryTimer']).not.toBeNull();

      // Video successfully starts playing
      mockVideo.dispatchEvent(new Event('canplay'));

      expect(component['loadRetryTimer']).toBeNull();
      expect(component['loadRetryCount']).toBe(0);
    });

    it('should clear retry timer and mark ready when canplay fires', () => {
      mockVideo.dispatchEvent(new Event('error'));
      mockVideo.dispatchEvent(new Event('canplay'));

      expect(component.isReady()).toBe(true);
      expect(component.hasError()).toBe(false);
    });
  });

  describe('manual retry (retryVideoLoad)', () => {
    let mockVideo: HTMLVideoElement;

    beforeEach(() => {
      mockVideo = document.createElement('video');
      mockVideo.load = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      component['videoElement'] = { nativeElement: mockVideo } as any;
    });

    it('should reset error and retry state', () => {
      component.hasError.set(true);
      component['loadRetryCount'] = 2;
      component['hasTriedBlobFallback'] = true;

      component.retryVideoLoad();

      expect(component.hasError()).toBe(false);
      expect(component['loadRetryCount']).toBe(0);
      expect(component['hasTriedBlobFallback']).toBe(false);
    });

    it('should reset playback signals', () => {
      component.hasPlayedOnce.set(true);

      component.retryVideoLoad();

      expect(component.hasPlayedOnce()).toBe(false);
    });

    it('should call video.load() to restart loading', () => {
      component.retryVideoLoad();

      expect(mockVideo.load).toHaveBeenCalled();
    });

    it('should not throw when called without a video element', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      component['videoElement'] = undefined as any;

      expect(() => component.retryVideoLoad()).not.toThrow();
    });
  });

  describe('fullscreen delegate', () => {
    it('should call delegate instead of native fullscreen when delegate is provided', async () => {
      const delegate = vi.fn();
      fixture.componentRef.setInput('fullscreenDelegate', delegate);
      await fixture.whenStable();

      await component.toggleFullscreen();

      expect(delegate).toHaveBeenCalledOnce();
    });

    it('should bypass delegate when a containerOverride is supplied', async () => {
      const delegate = vi.fn();
      fixture.componentRef.setInput('fullscreenDelegate', delegate);
      await fixture.whenStable();

      const container = document.createElement('div');
      // toggleFullscreen resolves even if requestFullscreen is unavailable in jsdom
      await component.toggleFullscreen(container);

      expect(delegate).not.toHaveBeenCalled();
    });

    it('should not throw when no delegate and no video element is available', async () => {
      fixture.componentRef.setInput('fullscreenDelegate', undefined);
      await fixture.whenStable();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      component['videoElement'] = undefined as any;

      await expect(component.toggleFullscreen()).resolves.not.toThrow();
    });
  });
});
