import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MessageContentComponent } from './message-content.component';

@Component({
  selector: 'app-test-host',
  imports: [MessageContentComponent],
  template: `<app-message-content [content]="content" />`,
})
class TestHostComponent {
  content = '';
}

describe('MessageContentComponent', () => {
  let hostComponent: TestHostComponent;
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    hostComponent = fixture.componentInstance;
  });

  it('should create', () => {
    hostComponent.content = 'Hello';
    fixture.detectChanges();
    const messageContent = fixture.nativeElement.querySelector('app-message-content');
    expect(messageContent).toBeTruthy();
  });

  describe('video rendering', () => {
    it('should render inline video player for .mp4 URLs', () => {
      hostComponent.content = 'https://example.com/video.mp4';
      fixture.detectChanges();

      const inlinePlayer = fixture.nativeElement.querySelector('app-inline-video-player');
      const nativeVideo = fixture.nativeElement.querySelector('video');

      expect(inlinePlayer).toBeTruthy();
      expect(nativeVideo).toBeNull();
    });

    it('should render inline video player for .webm URLs', () => {
      hostComponent.content = 'https://example.com/video.webm';
      fixture.detectChanges();

      const inlinePlayer = fixture.nativeElement.querySelector('app-inline-video-player');
      expect(inlinePlayer).toBeTruthy();
    });

    it('should render inline video player for .mov URLs', () => {
      hostComponent.content = 'https://example.com/video.mov';
      fixture.detectChanges();

      const inlinePlayer = fixture.nativeElement.querySelector('app-inline-video-player');
      expect(inlinePlayer).toBeTruthy();
    });

    it('should render inline video player for .ogg URLs', () => {
      hostComponent.content = 'https://example.com/video.ogg';
      fixture.detectChanges();

      const inlinePlayer = fixture.nativeElement.querySelector('app-inline-video-player');
      expect(inlinePlayer).toBeTruthy();
    });

    it('should render video inside a container div', () => {
      hostComponent.content = 'https://example.com/video.mp4';
      fixture.detectChanges();

      const container = fixture.nativeElement.querySelector('.message-video-container');
      expect(container).toBeTruthy();

      const inlinePlayer = container.querySelector('app-inline-video-player');
      expect(inlinePlayer).toBeTruthy();
    });

    it('should not render native video element for video URLs', () => {
      hostComponent.content = 'https://example.com/video.mp4';
      fixture.detectChanges();

      const nativeVideo = fixture.nativeElement.querySelector('video.message-video');
      expect(nativeVideo).toBeNull();
    });

    it('should handle video URL with query parameters', () => {
      hostComponent.content = 'https://example.com/video.mp4?token=abc123';
      fixture.detectChanges();

      const inlinePlayer = fixture.nativeElement.querySelector('app-inline-video-player');
      expect(inlinePlayer).toBeTruthy();
    });
  });

  describe('content parsing', () => {
    it('should render text content', () => {
      hostComponent.content = 'Hello world';
      fixture.detectChanges();

      const textSpan = fixture.nativeElement.querySelector('.text-content');
      expect(textSpan?.textContent).toBe('Hello world');
    });

    it('should render images for image URLs', () => {
      hostComponent.content = 'https://example.com/image.jpg';
      fixture.detectChanges();

      const img = fixture.nativeElement.querySelector('.message-image');
      expect(img).toBeTruthy();
    });

    it('should render links for non-media URLs', () => {
      hostComponent.content = 'https://example.com/page';
      fixture.detectChanges();

      const link = fixture.nativeElement.querySelector('.message-link');
      expect(link).toBeTruthy();
      expect(link.getAttribute('href')).toBe('https://example.com/page');
    });

    it('should render mixed content with video', () => {
      hostComponent.content = 'Check this video https://example.com/clip.mp4';
      fixture.detectChanges();

      const textSpan = fixture.nativeElement.querySelector('.text-content');
      expect(textSpan?.textContent).toContain('Check this video');

      const inlinePlayer = fixture.nativeElement.querySelector('app-inline-video-player');
      expect(inlinePlayer).toBeTruthy();
    });

    it('should render image and trailing text when URL is followed by blank line', () => {
      hostComponent.content = 'https://example.com/image.webp\n\nHello after image';
      fixture.detectChanges();

      const image = fixture.nativeElement.querySelector('.message-image');
      expect(image).toBeTruthy();

      const textNodes = Array.from(fixture.nativeElement.querySelectorAll('.text-content')) as HTMLElement[];
      const hasTrailingText = textNodes.some(node => node.textContent?.includes('Hello after image'));
      expect(hasTrailingText).toBeTrue();
    });
  });
});
