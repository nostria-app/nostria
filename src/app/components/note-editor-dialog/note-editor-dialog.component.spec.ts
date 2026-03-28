import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { nip19 } from 'nostr-tools';
import type { Event as NostrEvent } from 'nostr-tools';
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
import { XDualPostService } from '../../services/x-dual-post.service';

describe('NoteEditorDialogComponent', () => {
  let component: NoteEditorDialogComponent;
  let fixture: ComponentFixture<NoteEditorDialogComponent>;
  let mockPlatformService: {
    hasModifierKey: Mock;
  };
  let mockLayoutService: {
    isHandset: Mock;
  };
  let mockCustomDialogService: {
    open: Mock;
  };
  let mockAiService: {
    analyzeSentiment: Mock;
    loadModel: Mock;
    sentimentModelLoaded: Mock;
    sentimentModelId: string;
  };
  let mockXDualPostService: {
    status: ReturnType<typeof signal>;
    loading: ReturnType<typeof signal>;
    loaded: ReturnType<typeof signal>;
    connecting: ReturnType<typeof signal>;
    ensureStatusLoaded: Mock;
    connect: Mock;
  };
  let mockUtilitiesService: {
    normalizeRelayUrls: Mock;
    isParameterizedReplaceableEvent: Mock;
  };
  let mockAccountRelayService: {
    getRelayUrls: Mock;
  };

  function createComponent(beforeDetectChanges?: (instance: NoteEditorDialogComponent) => void) {
    mockPlatformService = {
      hasModifierKey: vi.fn().mockReturnValue(false),
    };

    mockLayoutService = {
      isHandset: vi.fn().mockReturnValue(false),
    };

    mockCustomDialogService = {
      open: vi.fn(),
    };

    mockAiService = {
      analyzeSentiment: vi.fn().mockResolvedValue([{ label: 'POSITIVE', score: 0.99 }]),
      loadModel: vi.fn().mockResolvedValue(undefined),
      sentimentModelLoaded: vi.fn().mockReturnValue(false),
      sentimentModelId: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    };

    mockXDualPostService = {
      status: signal({ connected: false, totalPosts: 0, postsLast24h: 0 }),
      loading: signal(false),
      loaded: signal(false),
      connecting: signal(false),
      ensureStatusLoaded: vi.fn(),
      connect: vi.fn(),
    };

    mockUtilitiesService = {
      normalizeRelayUrls: vi.fn((relays: string[]) => relays),
      isParameterizedReplaceableEvent: vi.fn((kind: number) => kind >= 30000 && kind < 40000),
    };

    mockAccountRelayService = {
      getRelayUrls: vi.fn(() => []),
    };

    TestBed.configureTestingModule({
      imports: [NoteEditorDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: NostrService, useValue: { getRelays: () => [], pool: {} } },
        { provide: AccountRelayService, useValue: mockAccountRelayService },
        { provide: MediaService, useValue: { uploadFile: vi.fn() } },
        { provide: LocalStorageService, useValue: { get: () => null, set: vi.fn() } },
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
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: PowService, useValue: {} },
        { provide: MentionInputService, useValue: {} },
        { provide: DataService, useValue: { getProfile: () => undefined } },
        { provide: UtilitiesService, useValue: mockUtilitiesService },
        { provide: ImagePlaceholderService, useValue: {} },
        { provide: PublishEventBus, useValue: { results$: { subscribe: () => ({ unsubscribe: vi.fn() }) } } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: CustomDialogService, useValue: mockCustomDialogService },
        { provide: XDualPostService, useValue: mockXDualPostService },
        { provide: AiService, useValue: mockAiService },
        { provide: SpeechService, useValue: { isRecording: signal(false), startRecording: vi.fn(), stopRecording: vi.fn() } },
        { provide: PlatformService, useValue: mockPlatformService },
      ],
    });

    fixture = TestBed.createComponent(NoteEditorDialogComponent);
    component = fixture.componentInstance;
    if (beforeDetectChanges) {
      beforeDetectChanges(component);
    }
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
  });

  it('should create', () => {
    createComponent();
    expect(component).toBeTruthy();
  });

  describe('reply preview', () => {
    it('should show the replied note content and short id', async () => {
      const replyEvent: NostrEvent = {
        id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        pubkey: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [],
        content: 'Original reply content that should be visible in the composer preview.',
        sig: 'f'.repeat(128),
      };

      createComponent(instance => {
        instance.data = {
          replyTo: {
            id: replyEvent.id,
            pubkey: replyEvent.pubkey,
            event: replyEvent,
          },
        };
      });
      await fixture.whenStable();
      fixture.detectChanges();

      const preview = fixture.nativeElement.querySelector('.reply-preview-content');
      const noteId = fixture.nativeElement.querySelector('.reply-note-id');

      expect(preview?.textContent).toContain('Original reply content that should be visible in the composer preview.');
      expect(noteId?.textContent.trim()).toBe('01234567…');
    });
  });

  describe('Post to X status loading', () => {
    it('should not load X status when the editor opens with Post to X disabled by default', async () => {
      createComponent();
      await fixture.whenStable();

      expect(mockXDualPostService.ensureStatusLoaded).not.toHaveBeenCalled();
    });

    it('should load X status when Post to X is enabled by the user', async () => {
      createComponent();
      await fixture.whenStable();

      component.onPostToXChange(true);

      expect(mockXDualPostService.ensureStatusLoaded).toHaveBeenCalledTimes(1);
      expect(component.postToX()).toBe(true);
    });
  });

  describe('document mousedown listener (onDocumentClick)', () => {
    it('should not collapse when not in inline mode', async () => {
      createComponent();
      await fixture.whenStable();

      component.isExpanded.set(true);
      fixture.detectChanges();

      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(component.isExpanded()).toBe(true);
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

      expect(component.isExpanded()).toBe(false);
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

      expect(component.isExpanded()).toBe(true);
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
      expect(component.isExpanded()).toBe(true);
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
      expect(component.isExpanded()).toBe(false);
    });
  });

  describe('document keydown listener (handleGlobalKeydown)', () => {
    it('should toggle recording on Alt+D when modifier key is pressed', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      mockPlatformService.hasModifierKey.mockReturnValue(true);
      vi.spyOn(component, 'toggleRecording');

      const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
      document.dispatchEvent(event);

      expect(component.toggleRecording).toHaveBeenCalled();
    });

    it('should not toggle recording without modifier key', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      mockPlatformService.hasModifierKey.mockReturnValue(false);
      vi.spyOn(component, 'toggleRecording');

      const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
      document.dispatchEvent(event);

      expect(component.toggleRecording).not.toHaveBeenCalled();
    });

    it('should not toggle recording when uploading', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      mockPlatformService.hasModifierKey.mockReturnValue(true);
      component.isUploading.set(true);
      vi.spyOn(component, 'toggleRecording');

      const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
      document.dispatchEvent(event);

      expect(component.toggleRecording).not.toHaveBeenCalled();
    });

    it('should not toggle recording when publishing', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      mockPlatformService.hasModifierKey.mockReturnValue(true);
      component.isPublishing.set(true);
      vi.spyOn(component, 'toggleRecording');

      const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
      document.dispatchEvent(event);

      expect(component.toggleRecording).not.toHaveBeenCalled();
    });

    it('should not toggle recording when preview is shown', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      mockPlatformService.hasModifierKey.mockReturnValue(true);
      component.showPreview.set(true);
      vi.spyOn(component, 'toggleRecording');

      const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
      document.dispatchEvent(event);

      expect(component.toggleRecording).not.toHaveBeenCalled();
    });
  });

  describe('selection handling', () => {
    it('should dismiss mention autocomplete when text is selected', () => {
      createComponent();
      const dismissSpy = vi.spyOn(component, 'onMentionDismissed');

      component.onContentSelectionChange({
        target: {
          selectionStart: 2,
          selectionEnd: 5,
        },
      } as unknown as Event);

      expect(dismissSpy).toHaveBeenCalled();
    });

    it('should keep mention detection active when the cursor is collapsed', () => {
      createComponent();
      component.content.set('hello @so');
      const handleMentionInputSpy = vi.spyOn(component as never, 'handleMentionInput' as never);

      component.onContentSelectionChange({
        target: {
          selectionStart: 9,
          selectionEnd: 9,
        },
      } as unknown as Event);

      expect(handleMentionInputSpy).toHaveBeenCalledWith('hello @so', 9);
    });
  });

  describe('textarea scrolling', () => {
    it('should keep the editor scrolled to the bottom while typing at the end', async () => {
      createComponent();
      await fixture.whenStable();

      const textarea = component.contentTextarea.nativeElement;
      const wrapper = component.dialogContentWrapper?.nativeElement;

      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 640 });
      Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 });
      textarea.scrollTop = 120;

      if (wrapper) {
        Object.defineProperty(wrapper, 'scrollHeight', { configurable: true, value: 900 });
        Object.defineProperty(wrapper, 'clientHeight', { configurable: true, value: 300 });
        wrapper.scrollTop = 600;
      }

      textarea.focus();
      textarea.value = 'hello world';
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);

      component.onContentInput({ target: textarea } as unknown as Event);

      await new Promise(resolve => requestAnimationFrame(resolve));

      expect(textarea.scrollTop).toBe(640);
      if (wrapper) {
        expect(wrapper.scrollTop).toBe(900);
      }
    });

    it('should preserve textarea scroll when editing older text', async () => {
      createComponent();
      await fixture.whenStable();

      const textarea = component.contentTextarea.nativeElement;

      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 640 });
      Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 200 });
      textarea.scrollTop = 120;

      textarea.focus();
      textarea.value = 'hello world';
      textarea.setSelectionRange(5, 5);

      component.onContentInput({ target: textarea } as unknown as Event);

      await new Promise(resolve => requestAnimationFrame(resolve));

      expect(textarea.scrollTop).toBe(120);
    });
  });

  describe('cleanup', () => {
    it('should remove document event listeners on destroy', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      vi.spyOn(document, 'removeEventListener');

      fixture.destroy();

      expect(document.removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
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

  describe('composer add menu rendering', () => {
    it('should render the plus button on desktop', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      const plusButton = fixture.nativeElement.querySelector('button[mattooltip="Add to post"]');
      expect(plusButton).toBeTruthy();
    });

    it('should include emoji and GIF actions in the add menu', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      const compiled = fixture.nativeElement;
      expect(compiled.textContent).toContain('Emoji');
      expect(compiled.textContent).toContain('GIFs');
    });
  });

  describe('advanced options visibility', () => {
    it('should render the advanced options trigger by default', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      const advancedTrigger = fixture.nativeElement.querySelector('button[mattooltip="Advanced options"]');
      const advancedOptions = fixture.nativeElement.querySelector('.advanced-options-section');
      expect(advancedTrigger).toBeTruthy();
      expect(advancedOptions).toBeFalsy();
    });

  });

  describe('inline sentiment analysis', () => {
    it('should show sentiment result in the dialog header after analysis', async () => {
      createComponent();
      component.content.set('This is great');

      await component.analyzeSentimentInline();
      fixture.detectChanges();

      const sentimentStatus = fixture.nativeElement.querySelector('.sentiment-status');
      expect(mockAiService.loadModel).toHaveBeenCalledWith('sentiment-analysis', mockAiService.sentimentModelId);
      expect(mockAiService.analyzeSentiment).toHaveBeenCalledWith('This is great');
      expect(sentimentStatus?.textContent).toContain('Positive 99%');
    });
  });

  describe('quote references', () => {
    it('should insert nostr:naddr for parameterized replaceable quote events', async () => {
      const quotePubkey = 'a'.repeat(64);
      const quoteIdentifier = 'track-123';
      const quoteKind = 36787;

      createComponent(instance => {
        instance.data = {
          quote: {
            id: 'b'.repeat(64),
            pubkey: quotePubkey,
            kind: quoteKind,
            identifier: quoteIdentifier,
            relays: ['wss://relay.example'],
          },
        };
      });

      await fixture.whenStable();

      const match = component.content().match(/nostr:(naddr1[a-zA-Z0-9]+)/);
      expect(match).toBeTruthy();

      const decoded = nip19.decode(match![1]);
      expect(decoded.type).toBe('naddr');

      if (decoded.type === 'naddr') {
        expect(decoded.data.kind).toBe(quoteKind);
        expect(decoded.data.pubkey).toBe(quotePubkey);
        expect(decoded.data.identifier).toBe(quoteIdentifier);
      }
    });
  });
});
