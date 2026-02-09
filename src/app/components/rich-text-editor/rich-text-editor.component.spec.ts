import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RichTextEditorComponent } from './rich-text-editor.component';
import { MediaService } from '../../services/media.service';
import { LocalSettingsService } from '../../services/local-settings.service';

describe('RichTextEditorComponent', () => {
  let component: RichTextEditorComponent;
  let fixture: ComponentFixture<RichTextEditorComponent>;

  const mockMediaService = {
    load: jasmine.createSpy('load').and.returnValue(Promise.resolve()),
    uploadFile: jasmine.createSpy('uploadFile').and.returnValue(
      Promise.resolve({ status: 'success', item: { url: 'https://example.com/img.png' } })
    ),
    mediaServers: jasmine.createSpy('mediaServers').and.returnValue([]),
  };

  const mockLocalSettingsService = {
    removeTrackingParameters: jasmine.createSpy('removeTrackingParameters').and.returnValue(false),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RichTextEditorComponent, NoopAnimationsModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MediaService, useValue: mockMediaService },
        { provide: LocalSettingsService, useValue: mockLocalSettingsService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RichTextEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('signal inputs', () => {
    it('should have default content as empty string', () => {
      expect(component.content()).toBe('');
    });

    it('should have default richTextMode as true', () => {
      expect(component.richTextMode()).toBe(true);
    });

    it('should accept content input', async () => {
      fixture.componentRef.setInput('content', '# Hello');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.content()).toBe('# Hello');
    });

    it('should accept richTextMode input', async () => {
      fixture.componentRef.setInput('richTextMode', false);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.richTextMode()).toBe(false);
    });

    it('should sync richTextMode input to isRichTextMode signal', async () => {
      fixture.componentRef.setInput('richTextMode', false);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.isRichTextMode()).toBe(false);

      fixture.componentRef.setInput('richTextMode', true);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.isRichTextMode()).toBe(true);
    });
  });

  describe('signal outputs', () => {
    it('should emit contentChange on markdown content change', () => {
      const emitted: string[] = [];
      component.contentChange.subscribe(value => emitted.push(value));

      // Switch to markdown mode to test textarea input
      component.isRichTextMode.set(false);
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('.markdown-content');
      if (textarea) {
        textarea.value = 'New content';
        textarea.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        expect(emitted.length).toBe(1);
        expect(emitted[0]).toBe('New content');
      }
    });

    it('should emit richTextModeChange when toggling editor mode', () => {
      const emitted: boolean[] = [];
      component.richTextModeChange.subscribe(value => emitted.push(value));

      // Start in rich text mode (default), toggle to markdown
      component.toggleEditorMode();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0]).toBe(false);

      // Toggle back to rich text
      component.toggleEditorMode();
      fixture.detectChanges();

      expect(emitted.length).toBe(2);
      expect(emitted[1]).toBe(true);
    });
  });

  describe('setContent', () => {
    it('should update markdownContent signal', () => {
      component.setContent('# Test');
      expect(component.markdownContent()).toBe('# Test');
    });

    it('should handle empty content', () => {
      component.setContent('');
      expect(component.markdownContent()).toBe('');
    });
  });

  describe('editor mode', () => {
    it('should start in rich text mode by default', () => {
      expect(component.isRichTextMode()).toBe(true);
    });

    it('should toggle between modes', () => {
      expect(component.isRichTextMode()).toBe(true);

      component.toggleEditorMode();
      expect(component.isRichTextMode()).toBe(false);

      component.toggleEditorMode();
      expect(component.isRichTextMode()).toBe(true);
    });

    it('should show rich text editor when in rich text mode', () => {
      component.isRichTextMode.set(true);
      fixture.detectChanges();

      const richTextContent = fixture.nativeElement.querySelector('.rich-text-content');
      const markdownContent = fixture.nativeElement.querySelector('.markdown-content');
      expect(richTextContent).toBeTruthy();
      expect(markdownContent).toBeFalsy();
    });

    it('should show markdown textarea when in markdown mode', () => {
      component.isRichTextMode.set(false);
      fixture.detectChanges();

      const richTextContent = fixture.nativeElement.querySelector('.rich-text-content');
      const markdownContent = fixture.nativeElement.querySelector('.markdown-content');
      expect(richTextContent).toBeFalsy();
      expect(markdownContent).toBeTruthy();
    });
  });

  describe('drag and drop state', () => {
    it('should set isDragOver on drag enter', () => {
      expect(component.isDragOver()).toBe(false);

      const event = new DragEvent('dragenter', { bubbles: true, cancelable: true });
      component.onDragEnter(event);

      expect(component.isDragOver()).toBe(true);
    });

    it('should clear isDragOver on drag leave', () => {
      // Simulate enter then leave
      const enterEvent = new DragEvent('dragenter', { bubbles: true, cancelable: true });
      component.onDragEnter(enterEvent);
      expect(component.isDragOver()).toBe(true);

      const leaveEvent = new DragEvent('dragleave', { bubbles: true, cancelable: true });
      component.onDragLeave(leaveEvent);
      expect(component.isDragOver()).toBe(false);
    });

    it('should handle nested drag enter/leave correctly', () => {
      const enterEvent = new DragEvent('dragenter', { bubbles: true, cancelable: true });
      const leaveEvent = new DragEvent('dragleave', { bubbles: true, cancelable: true });

      // Enter outer element
      component.onDragEnter(enterEvent);
      expect(component.isDragOver()).toBe(true);

      // Enter inner element (nested)
      component.onDragEnter(enterEvent);
      expect(component.isDragOver()).toBe(true);

      // Leave inner element
      component.onDragLeave(leaveEvent);
      expect(component.isDragOver()).toBe(true);

      // Leave outer element
      component.onDragLeave(leaveEvent);
      expect(component.isDragOver()).toBe(false);
    });
  });
});
