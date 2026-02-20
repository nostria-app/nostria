import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { StandaloneVideoPlayerComponent } from './video-player.component';
import { MediaPlayerService } from '../../services/media-player.service';
import { LayoutService } from '../../services/layout.service';

describe('StandaloneVideoPlayerComponent', () => {
  let component: StandaloneVideoPlayerComponent;
  let fixture: ComponentFixture<StandaloneVideoPlayerComponent>;
  let mockMediaService: {
    current: ReturnType<typeof signal>;
    youtubeUrl: ReturnType<typeof signal>;
    videoUrl: ReturnType<typeof signal>;
  };
  let mockLayoutService: Record<string, unknown>;

  beforeEach(async () => {
    mockMediaService = {
      current: signal(undefined),
      youtubeUrl: signal(undefined),
      videoUrl: signal(undefined),
    };

    mockLayoutService = {};

    await TestBed.configureTestingModule({
      imports: [StandaloneVideoPlayerComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MediaPlayerService, useValue: mockMediaService },
        { provide: LayoutService, useValue: mockLayoutService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StandaloneVideoPlayerComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not render video container when no media is current', async () => {
    await fixture.whenStable();
    const videoContainer = fixture.nativeElement.querySelector('.video-container');
    expect(videoContainer).toBeNull();
  });

  describe('videoMimeType', () => {
    it('should return video/mp4 for mp4 files', () => {
      mockMediaService.videoUrl.set('https://example.com/video.mp4' as unknown);
      expect(component.videoMimeType()).toBe('video/mp4');
    });

    it('should return video/webm for webm files', () => {
      mockMediaService.videoUrl.set('https://example.com/video.webm' as unknown);
      expect(component.videoMimeType()).toBe('video/webm');
    });

    it('should return video/mp4 for mov files', () => {
      mockMediaService.videoUrl.set('https://example.com/video.mov' as unknown);
      expect(component.videoMimeType()).toBe('video/mp4');
    });

    it('should return video/ogg for ogg files', () => {
      mockMediaService.videoUrl.set('https://example.com/video.ogg' as unknown);
      expect(component.videoMimeType()).toBe('video/ogg');
    });

    it('should return video/quicktime for qt files', () => {
      mockMediaService.videoUrl.set('https://example.com/video.qt' as unknown);
      expect(component.videoMimeType()).toBe('video/quicktime');
    });

    it('should return video/mp4 for unknown extensions', () => {
      mockMediaService.videoUrl.set('https://example.com/video.xyz' as unknown);
      expect(component.videoMimeType()).toBe('video/mp4');
    });

    it('should return video/mp4 when no URL is set', () => {
      mockMediaService.videoUrl.set(undefined);
      expect(component.videoMimeType()).toBe('video/mp4');
    });

    it('should handle URLs with query parameters', () => {
      mockMediaService.videoUrl.set('https://example.com/video.webm?token=abc' as unknown);
      expect(component.videoMimeType()).toBe('video/webm');
    });
  });
});
