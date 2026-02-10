import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { VideoPlayerComponent } from './video-player.component';
import { MediaPlayerService } from '../../services/media-player.service';
import { LayoutService } from '../../services/layout.service';

describe('VideoPlayerComponent', () => {
  let component: VideoPlayerComponent;
  let fixture: ComponentFixture<VideoPlayerComponent>;
  let mockMediaService: {
    current: { type: string; title: string } | undefined;
    videoWindowState: ReturnType<typeof signal>;
    youtubeUrl: ReturnType<typeof signal>;
    videoUrl: ReturnType<typeof signal>;
    minimizeWindow: jasmine.Spy;
    maximizeWindow: jasmine.Spy;
    closeVideoWindow: jasmine.Spy;
    updateWindowPosition: jasmine.Spy;
    updateWindowSize: jasmine.Spy;
  };
  let mockLayoutService: Record<string, unknown>;

  beforeEach(async () => {
    mockMediaService = {
      current: undefined,
      videoWindowState: signal({
        x: 100,
        y: 100,
        width: 560,
        height: 315,
        isMinimized: false,
        isMaximized: false,
      }),
      youtubeUrl: signal(undefined),
      videoUrl: signal(undefined),
      minimizeWindow: jasmine.createSpy('minimizeWindow'),
      maximizeWindow: jasmine.createSpy('maximizeWindow'),
      closeVideoWindow: jasmine.createSpy('closeVideoWindow'),
      updateWindowPosition: jasmine.createSpy('updateWindowPosition'),
      updateWindowSize: jasmine.createSpy('updateWindowSize'),
    };

    mockLayoutService = {};

    await TestBed.configureTestingModule({
      imports: [VideoPlayerComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MediaPlayerService, useValue: mockMediaService },
        { provide: LayoutService, useValue: mockLayoutService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VideoPlayerComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not render video window when no media is current', async () => {
    await fixture.whenStable();
    const videoWindow = fixture.nativeElement.querySelector('.video-window');
    expect(videoWindow).toBeNull();
  });

  describe('when YouTube media is playing', () => {
    beforeEach(async () => {
      mockMediaService.current = { type: 'YouTube', title: 'Test Video' };
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('should render video window', () => {
      const videoWindow = fixture.nativeElement.querySelector('.video-window');
      expect(videoWindow).toBeTruthy();
    });

    it('should display the video title', () => {
      const title = fixture.nativeElement.querySelector('.window-title span');
      expect(title?.textContent?.trim()).toBe('Test Video');
    });

    it('should apply minimized class when minimized', async () => {
      mockMediaService.videoWindowState.set({
        x: 100, y: 100, width: 560, height: 315,
        isMinimized: true, isMaximized: false,
      });
      fixture.detectChanges();
      await fixture.whenStable();
      const videoWindow = fixture.nativeElement.querySelector('.video-window');
      expect(videoWindow.classList.contains('minimized')).toBeTrue();
    });

    it('should apply maximized class when maximized', async () => {
      mockMediaService.videoWindowState.set({
        x: 100, y: 100, width: 560, height: 315,
        isMinimized: false, isMaximized: true,
      });
      fixture.detectChanges();
      await fixture.whenStable();
      const videoWindow = fixture.nativeElement.querySelector('.video-window');
      expect(videoWindow.classList.contains('maximized')).toBeTrue();
    });

    it('should apply dragging class when dragging', async () => {
      component.isDraggingState.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      const videoWindow = fixture.nativeElement.querySelector('.video-window');
      expect(videoWindow.classList.contains('dragging')).toBeTrue();
    });

    it('should apply resizing class when resizing', async () => {
      component.isResizingState.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      const videoWindow = fixture.nativeElement.querySelector('.video-window');
      expect(videoWindow.classList.contains('resizing')).toBeTrue();
    });

    it('should not apply minimized/maximized/dragging/resizing classes by default', () => {
      const videoWindow = fixture.nativeElement.querySelector('.video-window');
      expect(videoWindow.classList.contains('minimized')).toBeFalse();
      expect(videoWindow.classList.contains('maximized')).toBeFalse();
      expect(videoWindow.classList.contains('dragging')).toBeFalse();
      expect(videoWindow.classList.contains('resizing')).toBeFalse();
    });

    it('should call minimizeWindow on minimize click', () => {
      const minimizeBtn = fixture.nativeElement.querySelector('.control-button.minimize');
      minimizeBtn.click();
      expect(mockMediaService.minimizeWindow).toHaveBeenCalled();
    });

    it('should call maximizeWindow on maximize click', () => {
      const maximizeBtn = fixture.nativeElement.querySelector('.control-button.maximize');
      maximizeBtn.click();
      expect(mockMediaService.maximizeWindow).toHaveBeenCalled();
    });

    it('should call closeVideoWindow on close click', () => {
      const closeBtn = fixture.nativeElement.querySelector('.control-button.close');
      closeBtn.click();
      expect(mockMediaService.closeVideoWindow).toHaveBeenCalled();
    });
  });

  describe('when Video media is playing', () => {
    beforeEach(async () => {
      mockMediaService.current = { type: 'Video', title: 'My Video' };
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('should render video window', () => {
      const videoWindow = fixture.nativeElement.querySelector('.video-window');
      expect(videoWindow).toBeTruthy();
    });

    it('should display the video title', () => {
      const title = fixture.nativeElement.querySelector('.window-title span');
      expect(title?.textContent?.trim()).toBe('My Video');
    });
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
