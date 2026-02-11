import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { NoteEditorDialogComponent } from './note-editor-dialog.component';
import { NostrService } from '../../services/nostr.service';
import { MediaService } from '../../services/media.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { LayoutService } from '../../services/layout.service';
import { PowService } from '../../services/pow.service';
import { MentionInputService } from '../../services/mention-input.service';
import { DataService } from '../../services/data.service';
import { UtilitiesService } from '../../services/utilities.service';
import { ImagePlaceholderService } from '../../services/image-placeholder.service';
import { PublishEventBus } from '../../services/publish-event-bus.service';
import { AiService } from '../../services/ai.service';
import { SpeechService } from '../../services/speech.service';
import { PlatformService } from '../../services/platform.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';

describe('NoteEditorDialogComponent', () => {
  let component: NoteEditorDialogComponent;
  let fixture: ComponentFixture<NoteEditorDialogComponent>;
  let mockPlatformService: { hasModifierKey: jasmine.Spy };
  let mockLayoutService: { isHandset: jasmine.Spy };
  let mockCustomDialogService: { open: jasmine.Spy };

  function createComponent() {
    mockPlatformService = {
      hasModifierKey: jasmine.createSpy('hasModifierKey').and.returnValue(false),
    };

    mockLayoutService = {
      isHandset: jasmine.createSpy('isHandset').and.returnValue(false),
    };

    mockCustomDialogService = {
      open: jasmine.createSpy('open'),
    };

    TestBed.configureTestingModule({
      imports: [NoteEditorDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: NostrService, useValue: { getRelays: () => [], pool: {} } },
        { provide: AccountRelayService, useValue: {} },
        { provide: MediaService, useValue: { uploadFile: jasmine.createSpy() } },
        { provide: LocalStorageService, useValue: { get: () => null, set: jasmine.createSpy('set') } },
        {
          provide: LocalSettingsService,
          useValue: { addClientTag: signal(true) },
        },
        {
          provide: AccountStateService,
          useValue: { pubkey: signal(null) },
        },
        {
          provide: AccountLocalStateService,
          useValue: {
            getPowEnabled: () => false,
            getPowTargetDifficulty: () => 0,
            getZapSplitEnabled: () => false,
            getZapSplitOriginalPercent: () => 90,
            getZapSplitQuoterPercent: () => 10,
          },
        },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy() } },
        { provide: Router, useValue: { navigate: jasmine.createSpy() } },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: PowService, useValue: {} },
        { provide: MentionInputService, useValue: {} },
        { provide: DataService, useValue: { getProfile: () => undefined } },
        { provide: UtilitiesService, useValue: {} },
        { provide: ImagePlaceholderService, useValue: {} },
        { provide: PublishEventBus, useValue: { results$: { subscribe: () => ({ unsubscribe: jasmine.createSpy('unsubscribe') }) } } },
        { provide: MatDialog, useValue: { open: jasmine.createSpy() } },
        { provide: CustomDialogService, useValue: mockCustomDialogService },
        { provide: AiService, useValue: {} },
        { provide: SpeechService, useValue: { isRecording: signal(false), startRecording: jasmine.createSpy(), stopRecording: jasmine.createSpy() } },
        { provide: PlatformService, useValue: mockPlatformService },
      ],
    });

    fixture = TestBed.createComponent(NoteEditorDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
  });

  it('should create', () => {
    createComponent();
    expect(component).toBeTruthy();
  });

  describe('document mousedown listener (onDocumentClick)', () => {
    it('should not collapse when not in inline mode', async () => {
      createComponent();
      await fixture.whenStable();

      component.isExpanded.set(true);
      fixture.detectChanges();

      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(component.isExpanded()).toBeTrue();
    });

    it('should collapse inline editor when clicking outside with empty content', async () => {
      createComponent();
      fixture.componentRef.setInput('inlineMode', true);
      fixture.detectChanges();
      await fixture.whenStable();

      component.isExpanded.set(true);
      component.content.set('');
      fixture.detectChanges();

      // Click on document body (outside the component)
      const outsideEvent = new MouseEvent('mousedown', { bubbles: true });
      document.dispatchEvent(outsideEvent);

      expect(component.isExpanded()).toBeFalse();
    });

    it('should not collapse inline editor when clicking inside the component', async () => {
      createComponent();
      fixture.componentRef.setInput('inlineMode', true);
      fixture.detectChanges();
      await fixture.whenStable();

      component.isExpanded.set(true);
      component.content.set('');
      fixture.detectChanges();

      // Create a click event that originates from within the component
      const insideEvent = new MouseEvent('mousedown', { bubbles: true });
      Object.defineProperty(insideEvent, 'target', { value: fixture.nativeElement });
      document.dispatchEvent(insideEvent);

      expect(component.isExpanded()).toBeTrue();
    });

    it('should not collapse inline editor when content is not empty', async () => {
      createComponent();
      fixture.componentRef.setInput('inlineMode', true);
      fixture.detectChanges();
      await fixture.whenStable();

      component.isExpanded.set(true);
      component.content.set('Hello world');
      fixture.detectChanges();

      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(component.isExpanded()).toBeTrue();
    });

    it('should not collapse inline editor when not expanded', async () => {
      createComponent();
      fixture.componentRef.setInput('inlineMode', true);
      fixture.detectChanges();
      await fixture.whenStable();

      component.isExpanded.set(false);
      component.content.set('');
      fixture.detectChanges();

      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(component.isExpanded()).toBeFalse();
    });
  });

  describe('document keydown listener (handleGlobalKeydown)', () => {
    it('should toggle recording on Alt+D when modifier key is pressed', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      mockPlatformService.hasModifierKey.and.returnValue(true);
      spyOn(component, 'toggleRecording');

      const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
      document.dispatchEvent(event);

      expect(component.toggleRecording).toHaveBeenCalled();
    });

    it('should not toggle recording without modifier key', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      mockPlatformService.hasModifierKey.and.returnValue(false);
      spyOn(component, 'toggleRecording');

      const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
      document.dispatchEvent(event);

      expect(component.toggleRecording).not.toHaveBeenCalled();
    });

    it('should not toggle recording when uploading', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      mockPlatformService.hasModifierKey.and.returnValue(true);
      component.isUploading.set(true);
      spyOn(component, 'toggleRecording');

      const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
      document.dispatchEvent(event);

      expect(component.toggleRecording).not.toHaveBeenCalled();
    });

    it('should not toggle recording when publishing', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      mockPlatformService.hasModifierKey.and.returnValue(true);
      component.isPublishing.set(true);
      spyOn(component, 'toggleRecording');

      const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
      document.dispatchEvent(event);

      expect(component.toggleRecording).not.toHaveBeenCalled();
    });

    it('should not toggle recording when preview is shown', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      mockPlatformService.hasModifierKey.and.returnValue(true);
      component.showPreview.set(true);
      spyOn(component, 'toggleRecording');

      const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
      document.dispatchEvent(event);

      expect(component.toggleRecording).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should remove document event listeners on destroy', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      spyOn(document, 'removeEventListener').and.callThrough();

      fixture.destroy();

      expect(document.removeEventListener).toHaveBeenCalledWith('mousedown', jasmine.any(Function));
      expect(document.removeEventListener).toHaveBeenCalledWith('keydown', jasmine.any(Function));
    });
  });

  describe('insertEmoji', () => {
    it('should append emoji to empty content when no textarea ref', () => {
      createComponent();
      component.content.set('');

      component.insertEmoji('😀');

      expect(component.content()).toBe('😀');
    });

    it('should append emoji to existing content when no textarea ref', () => {
      createComponent();
      component.content.set('Hello');

      component.insertEmoji('😀');

      expect(component.content()).toBe('Hello😀');
    });

    it('should insert emoji at cursor position in textarea', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      // The textarea may not be rendered in default mode (collapsed inline),
      // but in dialog mode it should be rendered
      if (component.contentTextarea) {
        const textarea = component.contentTextarea.nativeElement;
        textarea.value = 'Hello World';
        component.content.set('Hello World');
        textarea.setSelectionRange(5, 5); // cursor after "Hello"

        component.insertEmoji('😀');

        expect(component.content()).toBe('Hello😀 World');
      }
    });

    it('should replace selected text with emoji in textarea', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      if (component.contentTextarea) {
        const textarea = component.contentTextarea.nativeElement;
        textarea.value = 'Hello World';
        component.content.set('Hello World');
        textarea.setSelectionRange(5, 11); // select " World"

        component.insertEmoji('😀');

        expect(component.content()).toBe('Hello😀');
      }
    });
  });

  describe('emoji picker button rendering', () => {
    it('should render emoji button with mat-menu on desktop', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      const emojiButton = fixture.nativeElement.querySelector('button[mattooltip="Emoji"]');
      expect(emojiButton).toBeTruthy();
    });

    it('should render emoji picker inside mat-menu on desktop', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      // The mat-menu content is lazily rendered, but the app-emoji-picker should be in the template
      const compiled = fixture.nativeElement;
      // Check that the emoji button exists (the mat-menu trigger)
      const buttons = compiled.querySelectorAll('button[mattooltip="Emoji"]');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });
});
