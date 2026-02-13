import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MediaPreviewDialogComponent } from './media-preview.component';

describe('MediaPreviewDialogComponent', () => {
  let component: MediaPreviewDialogComponent;
  let fixture: ComponentFixture<MediaPreviewDialogComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<MediaPreviewDialogComponent>>;

  function createComponent(data: Record<string, unknown> = {}) {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    TestBed.configureTestingModule({
      imports: [MediaPreviewDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });

    fixture = TestBed.createComponent(MediaPreviewDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
  });

  it('should create', () => {
    createComponent({ mediaUrl: 'https://example.com/image.jpg', mediaType: 'image' });
    expect(component).toBeTruthy();
  });

  it('should push a history state when opened', () => {
    const pushStateSpy = spyOn(window.history, 'pushState');

    createComponent({ mediaUrl: 'https://example.com/image.jpg', mediaType: 'image' });

    expect(pushStateSpy).toHaveBeenCalled();
  });

  it('should close on popstate (mobile back gesture)', () => {
    createComponent({ mediaUrl: 'https://example.com/image.jpg', mediaType: 'image' });
    mockDialogRef.close.calls.reset();

    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(mockDialogRef.close).toHaveBeenCalled();
  });

  describe('keyboard navigation via host binding', () => {
    const multiMediaData = {
      mediaItems: [
        { url: 'https://example.com/1.jpg', type: 'image' },
        { url: 'https://example.com/2.jpg', type: 'image' },
        { url: 'https://example.com/3.jpg', type: 'image' },
      ],
      initialIndex: 1,
    };

    it('should navigate to previous item on ArrowLeft', () => {
      createComponent(multiMediaData);
      expect(component.currentIndex()).toBe(1);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(component.currentIndex()).toBe(0);
    });

    it('should navigate to next item on ArrowRight', () => {
      createComponent(multiMediaData);
      expect(component.currentIndex()).toBe(1);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(component.currentIndex()).toBe(2);
    });

    it('should close dialog on Escape', () => {
      createComponent(multiMediaData);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(mockDialogRef.close).toHaveBeenCalled();
    });

    it('should not navigate past the first item on ArrowLeft', () => {
      createComponent({
        mediaItems: [
          { url: 'https://example.com/1.jpg', type: 'image' },
          { url: 'https://example.com/2.jpg', type: 'image' },
        ],
        initialIndex: 0,
      });
      expect(component.currentIndex()).toBe(0);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(component.currentIndex()).toBe(0);
    });

    it('should not navigate past the last item on ArrowRight', () => {
      createComponent({
        mediaItems: [
          { url: 'https://example.com/1.jpg', type: 'image' },
          { url: 'https://example.com/2.jpg', type: 'image' },
        ],
        initialIndex: 1,
      });
      expect(component.currentIndex()).toBe(1);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(component.currentIndex()).toBe(1);
    });

    it('should ignore keyboard events when there is only one media item', () => {
      createComponent({
        mediaUrl: 'https://example.com/single.jpg',
        mediaType: 'image',
      });
      expect(component.currentIndex()).toBe(0);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(component.currentIndex()).toBe(0);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(component.currentIndex()).toBe(0);
    });

    it('should ignore unrelated keys', () => {
      createComponent(multiMediaData);
      expect(component.currentIndex()).toBe(1);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(component.currentIndex()).toBe(1);
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });
});
