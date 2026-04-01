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
import { MediaProcessingService } from '../../services/media-processing.service';
import { SettingsService } from '../../services/settings.service';
import { OPTIMIZED_MEDIA_COMPRESSION_STRENGTH } from '../../interfaces/media-upload';

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
  let mockMediaService: {
    uploadFile: Mock;
    load: Mock;
    mediaServers: Mock;
    getFileMimeType: Mock;
    error: ReturnType<typeof signal>;
    clearError: Mock;
  };
  let mockMediaProcessingService: {
    prepareFileForUpload: Mock;
  };
  let mockMatDialog: {
    open: Mock;
  };
  let mockSnackBar: {
    open: Mock;
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

    mockMediaService = {
      uploadFile: vi.fn(),
      load: vi.fn().mockResolvedValue(undefined),
      mediaServers: vi.fn(() => ['https://media.example']),
      getFileMimeType: vi.fn((file: File) => file.type),
      error: signal(''),
      clearError: vi.fn(),
    };

    mockMediaProcessingService = {
      prepareFileForUpload: vi.fn(async (file: File) => ({
        file,
        uploadOriginal: false,
        wasProcessed: false,
      })),
    };

    mockMatDialog = {
      open: vi.fn(),
    };

    mockSnackBar = {
      open: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [NoteEditorDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: NostrService, useValue: { getRelays: () => [], pool: {} } },
        { provide: AccountRelayService, useValue: mockAccountRelayService },
        { provide: MediaService, useValue: mockMediaService },
        { provide: MediaProcessingService, useValue: mockMediaProcessingService },
        { provide: LocalStorageService, useValue: { get: () => null, set: vi.fn() } },
        {
          provide: LocalSettingsService,
          useValue: { addClientTag: signal(true), removeTrackingParameters: signal(false) },
        },
        {
          provide: AccountStateService,
          useValue: { pubkey: signal(null), subscription: signal(null), profile: signal(null) },
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
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: PowService, useValue: {} },
        { provide: MentionInputService, useValue: {} },
        { provide: DataService, useValue: { getProfile: () => undefined } },
        { provide: UtilitiesService, useValue: mockUtilitiesService },
        { provide: ImagePlaceholderService, useValue: {} },
        { provide: PublishEventBus, useValue: { results$: { subscribe: () => ({ unsubscribe: vi.fn() }) } } },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: CustomDialogService, useValue: mockCustomDialogService },
        { provide: XDualPostService, useValue: mockXDualPostService },
        { provide: AiService, useValue: mockAiService },
        { provide: SpeechService, useValue: { isRecording: signal(false), startRecording: vi.fn(), stopRecording: vi.fn() } },
        { provide: PlatformService, useValue: mockPlatformService },
        { provide: SettingsService, useValue: { settings: signal({ postToXByDefault: false }) } },
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
    vi.restoreAllMocks();
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

  describe('deferred media uploads', () => {
    it('should queue dropped video media and insert a publish placeholder instead of uploading immediately', async () => {
      createComponent();
      await fixture.whenStable();

      const createObjectUrl = vi.fn(() => 'blob:mock-video-url');
      const revokeObjectUrl = vi.fn();
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });

      const originalFile = new File(['0123456789'], 'clip.mp4', { type: 'video/mp4' });
      const compressedFile = new File(['0123'], 'clip.mp4', { type: 'video/mp4' });

      mockMediaProcessingService.prepareFileForUpload.mockResolvedValue({
        file: compressedFile,
        uploadOriginal: false,
        wasProcessed: true,
      });

      const privateComponent = component as unknown as {
        extractPendingVideoThumbnail: (file: File) => Promise<{
          blob: Blob;
          objectUrl: string;
          dimensions: { width: number; height: number };
          blurhash?: string;
          thumbhash?: string;
        }>;
        uploadFiles: (files: File[]) => Promise<void>;
      };

      vi.spyOn(privateComponent, 'extractPendingVideoThumbnail').mockResolvedValue({
        blob: new Blob(['thumb'], { type: 'image/jpeg' }),
        objectUrl: 'blob:video-thumb',
        dimensions: { width: 720, height: 1280 },
        blurhash: 'blurhash',
        thumbhash: 'thumbhash',
      });

      await privateComponent.uploadFiles([originalFile]);

      const queuedMedia = component.mediaMetadata()[0];
      expect(mockMediaService.uploadFile).not.toHaveBeenCalled();
      expect(queuedMedia.pendingUpload).toBe(true);
      expect(queuedMedia.placeholderToken).toBe('[video1]');
      expect(component.content()).toContain(queuedMedia.placeholderToken);
      expect(queuedMedia.image).toBe('blob:video-thumb');
      expect(queuedMedia.originalSize).toBe(originalFile.size);
      expect(queuedMedia.processedSize).toBe(compressedFile.size);
    });

    it('should upload pending media on publish and replace the placeholder with the final URL', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image-preview') });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const imageFile = new File(['image-data'], 'photo.png', { type: 'image/png' });

      mockMediaProcessingService.prepareFileForUpload.mockResolvedValue({
        file: imageFile,
        uploadOriginal: false,
        wasProcessed: false,
      });

      const privateComponent = component as unknown as {
        uploadFiles: (files: File[]) => Promise<void>;
        extractMediaMetadata: (
          file: File,
          url: string,
          sha256?: string,
          mirrors?: string[],
        ) => Promise<{
          url: string;
          mimeType: string;
          sha256?: string;
          fallbackUrls?: string[];
        }>;
        uploadPendingMediaBeforePublish: () => Promise<boolean>;
      };

      await privateComponent.uploadFiles([imageFile]);

      const placeholder = component.mediaMetadata()[0].placeholderToken as string;

      mockMediaService.uploadFile.mockResolvedValue({
        status: 'success',
        item: {
          url: 'https://cdn.example/photo.png',
          sha256: 'sha256-hash',
          mirrors: ['https://mirror.example/photo.png'],
        },
      });

      vi.spyOn(privateComponent, 'extractMediaMetadata').mockResolvedValue({
        url: 'https://cdn.example/photo.png',
        mimeType: 'image/png',
        sha256: 'sha256-hash',
        fallbackUrls: ['https://mirror.example/photo.png'],
      });

      const uploaded = await privateComponent.uploadPendingMediaBeforePublish();

      expect(uploaded).toBe(true);
      expect(mockMediaService.uploadFile).toHaveBeenCalledTimes(1);
      expect(component.content()).toContain('https://cdn.example/photo.png');
      expect(component.content()).not.toContain(placeholder);
      expect(component.mediaMetadata()[0].pendingUpload).toBe(false);
      expect(component.mediaMetadata()[0].url).toBe('https://cdn.example/photo.png');
    });

    it('should upload the original file when local optimization produces a larger result', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:video-preview') });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const originalFile = new File(['01234567'], 'clip.mp4', { type: 'video/mp4' });
      const largerOptimizedCandidate = new File(['0123456789AB'], 'clip.mp4', { type: 'video/mp4' });

      mockMediaProcessingService.prepareFileForUpload.mockResolvedValue({
        file: originalFile,
        uploadOriginal: false,
        wasProcessed: false,
        optimizedSize: largerOptimizedCandidate.size,
        warningMessage: 'Local optimization did not reduce clip.mp4, so the original file will be uploaded.',
      });

      const privateComponent = component as unknown as {
        extractPendingVideoThumbnail: (file: File) => Promise<{
          blob: Blob;
          objectUrl: string;
          dimensions: { width: number; height: number };
          blurhash?: string;
          thumbhash?: string;
        }>;
        extractMediaMetadata: (
          file: File,
          url: string,
          sha256?: string,
          mirrors?: string[],
          thumbnailData?: unknown,
        ) => Promise<{
          url: string;
          mimeType: string;
          sha256?: string;
          dimensions?: { width: number; height: number };
          image?: string;
          fallbackUrls?: string[];
        } | null>;
        uploadFiles: (files: File[]) => Promise<void>;
        uploadPendingMediaBeforePublish: () => Promise<boolean>;
      };

      vi.spyOn(privateComponent, 'extractPendingVideoThumbnail').mockResolvedValue({
        blob: new Blob(['thumb'], { type: 'image/jpeg' }),
        objectUrl: 'blob:video-thumb',
        dimensions: { width: 720, height: 1280 },
        blurhash: 'blurhash',
        thumbhash: 'thumbhash',
      });

      vi.spyOn(privateComponent, 'extractMediaMetadata').mockResolvedValue({
        url: 'https://cdn.example/clip.mp4',
        mimeType: 'video/mp4',
        sha256: 'sha256-video',
        dimensions: { width: 720, height: 1280 },
        image: 'https://cdn.example/clip.jpg',
        fallbackUrls: ['https://mirror.example/clip.mp4'],
      });

      await privateComponent.uploadFiles([originalFile]);

      mockMediaService.uploadFile.mockResolvedValue({
        status: 'success',
        item: {
          url: 'https://cdn.example/clip.mp4',
          sha256: 'sha256-video',
          mirrors: ['https://mirror.example/clip.mp4'],
        },
      });

      const uploaded = await privateComponent.uploadPendingMediaBeforePublish();

      expect(uploaded).toBe(true);
      expect(mockMediaService.uploadFile).toHaveBeenCalledWith(
        originalFile,
        false,
        ['https://media.example']
      );
      expect(component.mediaMetadata()[0].processedSize).toBe(originalFile.size);
      expect(component.mediaMetadata()[0].optimizedSize).toBe(largerOptimizedCandidate.size);
    });

    it('should assign sequential image placeholders for multiple queued uploads', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image-preview') });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const firstImageFile = new File(['image-data-1'], 'photo-1.png', { type: 'image/png' });
      const secondImageFile = new File(['image-data-2'], 'photo-2.png', { type: 'image/png' });

      mockMediaProcessingService.prepareFileForUpload.mockImplementation(async (file: File) => ({
        file,
        uploadOriginal: false,
        wasProcessed: false,
      }));

      const privateComponent = component as unknown as {
        uploadFiles: (files: File[]) => Promise<void>;
      };

      await privateComponent.uploadFiles([firstImageFile, secondImageFile]);

      expect(component.mediaMetadata().map(media => media.placeholderToken)).toEqual(['[image1]', '[image2]']);
      expect(component.content()).toContain('[image1]');
      expect(component.content()).toContain('[image2]');
    });

    it('should recompress pending media when media optimization changes', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: vi.fn()
          .mockReturnValueOnce('blob:image-preview-initial')
          .mockReturnValueOnce('blob:image-preview-updated'),
      });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const originalFile = new File(['original-image-data'], 'photo.png', { type: 'image/png' });
      const initialPrepared = new File(['initial-image-data'], 'photo.png', { type: 'image/webp' });
      const optimizedPrepared = new File(['optimized-image-data'], 'photo.png', { type: 'image/webp' });

      mockMediaProcessingService.prepareFileForUpload
        .mockResolvedValueOnce({
          file: initialPrepared,
          uploadOriginal: false,
          wasProcessed: true,
        })
        .mockResolvedValueOnce({
          file: optimizedPrepared,
          uploadOriginal: false,
          wasProcessed: true,
        });

      const privateComponent = component as unknown as {
        uploadFiles: (files: File[]) => Promise<void>;
      };

      await privateComponent.uploadFiles([originalFile]);
      const pendingBefore = component.mediaMetadata()[0];

      await component.onMediaOptimizationChange('optimized');

      const pendingAfter = component.mediaMetadata()[0];
      expect(component.compressionStrength()).toBe(OPTIMIZED_MEDIA_COMPRESSION_STRENGTH);
      expect(mockMediaProcessingService.prepareFileForUpload).toHaveBeenLastCalledWith(
        originalFile,
        {
          mode: 'local',
          compressionStrength: OPTIMIZED_MEDIA_COMPRESSION_STRENGTH,
          videoOptimizationProfile: 'default',
        },
        expect.any(Function)
      );
      expect(pendingAfter.id).toBe(pendingBefore.id);
      expect(pendingAfter.placeholderToken).toBe(pendingBefore.placeholderToken);
      expect(pendingAfter.processedSize).toBe(optimizedPrepared.size);
      expect(pendingAfter.previewUrl).toBe('blob:image-preview-updated');
      expect(pendingAfter.sourceFile).toBe(originalFile);
    });

    it('should ignore stale optimization results when the user switches presets quickly', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: vi.fn()
          .mockReturnValueOnce('blob:image-preview-initial')
          .mockReturnValueOnce('blob:image-preview-fast')
          .mockReturnValueOnce('blob:image-preview-stale'),
      });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const originalFile = new File(['original-image-data'], 'photo.png', { type: 'image/png' });
      const initialPrepared = new File(['initial-image-data'], 'photo.png', { type: 'image/webp' });
      const fastPrepared = new File(['fast-image-data'], 'photo.png', { type: 'image/webp' });
      const stalePrepared = new File(['stale-image-data'], 'photo.png', { type: 'image/webp' });

      let resolveSlow: ((value: { file: File; uploadOriginal: boolean; wasProcessed: boolean }) => void) | undefined;
      let resolveFast: ((value: { file: File; uploadOriginal: boolean; wasProcessed: boolean }) => void) | undefined;

      mockMediaProcessingService.prepareFileForUpload
        .mockResolvedValueOnce({
          file: initialPrepared,
          uploadOriginal: false,
          wasProcessed: true,
        })
        .mockImplementationOnce(() => new Promise(resolve => {
          resolveSlow = resolve;
        }))
        .mockImplementationOnce(() => new Promise(resolve => {
          resolveFast = resolve;
        }));

      const privateComponent = component as unknown as {
        uploadFiles: (files: File[]) => Promise<void>;
      };

      await privateComponent.uploadFiles([originalFile]);

      const slowRun = component.onMediaOptimizationChange('minimal');
      const fastRun = component.onMediaOptimizationChange('optimized');

      resolveFast?.({
        file: fastPrepared,
        uploadOriginal: false,
        wasProcessed: true,
      });
      await fastRun;

      resolveSlow?.({
        file: stalePrepared,
        uploadOriginal: false,
        wasProcessed: true,
      });
      await slowRun;

      const pendingAfter = component.mediaMetadata()[0];
      expect(component.compressionStrength()).toBe(OPTIMIZED_MEDIA_COMPRESSION_STRENGTH);
      expect(pendingAfter.processedSize).toBe(fastPrepared.size);
      expect(pendingAfter.previewUrl).toBe('blob:image-preview-fast');
    });

    it('should insert a space when adjacent image placeholders are replaced with final URLs', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image-preview') });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const firstImageFile = new File(['image-data-1'], 'photo-1.png', { type: 'image/png' });
      const secondImageFile = new File(['image-data-2'], 'photo-2.png', { type: 'image/png' });

      mockMediaProcessingService.prepareFileForUpload.mockImplementation(async (file: File) => ({
        file,
        uploadOriginal: false,
        wasProcessed: false,
      }));

      const privateComponent = component as unknown as {
        uploadFiles: (files: File[]) => Promise<void>;
        extractMediaMetadata: (
          file: File,
          url: string,
          sha256?: string,
          mirrors?: string[],
        ) => Promise<{
          url: string;
          mimeType: string;
          sha256?: string;
          fallbackUrls?: string[];
        }>;
        uploadPendingMediaBeforePublish: () => Promise<boolean>;
      };

      await privateComponent.uploadFiles([firstImageFile, secondImageFile]);
      component.content.set('[image1][image2]');

      mockMediaService.uploadFile
        .mockResolvedValueOnce({
          status: 'success',
          item: { url: 'https://cdn.example/photo-1.png', sha256: 'sha-1', mirrors: [] },
        })
        .mockResolvedValueOnce({
          status: 'success',
          item: { url: 'https://cdn.example/photo-2.png', sha256: 'sha-2', mirrors: [] },
        });

      vi.spyOn(privateComponent, 'extractMediaMetadata')
        .mockResolvedValueOnce({
          url: 'https://cdn.example/photo-1.png',
          mimeType: 'image/png',
          sha256: 'sha-1',
          fallbackUrls: [],
        })
        .mockResolvedValueOnce({
          url: 'https://cdn.example/photo-2.png',
          mimeType: 'image/png',
          sha256: 'sha-2',
          fallbackUrls: [],
        });

      const uploaded = await privateComponent.uploadPendingMediaBeforePublish();

      expect(uploaded).toBe(true);
      expect(component.content()).toBe('https://cdn.example/photo-1.png https://cdn.example/photo-2.png');
    });

    it('should resolve pending video placeholders to the local preview URL in preview mode', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock-video-url') });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const originalFile = new File(['0123456789'], 'clip.mp4', { type: 'video/mp4' });
      const compressedFile = new File(['0123'], 'clip.mp4', { type: 'video/mp4' });

      mockMediaProcessingService.prepareFileForUpload.mockResolvedValue({
        file: compressedFile,
        uploadOriginal: false,
        wasProcessed: true,
      });

      const privateComponent = component as unknown as {
        extractPendingVideoThumbnail: (file: File) => Promise<{
          blob: Blob;
          objectUrl: string;
          dimensions: { width: number; height: number };
          blurhash?: string;
          thumbhash?: string;
        }>;
        uploadFiles: (files: File[]) => Promise<void>;
      };

      vi.spyOn(privateComponent, 'extractPendingVideoThumbnail').mockResolvedValue({
        blob: new Blob(['thumb'], { type: 'image/jpeg' }),
        objectUrl: 'blob:video-thumb',
        dimensions: { width: 720, height: 1280 },
      });

      await privateComponent.uploadFiles([originalFile]);

      component.showPreview.set(true);

      expect(component.previewContent()).toContain('blob:mock-video-url#nostria-video');
      expect(component.previewContent()).not.toContain('[video1]');
    });

    it('should insert upload placeholders at the cursor position captured when upload started', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image-preview') });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const imageFile = new File(['image-data'], 'photo.png', { type: 'image/png' });

      let resolvePrepare: ((value: { file: File; uploadOriginal: boolean; wasProcessed: boolean }) => void) | undefined;
      mockMediaProcessingService.prepareFileForUpload.mockImplementation(() => new Promise(resolve => {
        resolvePrepare = resolve;
      }));

      const textarea = component.contentTextarea.nativeElement;
      const initialContent = 'Check this video and then you should check this video';
      component.content.set(initialContent);
      fixture.detectChanges();
      textarea.value = initialContent;
      textarea.focus();

      const uploadStartPosition = 'Check this video'.length;
      textarea.setSelectionRange(uploadStartPosition, uploadStartPosition);

      const privateComponent = component as unknown as {
        uploadFiles: (files: File[]) => Promise<void>;
      };

      const uploadPromise = privateComponent.uploadFiles([imageFile]);

      const editedContent = 'Check this video and then you should check this video [image2]';
      component.content.set(editedContent);
      fixture.detectChanges();
      textarea.value = editedContent;
      textarea.setSelectionRange(editedContent.length, editedContent.length);

      resolvePrepare?.({
        file: imageFile,
        uploadOriginal: false,
        wasProcessed: false,
      });

      await uploadPromise;

      expect(component.content()).toBe('Check this video [image1] and then you should check this video [image2]');
    });

    it('should reinsert a removed pending video placeholder when the thumbnail is clicked', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock-video-url') });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const originalFile = new File(['0123456789'], 'clip.mp4', { type: 'video/mp4' });
      const compressedFile = new File(['0123'], 'clip.mp4', { type: 'video/mp4' });

      mockMediaProcessingService.prepareFileForUpload.mockResolvedValue({
        file: compressedFile,
        uploadOriginal: false,
        wasProcessed: true,
      });

      const privateComponent = component as unknown as {
        extractPendingVideoThumbnail: (file: File) => Promise<{
          blob: Blob;
          objectUrl: string;
          dimensions: { width: number; height: number };
          blurhash?: string;
          thumbhash?: string;
        }>;
        uploadFiles: (files: File[]) => Promise<void>;
      };

      vi.spyOn(privateComponent, 'extractPendingVideoThumbnail').mockResolvedValue({
        blob: new Blob(['thumb'], { type: 'image/jpeg' }),
        objectUrl: 'blob:video-thumb',
        dimensions: { width: 720, height: 1280 },
      });

      await privateComponent.uploadFiles([originalFile]);

      const placeholder = component.mediaMetadata()[0].placeholderToken as string;
      component.content.set('caption only');
      fixture.detectChanges();

      const reinsertButton = fixture.nativeElement.querySelector('.media-thumbnail-button.pending-upload') as HTMLButtonElement;
      reinsertButton.click();
      fixture.detectChanges();

      expect(component.mediaMetadata()).toHaveLength(1);
      expect(component.mediaMetadata()[0].pendingUpload).toBe(true);
      expect(component.content()).toContain(placeholder);
    });

    it('should open pending image thumbnails in the media preview dialog when the placeholder is still present', async () => {
      createComponent();
      await fixture.whenStable();

      component.mediaMetadata.set([
        {
          id: 'pending-image-1',
          url: 'blob:optimized-image',
          previewUrl: 'blob:optimized-image',
          mimeType: 'image/png',
          fileName: 'photo.png',
          originalSize: 4096,
          processedSize: 2048,
          pendingUpload: true,
          placeholderToken: '[image1]',
        },
      ]);
      component.content.set('caption\n\n[image1]');
      fixture.detectChanges();

      const previewButton = fixture.nativeElement.querySelector('.media-thumbnail-button.pending-upload') as HTMLButtonElement;
      previewButton.click();
      await vi.dynamicImportSettled();

      expect(mockMatDialog.open).toHaveBeenCalledTimes(1);
      expect(mockMatDialog.open).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          data: {
            mediaItems: [
              {
                url: 'blob:optimized-image',
                type: 'image',
                title: 'photo.png',
              },
            ],
            initialIndex: 0,
          },
          panelClass: 'image-dialog-panel',
        })
      );
    });

    it('should render pending video thumbnail size and savings using local file fallbacks', async () => {
      createComponent();
      await fixture.whenStable();

      const originalVideo = new File(['01234567'], 'clip.mp4', { type: 'video/mp4' });
      const optimizedVideo = new File(['0123'], 'clip.mp4', { type: 'video/mp4' });

      component.mediaMetadata.set([
        {
          id: 'pending-video-1',
          url: 'blob:optimized-video',
          image: 'blob:video-thumb',
          mimeType: 'video/mp4',
          fileName: 'clip.mp4',
          localFile: optimizedVideo,
          sourceFile: originalVideo,
          pendingUpload: true,
          placeholderToken: '[video1]',
        },
      ]);
      component.content.set('caption\n\n[video1]');
      fixture.detectChanges();

      const savingsLabel = fixture.nativeElement.querySelector('.media-savings') as HTMLElement;
      const sizeLabel = fixture.nativeElement.querySelector('.media-size') as HTMLElement;

      expect(savingsLabel.textContent?.trim()).toBe('-50%');
      expect(sizeLabel.textContent?.trim()).toBe('4B');
      expect(fixture.nativeElement.querySelector('.video-icon')).toBeNull();
    });

    it('should render attempted optimized video size when local optimization falls back to the original upload', async () => {
      createComponent();
      await fixture.whenStable();

      const originalVideo = new File(['01234567'], 'clip.mp4', { type: 'video/mp4' });
      const uploadedOriginal = new File(['01234567'], 'clip.mp4', { type: 'video/mp4' });

      component.mediaMetadata.set([
        {
          id: 'pending-video-fallback',
          url: 'blob:original-video',
          image: 'blob:video-thumb',
          mimeType: 'video/mp4',
          fileName: 'clip.mp4',
          localFile: uploadedOriginal,
          sourceFile: originalVideo,
          originalSize: originalVideo.size,
          processedSize: uploadedOriginal.size,
          optimizedSize: 12,
          warningMessage: 'Local optimization did not reduce clip.mp4, so the original file will be uploaded.',
          pendingUpload: true,
          placeholderToken: '[video1]',
        },
      ]);
      component.content.set('caption\n\n[video1]');
      fixture.detectChanges();

      const savingsLabel = fixture.nativeElement.querySelector('.media-savings') as HTMLElement;
      const sizeLabel = fixture.nativeElement.querySelector('.media-size') as HTMLElement;

      expect(savingsLabel.textContent?.trim()).toBe('+50%');
      expect(sizeLabel.textContent?.trim()).toBe('12B');
    });

    it('should reprocess only the selected pending video when changing its video type', async () => {
      createComponent();
      await fixture.whenStable();

      const firstOriginal = new File(['01234567'], 'demo.mp4', { type: 'video/mp4' });
      const secondOriginal = new File(['abcdefgh'], 'camera.mp4', { type: 'video/mp4' });
      const firstProcessed = new File(['0123'], 'demo.mp4', { type: 'video/mp4' });

      component.mediaMetadata.set([
        {
          id: 'video-a',
          url: 'blob:video-a',
          image: 'blob:thumb-a',
          mimeType: 'video/mp4',
          fileName: 'demo.mp4',
          localFile: firstProcessed,
          sourceFile: firstOriginal,
          pendingUpload: true,
          placeholderToken: '[video1]',
          videoOptimizationProfile: 'default',
        },
        {
          id: 'video-b',
          url: 'blob:video-b',
          image: 'blob:thumb-b',
          mimeType: 'video/mp4',
          fileName: 'camera.mp4',
          localFile: secondOriginal,
          sourceFile: secondOriginal,
          pendingUpload: true,
          placeholderToken: '[video2]',
          videoOptimizationProfile: 'default',
        },
      ]);

      const privateComponent = component as unknown as {
        extractPendingVideoThumbnail: (file: File) => Promise<{
          blob: Blob;
          objectUrl: string;
          dimensions: { width: number; height: number };
        }>;
      };

      vi.spyOn(privateComponent, 'extractPendingVideoThumbnail').mockResolvedValue({
        blob: new Blob(['thumb'], { type: 'image/jpeg' }),
        objectUrl: 'blob:new-thumb',
        dimensions: { width: 1280, height: 720 },
      });

      mockMediaProcessingService.prepareFileForUpload.mockResolvedValue({
        file: new File(['01'], 'demo.mp4', { type: 'video/mp4' }),
        uploadOriginal: false,
        optimizedSize: 2,
        wasProcessed: true,
      });

      component.videoProfileMenuMediaId.set('video-a');
      await component.onVideoOptimizationProfileSelected('slides');

      expect(mockMediaProcessingService.prepareFileForUpload).toHaveBeenCalledTimes(1);
      expect(mockMediaProcessingService.prepareFileForUpload).toHaveBeenCalledWith(
        firstOriginal,
        expect.objectContaining({
          mode: 'local',
          compressionStrength: component.compressionStrength(),
          videoOptimizationProfile: 'slides',
        }),
        expect.any(Function)
      );
      expect(component.mediaMetadata()[0].videoOptimizationProfile).toBe('slides');
      expect(component.mediaMetadata()[1].videoOptimizationProfile).toBe('default');
    });

    it('should open the video type menu on right-click for pending videos', async () => {
      createComponent();
      await fixture.whenStable();

      component.mediaMetadata.set([
        {
          id: 'pending-video-1',
          url: 'blob:optimized-video',
          image: 'blob:video-thumb',
          mimeType: 'video/mp4',
          fileName: 'clip.mp4',
          localFile: new File(['0123'], 'clip.mp4', { type: 'video/mp4' }),
          sourceFile: new File(['01234567'], 'clip.mp4', { type: 'video/mp4' }),
          pendingUpload: true,
          placeholderToken: '[video1]',
        },
      ]);
      fixture.detectChanges();

      const previewButton = fixture.nativeElement.querySelector('.media-thumbnail-button.pending-upload') as HTMLButtonElement;
      previewButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 70 }));
      fixture.detectChanges();
      await fixture.whenStable();

      const overlayText = document.body.textContent ?? '';
      expect(overlayText).toContain('Regular Video');
      expect(overlayText).toContain('Slides and Text');
      expect(component.videoProfileMenuMediaId()).toBe('pending-video-1');
    });

    it('should open uploaded image thumbnails in the media preview dialog', async () => {
      createComponent();
      await fixture.whenStable();

      component.mediaMetadata.set([
        {
          id: 'image-1',
          url: 'https://cdn.example/photo.png',
          previewUrl: 'https://cdn.example/photo.png',
          mimeType: 'image/png',
          fileName: 'photo.png',
          originalSize: 4096,
          processedSize: 2048,
        },
      ]);
      fixture.detectChanges();

      const previewButton = fixture.nativeElement.querySelector('.media-thumbnail-button') as HTMLButtonElement;
      previewButton.click();
      await vi.dynamicImportSettled();

      expect(mockMatDialog.open).toHaveBeenCalledTimes(1);
      expect(mockMatDialog.open).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          data: {
            mediaItems: [
              {
                url: 'https://cdn.example/photo.png',
                type: 'image',
                title: 'photo.png',
              },
            ],
            initialIndex: 0,
          },
          panelClass: 'image-dialog-panel',
          width: '100vw',
          height: '100vh',
        })
      );
    });

    it('should skip queuing media when generating the pending video thumbnail fails', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:video-preview') });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const originalFile = new File(['0123456789'], 'broken.mp4', { type: 'video/mp4' });
      const compressedFile = new File(['0123'], 'broken.mp4', { type: 'video/mp4' });

      mockMediaProcessingService.prepareFileForUpload.mockResolvedValue({
        file: compressedFile,
        uploadOriginal: false,
        wasProcessed: true,
      });

      const privateComponent = component as unknown as {
        extractPendingVideoThumbnail: (file: File) => Promise<never>;
        uploadFiles: (files: File[]) => Promise<void>;
      };

      vi.spyOn(privateComponent, 'extractPendingVideoThumbnail').mockRejectedValue(new Error('thumbnail failed'));

      await privateComponent.uploadFiles([originalFile]);

      expect(component.mediaMetadata()).toHaveLength(0);
      expect(component.content()).toBe('');
      expect(mockSnackBar.open).toHaveBeenCalledWith(
        expect.stringContaining('Failed to prepare 1 file(s)'),
        'Close',
        expect.objectContaining({ panelClass: 'error-snackbar' })
      );
    });

    it('should keep placeholders in place when publish-time upload fails', async () => {
      createComponent();
      await fixture.whenStable();

      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image-preview') });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

      const imageFile = new File(['image-data'], 'photo.png', { type: 'image/png' });

      const privateComponent = component as unknown as {
        uploadFiles: (files: File[]) => Promise<void>;
        uploadPendingMediaBeforePublish: () => Promise<boolean>;
      };

      await privateComponent.uploadFiles([imageFile]);
      const placeholder = component.mediaMetadata()[0].placeholderToken as string;

      mockMediaService.uploadFile.mockResolvedValue({
        status: 'error',
        message: 'server rejected file',
      });

      const uploaded = await privateComponent.uploadPendingMediaBeforePublish();

      expect(uploaded).toBe(false);
      expect(component.content()).toContain(placeholder);
      expect(component.mediaMetadata()[0].pendingUpload).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalledWith(
        expect.stringContaining('Failed to upload 1 file(s)'),
        'Close',
        expect.objectContaining({ panelClass: 'error-snackbar' })
      );
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

    it('should preserve manual scroll during layout-only refreshes even when the cursor is at the end', async () => {
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
        wrapper.scrollTop = 400;
      }

      textarea.focus();
      textarea.value = 'hello world';
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);

      (component as unknown as { scheduleTextareaRefresh: () => void }).scheduleTextareaRefresh();

      await new Promise(resolve => requestAnimationFrame(resolve));

      expect(textarea.scrollTop).toBe(120);
      if (wrapper) {
        expect(wrapper.scrollTop).toBe(400);
      }
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

    it('should render the add button between preview and advanced options in dialog mode', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      const buttons = Array.from(fixture.nativeElement.querySelectorAll('.left-actions button[mattooltip]')) as HTMLElement[];
      const previewIndex = buttons.findIndex(button => button.getAttribute('mattooltip') === 'Toggle preview');
      const addIndex = buttons.findIndex(button => button.getAttribute('mattooltip') === 'Add to post');
      const settingsIndex = buttons.findIndex(button => button.getAttribute('mattooltip') === 'Advanced options');

      expect(previewIndex).toBeGreaterThan(-1);
      expect(addIndex).toBeGreaterThan(-1);
      expect(settingsIndex).toBeGreaterThan(-1);
      expect(previewIndex).toBeLessThan(addIndex);
      expect(addIndex).toBeLessThan(settingsIndex);
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

    it('should include clear draft in the more actions menu instead of the main toolbar', async () => {
      createComponent();
      fixture.detectChanges();
      await fixture.whenStable();

      const toolbarClearDraft = fixture.nativeElement.querySelector('button[mattooltip="Clear draft"]');
      const compiled = fixture.nativeElement;

      expect(toolbarClearDraft).toBeFalsy();
      expect(compiled.textContent).toContain('Clear draft');
    });

    it('should render Show Event JSON as an expander button instead of a slide toggle', async () => {
      createComponent();
      component.showAdvancedOptions.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const jsonExpander = fixture.nativeElement.querySelector('.event-json-expander') as HTMLButtonElement | null;
      const jsonToggle = fixture.nativeElement.querySelector('mat-slide-toggle');

      expect(jsonExpander?.textContent).toContain('Show Event JSON');
      expect(jsonToggle?.textContent ?? '').not.toContain('Show Event JSON');
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

  describe('translation action', () => {
    it('should open the AI tools dialog for translation', async () => {
      createComponent();
      component.content.set('Translate me');

      component.openAiDialog('translate');

      expect(mockCustomDialogService.open).toHaveBeenCalled();
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
