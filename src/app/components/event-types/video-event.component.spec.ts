import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { VideoEventComponent } from './video-event.component';
import { VideoPlaybackService } from '../../services/video-playback.service';
import { SettingsService } from '../../services/settings.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { CastService } from '../../services/cast.service';
import { ImagePlaceholderService } from '../../services/image-placeholder.service';
import { LayoutService } from '../../services/layout.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LoggerService } from '../../services/logger.service';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Event } from 'nostr-tools';

describe('VideoEventComponent', () => {
  let component: VideoEventComponent;
  let fixture: ComponentFixture<VideoEventComponent>;
  let mockVideoPlayback: jasmine.SpyObj<VideoPlaybackService>;

  const mockVideoEvent: Event = {
    id: 'test-video-id',
    pubkey: 'test-pubkey',
    created_at: Math.floor(Date.now() / 1000),
    kind: 22, // Short form video
    tags: [
      ['imeta', 'url https://example.com/video.mp4', 'dim 1920x1080'],
    ],
    content: 'Test video',
    sig: 'test-sig',
  };

  beforeEach(async () => {
    mockVideoPlayback = jasmine.createSpyObj('VideoPlaybackService', [
      'registerPlaying',
      'unregisterPlaying',
      'pauseCurrentVideo',
      'getMutedState',
      'setMuted',
    ], {
      isMuted: signal(true),
      autoPlayAllowed: signal(false),
    });
    mockVideoPlayback.getMutedState.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [VideoEventComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: VideoPlaybackService, useValue: mockVideoPlayback },
        {
          provide: SettingsService,
          useValue: {
            settings: signal({
              autoPlayShortForm: true,
              repeatShortForm: true,
              mediaPrivacy: 'show-always',
            }),
          },
        },
        { provide: AccountStateService, useValue: { pubkey: signal(null), followingList: signal([]) } },
        /* eslint-disable @typescript-eslint/no-empty-function */
        {
          provide: AccountLocalStateService,
          useValue: {
            isMediaAuthorTrusted: () => false,
            addTrustedMediaAuthor: () => {},
          },
        },
        { provide: CastService, useValue: {} },
        {
          provide: ImagePlaceholderService,
          useValue: {
            getPlaceholderFromEvent: () => ({ blurhash: null, thumbhash: null }),
            getPlaceholderDataUrlFromEvent: () => null,
            extractPlaceholderFromImeta: () => ({ blurhash: null, thumbhash: null, dimensions: null }),
            generatePlaceholderDataUrl: () => '',
          },
        },
        { provide: LayoutService, useValue: { openGenericEvent: () => {} } },
        {
          provide: UtilitiesService,
          useValue: {
            parseImetaTag: (tag: string[]) => {
              const result: Record<string, string> = {};
              for (let i = 1; i < tag.length; i++) {
                const spaceIndex = tag[i].indexOf(' ');
                if (spaceIndex > 0) {
                  result[tag[i].substring(0, spaceIndex)] = tag[i].substring(spaceIndex + 1);
                }
              }
              return result;
            },
          },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: () => {},
            warn: () => {},
            error: () => {},
          },
        },
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: MatDialog, useValue: { open: () => {} } },
        /* eslint-enable @typescript-eslint/no-empty-function */
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VideoEventComponent);
    fixture.componentRef.setInput('event', mockVideoEvent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('shouldAutoPlay', () => {
    it('should not auto-play when autoPlayAllowed is false (feeds hidden)', async () => {
      fixture.componentRef.setInput('inFeedsPanel', true);
      await fixture.whenStable();

      // autoPlayAllowed returns false (feeds are hidden)
      expect(component.shouldAutoPlay()).toBe(false);
    });

    it('should not auto-play non-short-form videos', async () => {
      const longFormEvent: Event = {
        ...mockVideoEvent,
        kind: 21, // Long form video
      };
      fixture.componentRef.setInput('event', longFormEvent);
      await fixture.whenStable();

      expect(component.isShortFormVideo()).toBe(false);
      expect(component.shouldAutoPlay()).toBe(false);
    });
  });

  describe('video element', () => {
    it('should not have native autoplay attribute in template', () => {
      // Expand the video to render the video element
      component.isExpanded.set(true);
      fixture.detectChanges();

      const videoEl = fixture.nativeElement.querySelector('video.video-player');
      // The video element should not have the autoplay attribute
      // (we removed [autoplay] binding to prevent browser native autoplay)
      if (videoEl) {
        expect(videoEl.autoplay).toBe(false);
      }
    });
  });

  describe('visibility check', () => {
    it('should detect when element is hidden by visibility', () => {
      // Wrap the host element in a hidden container
      const hostEl = fixture.nativeElement as HTMLElement;
      const wrapper = document.createElement('div');
      wrapper.style.visibility = 'hidden';
      hostEl.parentElement?.insertBefore(wrapper, hostEl);
      wrapper.appendChild(hostEl);

      // Re-init the IntersectionObserver
      component.ngAfterViewInit();
      fixture.detectChanges();

      // isInViewport should be false because parent is hidden
      expect(component.isInViewport()).toBe(false);

      // Clean up
      wrapper.parentElement?.insertBefore(hostEl, wrapper);
      wrapper.remove();
    });
  });

  describe('feeds panel auto-play prevention', () => {
    it('should pause expanded video when feeds panel becomes hidden', async () => {
      fixture.componentRef.setInput('inFeedsPanel', true);

      // Expand the video to render the player
      component.isExpanded.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      // Create a mock video element that reports as playing
      const mockVideo = document.createElement('video');
      let pauseCalled = false;
      mockVideo.pause = () => { pauseCalled = true; };
      Object.defineProperty(mockVideo, 'paused', { get: () => !pauseCalled ? false : true });

      // Set the videoPlayerRef to point to our mock
      component['_videoPlayerRef'] = { nativeElement: mockVideo } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      // Set viewport to true (simulates stale IntersectionObserver state)
      component.isInViewport.set(true);
      await fixture.whenStable();

      // Now simulate feeds panel hiding by changing autoPlayAllowed
      (mockVideoPlayback.autoPlayAllowed as any).set(true); // eslint-disable-line @typescript-eslint/no-explicit-any
      await fixture.whenStable();
      pauseCalled = false; // Reset

      (mockVideoPlayback.autoPlayAllowed as any).set(false); // eslint-disable-line @typescript-eslint/no-explicit-any
      await fixture.whenStable();

      expect(pauseCalled).toBe(true);
    });

    it('should not auto-expand short-form video when feeds panel is hidden', async () => {
      fixture.componentRef.setInput('inFeedsPanel', true);
      await fixture.whenStable();

      // autoPlayAllowed is false (from test setup), so shouldAutoPlay should be false
      expect(component.shouldAutoPlay()).toBe(false);
      // Video should NOT be expanded
      expect(component.isExpanded()).toBe(false);
    });
  });
});
