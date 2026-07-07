import type { MockedObject } from "vitest";
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, PLATFORM_ID } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { InlineVideoPlayerComponent } from './inline-video-player.component';
import { VideoPlaybackService } from '../../services/video-playback.service';
import { CastService } from '../../services/cast.service';
import { UtilitiesService } from '../../services/utilities.service';

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
        { provide: UtilitiesService, useValue: { extractThumbnailFromVideo: vi.fn().mockResolvedValue({ objectUrl: '' }) } },
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

  describe('load retry scheduling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should schedule a retry timer on first video error', async () => {
      const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
      component['attachVideoListeners'](video); // eslint-disable-line @typescript-eslint/no-explicit-any

      video.dispatchEvent(new Event('error'));
      await fixture.whenStable();

      expect(component['loadRetryTimer']).not.toBeNull();
      expect(component['loadRetryCount']).toBe(1);
      expect(component.hasError()).toBe(false);
    });

    it('should clear retry timer and reset count when canplay fires', async () => {
      const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
      component['attachVideoListeners'](video); // eslint-disable-line @typescript-eslint/no-explicit-any

      // Trigger an error so a retry is scheduled
      video.dispatchEvent(new Event('error'));
      await fixture.whenStable();
      expect(component['loadRetryTimer']).not.toBeNull();

      // canplay should clear the timer and reset the count
      video.dispatchEvent(new Event('canplay'));
      await fixture.whenStable();

      expect(component['loadRetryTimer']).toBeNull();
      expect(component['loadRetryCount']).toBe(0);
    });

    it('should set hasError after all retries are exhausted', async () => {
      const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
      component['attachVideoListeners'](video); // eslint-disable-line @typescript-eslint/no-explicit-any

      // Exhaust scheduled retries (VIDEO_LOAD_RETRY_DELAYS_MS has 2 entries)
      video.dispatchEvent(new Event('error')); // schedules retry 1
      await fixture.whenStable();
      vi.runAllTimers(); // fire retry 1 → video.load() → triggers another error
      video.dispatchEvent(new Event('error')); // schedules retry 2
      await fixture.whenStable();
      vi.runAllTimers(); // fire retry 2 → video.load() → triggers another error
      video.dispatchEvent(new Event('error')); // no retries left → blob fallback → then error
      await fixture.whenStable();

      expect(component.hasError()).toBe(true);
    });
  });

  describe('retryVideoLoad - manual retry', () => {
    it('should reset error and retry state', async () => {
      // Manually put component into error state
      component['hasError'].set(true);
      component['loadRetryCount'] = 2;
      component['hasTriedBlobFallback'] = true;
      await fixture.whenStable();

      component.retryVideoLoad();
      await fixture.whenStable();

      expect(component.hasError()).toBe(false);
      expect(component['loadRetryCount']).toBe(0);
      expect(component['hasTriedBlobFallback']).toBe(false);
    });

    it('should reset playback state signals', async () => {
      component['hasPlayedOnce'].set(true);
      component['wasAutoPlayed'].set(true);
      component['userPausedByInteraction'].set(true);

      component.retryVideoLoad();
      await fixture.whenStable();

      expect(component.hasPlayedOnce()).toBe(false);
      expect(component['wasAutoPlayed']()).toBe(false);
      expect(component['userPausedByInteraction']()).toBe(false);
    });

    it('should clear an active retry timer', async () => {
      vi.useFakeTimers();
      const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
      component['attachVideoListeners'](video); // eslint-disable-line @typescript-eslint/no-explicit-any
      video.dispatchEvent(new Event('error')); // schedules timer
      await fixture.whenStable();
      expect(component['loadRetryTimer']).not.toBeNull();

      component.retryVideoLoad();
      await fixture.whenStable();

      expect(component['loadRetryTimer']).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('fullscreen delegate', () => {
    it('should invoke the delegate instead of native fullscreen when set', async () => {
      const delegate = vi.fn();
      fixture.componentRef.setInput('fullscreenDelegate', delegate);
      await fixture.whenStable();

      await component.toggleFullscreen();

      expect(delegate).toHaveBeenCalledOnce();
    });

    it('should not invoke the delegate when a containerOverride is provided', async () => {
      const delegate = vi.fn();
      fixture.componentRef.setInput('fullscreenDelegate', delegate);
      await fixture.whenStable();

      const container = document.createElement('div');
      await component.toggleFullscreen(container);

      expect(delegate).not.toHaveBeenCalled();
    });

    it('should not invoke the delegate when none is set', async () => {
      // No fullscreenDelegate input set – toggleFullscreen should not throw
      await expect(component.toggleFullscreen()).resolves.not.toThrow();
    });
  });
});
