import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { VideoControlsComponent } from './video-controls.component';
import { UtilitiesService } from '../../services/utilities.service';

describe('VideoControlsComponent', () => {
  let component: VideoControlsComponent;
  let fixture: ComponentFixture<VideoControlsComponent>;

  function createComponent() {
    TestBed.configureTestingModule({
      imports: [VideoControlsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: UtilitiesService, useValue: {} },
      ],
    });

    fixture = TestBed.createComponent(VideoControlsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function createKeyboardEvent(key: string, options: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, bubbles: true, ...options });
  }

  function createMockVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { value: overrides.duration ?? 100, writable: true });
    Object.defineProperty(video, 'currentTime', { value: overrides.currentTime ?? 50, writable: true });
    return video;
  }

  function focusControlsHost(): void {
    const host = fixture.nativeElement as HTMLElement;
    host.focus();
  }

  beforeEach(() => {
    createComponent();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('document:keydown handler', () => {
    it('should not handle keys when no video element is set', () => {
      spyOn(component.playPause, 'emit');
      document.dispatchEvent(createKeyboardEvent(' '));
      expect(component.playPause.emit).not.toHaveBeenCalled();
    });

    it('should emit playPause on Space key', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();
      focusControlsHost();

      spyOn(component.playPause, 'emit');
      document.dispatchEvent(createKeyboardEvent(' '));
      expect(component.playPause.emit).toHaveBeenCalled();
    });

    it('should emit playPause on k key', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();
      focusControlsHost();

      spyOn(component.playPause, 'emit');
      document.dispatchEvent(createKeyboardEvent('k'));
      expect(component.playPause.emit).toHaveBeenCalled();
    });

    it('should emit seek on ArrowLeft key (seek back 5s)', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();
      focusControlsHost();

      spyOn(component.seek, 'emit');
      document.dispatchEvent(createKeyboardEvent('ArrowLeft'));
      expect(component.seek.emit).toHaveBeenCalledWith(45);
    });

    it('should emit seek on ArrowRight key (seek forward 5s)', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();
      focusControlsHost();

      spyOn(component.seek, 'emit');
      document.dispatchEvent(createKeyboardEvent('ArrowRight'));
      expect(component.seek.emit).toHaveBeenCalledWith(55);
    });

    it('should emit volumeChange on ArrowUp key', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();
      focusControlsHost();

      spyOn(component.volumeChange, 'emit');
      document.dispatchEvent(createKeyboardEvent('ArrowUp'));
      expect(component.volumeChange.emit).toHaveBeenCalled();
    });

    it('should emit volumeChange on ArrowDown key', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();
      focusControlsHost();

      spyOn(component.volumeChange, 'emit');
      document.dispatchEvent(createKeyboardEvent('ArrowDown'));
      expect(component.volumeChange.emit).toHaveBeenCalled();
    });

    it('should emit muteToggle on m key', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();
      focusControlsHost();

      spyOn(component.muteToggle, 'emit');
      document.dispatchEvent(createKeyboardEvent('m'));
      expect(component.muteToggle.emit).toHaveBeenCalled();
    });

    it('should emit fullscreenToggle on f key', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();
      focusControlsHost();

      spyOn(component.fullscreenToggle, 'emit');
      document.dispatchEvent(createKeyboardEvent('f'));
      expect(component.fullscreenToggle.emit).toHaveBeenCalled();
    });

    it('should ignore keys when focus is outside video controls context', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();

      const outsideButton = document.createElement('button');
      document.body.appendChild(outsideButton);
      outsideButton.focus();

      spyOn(component.fullscreenToggle, 'emit');
      document.dispatchEvent(createKeyboardEvent('f'));
      expect(component.fullscreenToggle.emit).not.toHaveBeenCalled();

      document.body.removeChild(outsideButton);
    });

    it('should ignore keys with ctrlKey modifier', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();

      spyOn(component.playPause, 'emit');
      document.dispatchEvent(createKeyboardEvent(' ', { ctrlKey: true }));
      expect(component.playPause.emit).not.toHaveBeenCalled();
    });

    it('should ignore keys with altKey modifier', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();

      spyOn(component.playPause, 'emit');
      document.dispatchEvent(createKeyboardEvent(' ', { altKey: true }));
      expect(component.playPause.emit).not.toHaveBeenCalled();
    });

    it('should ignore keys with metaKey modifier', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();

      spyOn(component.playPause, 'emit');
      document.dispatchEvent(createKeyboardEvent(' ', { metaKey: true }));
      expect(component.playPause.emit).not.toHaveBeenCalled();
    });

    it('should ignore keys when an input element is focused', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      spyOn(component.playPause, 'emit');
      document.dispatchEvent(createKeyboardEvent(' '));
      expect(component.playPause.emit).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('should ignore keys when a textarea element is focused', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();

      spyOn(component.playPause, 'emit');
      document.dispatchEvent(createKeyboardEvent(' '));
      expect(component.playPause.emit).not.toHaveBeenCalled();

      document.body.removeChild(textarea);
    });

    it('should stop handling keys after component is destroyed', async () => {
      fixture.componentRef.setInput('videoElement', createMockVideo());
      await fixture.whenStable();

      spyOn(component.playPause, 'emit');
      fixture.destroy();
      document.dispatchEvent(createKeyboardEvent(' '));
      expect(component.playPause.emit).not.toHaveBeenCalled();
    });
  });
});
