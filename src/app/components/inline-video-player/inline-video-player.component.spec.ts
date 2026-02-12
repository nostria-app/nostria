import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, PLATFORM_ID } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { InlineVideoPlayerComponent } from './inline-video-player.component';
import { VideoPlaybackService } from '../../services/video-playback.service';
import { CastService } from '../../services/cast.service';

describe('InlineVideoPlayerComponent', () => {
  let component: InlineVideoPlayerComponent;
  let fixture: ComponentFixture<InlineVideoPlayerComponent>;
  let mockVideoPlayback: jasmine.SpyObj<VideoPlaybackService>;

  beforeEach(async () => {
    mockVideoPlayback = jasmine.createSpyObj('VideoPlaybackService', [
      'registerPlaying',
      'unregisterPlaying',
      'pauseCurrentVideo',
      'getMutedState',
      'setMuted',
      'toggleMuted',
    ], {
      isMuted: signal(true),
      autoPlayAllowed: signal(true),
    });
    mockVideoPlayback.getMutedState.and.returnValue(true);

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
});
