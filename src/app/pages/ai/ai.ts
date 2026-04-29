import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, PLATFORM_ID, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AiChatMessage, AiCloudAccessMode, AiCloudProvider, AiGeneratedAudio, AiGeneratedImage, AiGeneratedVideo, AiGenerationProgress, AiImageGenerationOptions, AiModelLoadOptions, AiMultimodalChatMessage, AiMultimodalChatPart, AiService, AiVideoGenerationOptions, AiVideoGenerationProgress, AiVoiceGenerationProgress } from '../../services/ai.service';
import { AiChatHistoryService, AiHistoryGeneratedAudio, AiHistoryGeneratedImage, AiHistoryGeneratedVideo } from '../../services/ai-chat-history.service';
import { AiInfoDialogComponent, type AiInfoDialogResult } from '../../components/ai-info-dialog/ai-info-dialog.component';
import type { ArticleEditorDialogInitialDraft } from '../../components/article-editor-dialog/article-editor-dialog.component';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';
import { EventService } from '../../services/event';
import { FormatService } from '../../services/format/format.service';
import { LayoutService } from '../../services/layout.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { LoggerService } from '../../services/logger.service';
import { MediaService } from '../../services/media.service';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { CorsProxyService } from '../../services/cors-proxy.service';
import { SpeechService } from '../../services/speech.service';

interface ModelInfo {
  id: string;
  task: string;
  name: string;
  description: string;
  size: string;
  loading: boolean;
  progress: number;
  loaded: boolean;
  cached: boolean;
  runtime: string;
  source?: 'local' | 'cloud';
  provider?: AiCloudProvider;
  cloudAccessMode?: AiCloudAccessMode;
  cloudModel?: string;
  loadOptions?: AiModelLoadOptions;
  chatMode?: 'messages' | 'prompt';
  chatDisabledReason?: string;
  preferredParams?: Record<string, unknown>;
  fetchContextCharLimit?: number;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  processingStartedAt?: number;
  processingDurationMs?: number;
  attachments?: ComposerAttachment[];
  attachmentContext?: string;
  generatedImages?: AiGeneratedImage[];
  generatedVideos?: AiGeneratedVideo[];
  generatedAudios?: AiGeneratedAudio[];
}

interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: 'text' | 'file';
  context: string;
  cacheKey: string;
  sourceUrl?: string;
  previewUrl?: string;
}

interface AiQuickPrompt {
  label: string;
  prompt: string;
  task?: 'image-generation' | 'video-generation' | 'voice-generation';
}

interface AssistantSuggestion {
  id: string;
  title: string;
  content: string;
}

interface RenderedAssistantSuggestion extends AssistantSuggestion {
  renderedContent: SafeHtml | null;
}

interface RenderedAssistantContent {
  thinking: SafeHtml | null;
  answer: SafeHtml | null;
  suggestionIntro: SafeHtml | null;
  suggestionOutro: SafeHtml | null;
  suggestions: RenderedAssistantSuggestion[];
}

interface VisualIntent {
  task: 'image-generation' | 'image-upscaling' | 'video-generation';
  prompt: string;
}

interface ChoiceOption {
  value: string;
  label: string;
}

interface VoiceChoiceOption extends ChoiceOption {
  description: string;
}

interface AudioPlaybackState {
  playing: boolean;
  currentTime: number;
  duration: number;
}

type XAiComposerMode = 'text' | 'image' | 'video' | 'voice';

interface FetchedPromptContext {
  url: string;
  markdown: string;
}

@Component({
  selector: 'app-ai',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
  ],
  templateUrl: './ai.html',
  styleUrl: './ai.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiComponent {
  private static readonly AI_UPLOAD_CACHE = 'nostria-ai';
  private static readonly AI_INFO_SEEN_STORAGE_KEY = 'nostria-ai-info-dialog-seen';
  private static readonly FETCH_COMMAND_PATTERN = /(^|\s)#fetch\s+(\S+)/gi;
  private static readonly FETCH_KEYWORD_PATTERN = /(^|\s)#fetch\b/i;
  private static readonly FETCH_MARKDOWN_CHAR_LIMIT = 12000;
  private static readonly GENERATED_VIDEO_FETCH_INITIAL_DELAY_MS = 1500;
  private static readonly GENERATED_VIDEO_FETCH_RETRY_DELAY_MS = 2000;
  private static readonly GENERATED_VIDEO_FETCH_MAX_ATTEMPTS = 4;

  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly accountState = inject(AccountStateService);
  private readonly aiService = inject(AiService);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formatService = inject(FormatService);
  private readonly historyService = inject(AiChatHistoryService);
  private readonly layout = inject(LayoutService);
  private readonly logger = inject(LoggerService);
  private readonly dialog = inject(MatDialog);
  private readonly eventService = inject(EventService);
  private readonly mediaService = inject(MediaService);
  private readonly corsProxy = inject(CorsProxyService);
  private readonly speechService = inject(SpeechService);
  private readonly customDialog = inject(CustomDialogService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly panelNav = inject(PanelNavigationService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly snackBar = inject(MatSnackBar);
  private readonly conversationPanelRef = viewChild<ElementRef<HTMLDivElement>>('conversationPanel');
  private readonly conversationEndRef = viewChild<ElementRef<HTMLDivElement>>('conversationEnd');
  private readonly attachmentInputRef = viewChild<ElementRef<HTMLInputElement>>('attachmentInput');
  private readonly composerInputRef = viewChild<ElementRef<HTMLTextAreaElement>>('composerInput');

  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly systemPrompt = 'You are Nostria\'s local AI assistant. Keep replies concise, practical, and grounded in the user\'s request. If you are answering in text mode, do not claim that you directly generated or upscaled an image. You can help refine prompts or explain what to do next, but only claim actions that actually happened in the current chat.';
  private readonly nextMessageId = signal(0);
  private readonly renderedAssistantSource = new Map<string, string>();
  private readonly renderedAssistantVersion = new Map<string, number>();
  private readonly pendingGeneratedImageCacheIds = new Set<string>();
  private readonly pendingGeneratedVideoCacheIds = new Set<string>();
  private readonly autoPlayedAudioIds = new Set<string>();
  readonly webGpuAvailable = this.isBrowser && typeof navigator !== 'undefined' && 'gpu' in navigator;
  readonly autoScrollPinned = signal(true);
  readonly splitPaneMode = computed(() => this.panelNav.hasRightContent() && !this.panelNav.isMobile());
  readonly currentConversationId = signal<string | null>(null);
  readonly narrowHistoryMode = signal(false);
  readonly showHistoryDrawer = signal(false);
  readonly historyQuery = signal('');
  readonly activeShareMessage = signal<ConversationMessage | null>(null);
  readonly activeGeneratedImage = signal<AiGeneratedImage | null>(null);
  readonly activeGeneratedVideo = signal<AiGeneratedVideo | null>(null);
  readonly activeGeneratedAudio = signal<AiGeneratedAudio | null>(null);
  readonly activeSuggestion = signal<AssistantSuggestion | null>(null);
  readonly renderedAssistantMessages = signal<Record<string, RenderedAssistantContent>>({});
  readonly attachedFiles = signal<ComposerAttachment[]>([]);
  readonly cloudSettings = this.aiService.cloudSettings;
  readonly hideHistoryRail = computed(() => this.splitPaneMode() || this.narrowHistoryMode());
  readonly preferredXAiChatAccessMode = signal<AiCloudAccessMode>('api-key');

  readonly models = signal<ModelInfo[]>([
    {
      id: 'onnx-community/gemma-4-E2B-it-ONNX',
      task: 'text-generation',
      name: 'Gemma 4 E2B',
      description: 'Instruction-tuned Gemma 4 chat model for local browser inference.',
      size: '~2B parameters',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q4f16',
      loadOptions: { device: 'webgpu', dtype: 'q4f16' },
      chatMode: 'messages',
      chatDisabledReason: this.webGpuAvailable ? undefined : 'Requires WebGPU support in the browser.',
      fetchContextCharLimit: 4000,
      preferredParams: {
        max_new_tokens: 384,
        do_sample: true,
        temperature: 0.7,
      },
    },
    {
      id: 'onnx-community/Qwen3.5-0.8B-ONNX',
      task: 'image-text-to-text',
      name: 'Qwen 3.5 0.8B Vision',
      description: 'Multimodal Qwen 3.5 model for local browser image-aware chat and visual analysis.',
      size: '~0.8B parameters',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q4f16 · vision',
      loadOptions: { device: 'webgpu', dtype: 'q4f16' },
      chatMode: 'messages',
      chatDisabledReason: this.webGpuAvailable ? undefined : 'Requires WebGPU support in the browser.',
      preferredParams: {
        max_new_tokens: 384,
        do_sample: false,
      },
    },
    {
      id: 'onnx-community/Qwen3.5-0.8B-Text-ONNX',
      task: 'text-generation',
      name: 'Qwen 3.5 0.8B',
      description: 'Verified Qwen 3.5 text-only chat model for local browser inference.',
      size: '~0.8B parameters',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q4f16',
      loadOptions: { device: 'webgpu', dtype: 'q4f16' },
      chatMode: 'messages',
      chatDisabledReason: this.webGpuAvailable ? undefined : 'Requires WebGPU support in the browser.',
      preferredParams: {
        max_new_tokens: 384,
        do_sample: false,
      },
    },
    {
      id: 'onnx-community/Qwen3-0.6B-ONNX',
      task: 'text-generation',
      name: 'Qwen 3 0.6B',
      description: 'Compact Qwen 3 chat model for fast local browser inference.',
      size: '~0.6B parameters',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q4f16',
      loadOptions: { device: 'webgpu', dtype: 'q4f16' },
      chatMode: 'messages',
      chatDisabledReason: this.webGpuAvailable ? undefined : 'Requires WebGPU support in the browser.',
      preferredParams: {
        max_new_tokens: 384,
        do_sample: false,
      },
    },
    {
      id: 'Xenova/distilgpt2',
      task: 'text-generation',
      name: 'DistilGPT2',
      description: 'Small fallback chat model for lighter devices and browsers without WebGPU.',
      size: '~85MB',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WASM/CPU',
      chatMode: 'prompt',
      preferredParams: {
        max_new_tokens: 120,
        do_sample: true,
        temperature: 0.8,
        return_full_text: false,
      },
    },
    {
      id: 'onnx-community/Janus-Pro-1B-ONNX',
      task: 'image-generation',
      name: 'Janus Pro 1B',
      description: 'Local browser image generation with DeepSeek Janus Pro via Transformers.js.',
      size: '~1B parameters',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · multimodal',
      source: 'local',
      chatDisabledReason: this.webGpuAvailable ? undefined : 'Requires WebGPU support in the browser.',
    },
    {
      id: 'Xenova/swin2SR-classical-sr-x2-64',
      task: 'image-upscaling',
      name: 'Swin2SR x2',
      description: 'Local image upscaling for attached artwork, screenshots, and photos.',
      size: 'x2 super-resolution',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WASM/CPU · q8',
      source: 'local',
      loadOptions: { device: 'wasm', dtype: 'q8' },
    },
    {
      id: 'Xenova/distilbart-cnn-6-6',
      task: 'summarization',
      name: 'DistilBART CNN',
      description: 'Summarization model used for local content shortening.',
      size: '~283MB',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WASM/CPU',
    },
    {
      id: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
      task: 'sentiment-analysis',
      name: 'DistilBERT Sentiment',
      description: 'Sentiment analysis model used for local text evaluation.',
      size: '~65MB',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WASM/CPU',
    },
    {
      id: 'Xenova/whisper-tiny.en',
      task: 'automatic-speech-recognition',
      name: 'Whisper Tiny',
      description: 'Speech-to-text model used for local transcription.',
      size: '~40MB',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WASM/CPU',
    },
    {
      id: 'Xenova/speecht5_tts',
      task: 'text-to-speech',
      name: 'SpeechT5',
      description: 'Text-to-speech voice synthesis model.',
      size: '~180MB',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WASM/CPU',
    },
    {
      id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      task: 'text-to-speech',
      name: 'Kokoro 82M',
      description: 'High-quality local text-to-speech with selectable Kokoro voices.',
      size: '~92MB q8 · ~310MB fp32',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: this.webGpuAvailable ? 'WebGPU · fp32' : 'WASM · q8',
      source: 'local',
      loadOptions: this.webGpuAvailable ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'q8', device: 'wasm' },
    },
    {
      id: 'onnx-community/Supertonic-TTS-2-ONNX',
      task: 'text-to-speech',
      name: 'Supertonic 2',
      description: 'Fast multilingual on-device text-to-speech with 10 preset voices.',
      size: '~305MB',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: this.webGpuAvailable ? 'WebGPU · fp32' : 'WASM · fp32',
      source: 'local',
      loadOptions: this.webGpuAvailable ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'fp32', device: 'wasm' },
    },
    {
      id: 'rhasspy/piper-voices/en_US-libritts_r-medium',
      task: 'text-to-speech',
      name: 'Piper LibriTTS',
      description: 'Local Piper TTS model with 904 selectable LibriTTS voices.',
      size: '~79MB',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WASM · 904 voices',
      source: 'local',
    },
  ]);

  readonly localChatModels = computed(() => this.models().filter(model => this.isChatGenerationTask(model.task) && model.source !== 'cloud'));
  readonly cloudChatModels = computed<ModelInfo[]>(() => {
    const models: ModelInfo[] = [];

    if (this.aiService.hasCloudChatAccessMode('xai', 'api-key')) {
      models.push({
        id: 'cloud-chat:xai:api-key',
        task: 'text-generation',
        name: this.aiService.getCloudModelDisplayName('xai', 'api-key'),
        description: 'Chat with xAI using your own API key.',
        size: 'Hosted API',
        loading: false,
        progress: 100,
        loaded: true,
        cached: false,
        runtime: this.aiService.getCloudAccessLabel('xai', 'api-key'),
        source: 'cloud',
        provider: 'xai',
        cloudAccessMode: 'api-key',
        cloudModel: this.aiService.getChatModel('xai', 'api-key'),
        chatMode: 'messages',
      });
    }

    if (this.aiService.hasCloudChatAccessMode('xai', 'hosted')) {
      models.push({
        id: 'cloud-chat:xai:hosted',
        task: 'text-generation',
        name: this.aiService.getCloudModelDisplayName('xai', 'hosted'),
        description: 'Chat with Nostria hosted Grok using your subscription and credits.',
        size: 'Hosted API',
        loading: false,
        progress: 100,
        loaded: true,
        cached: false,
        runtime: this.aiService.getCloudAccessLabel('xai', 'hosted'),
        source: 'cloud',
        provider: 'xai',
        cloudAccessMode: 'hosted',
        cloudModel: this.aiService.getChatModel('xai', 'hosted'),
        chatMode: 'messages',
      });
    }

    if (this.aiService.hasCloudChatAccessMode('openai', 'api-key')) {
      models.push({
        id: 'cloud-chat:openai',
        task: 'text-generation',
        name: this.aiService.getCloudModelDisplayName('openai', 'api-key'),
        description: 'Chat with OpenAI using your own API key.',
        size: 'Hosted API',
        loading: false,
        progress: 100,
        loaded: true,
        cached: false,
        runtime: this.aiService.getCloudAccessLabel('openai', 'api-key'),
        source: 'cloud',
        provider: 'openai',
        cloudAccessMode: 'api-key',
        cloudModel: this.aiService.getChatModel('openai', 'api-key'),
        chatMode: 'messages',
      });
    }

    return models;
  });
  readonly imageModels = computed<ModelInfo[]>(() => {
    const localImageModels = this.models().filter(model => model.task === 'image-generation' || model.task === 'image-upscaling');
    const preferredProvider = this.aiService.getActiveImageProvider();
    const providers: AiCloudProvider[] = ['xai', 'openai'];
    const sortedProviders = providers
      .filter(provider => this.aiService.hasCloudImageAccess(provider))
      .sort((left, right) => {
        if (left === preferredProvider) {
          return -1;
        }

        if (right === preferredProvider) {
          return 1;
        }

        return 0;
      });

    const cloudImageModels = sortedProviders.map<ModelInfo>(provider => ({
      id: `cloud-image:${provider}`,
      task: 'image-generation',
      name: `${this.aiService.getProviderLabel(provider)} Image`,
      description: `Generate images with ${this.aiService.getProviderLabel(provider)}.`,
      size: 'Hosted API',
      loading: false,
      progress: 100,
      loaded: true,
      cached: false,
      runtime: `${this.aiService.getProviderLabel(provider)} API`,
      source: 'cloud',
      provider,
      cloudModel: this.aiService.getImageModel(provider),
    }));

    return [...localImageModels, ...cloudImageModels];
  });
  readonly videoModels = computed<ModelInfo[]>(() => {
    if (!this.aiService.hasCloudVideoAccess('xai')) {
      return [];
    }

    return [{
      id: 'cloud-video:xai',
      task: 'video-generation',
      name: 'xAI / Grok Video',
      description: 'Generate videos with Grok Imagine Video.',
      size: 'Hosted API',
      loading: false,
      progress: 100,
      loaded: true,
      cached: false,
      runtime: 'xAI Video API',
      source: 'cloud',
      provider: 'xai',
      cloudModel: this.aiService.getVideoModel('xai'),
    }];
  });
  readonly voiceModels = computed<ModelInfo[]>(() => {
    const localVoiceModels = this.models().filter(model => model.task === 'text-to-speech');
    const cloudVoiceModels = this.aiService.hasCloudVoiceAccess('xai')
      ? [{
        id: 'cloud-voice:xai',
        task: 'text-to-speech',
        name: 'xAI / Grok Voice',
        description: 'Generate speech with xAI text-to-speech.',
        size: 'Hosted API',
        loading: false,
        progress: 100,
        loaded: true,
        cached: false,
        runtime: 'xAI Voice API',
        source: 'cloud' as const,
        provider: 'xai' as const,
        cloudModel: this.aiService.getVoiceModel('xai'),
      }]
      : [];

    return [...localVoiceModels, ...cloudVoiceModels];
  });
  readonly xAiModeOptions: ChoiceOption[] = [
    { value: 'text', label: 'Text' },
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' },
    { value: 'voice', label: 'Voice' },
  ];
  readonly xAiImageCountOptions: ChoiceOption[] = Array.from({ length: 10 }, (_, index) => ({
    value: String(index + 1),
    label: `${index + 1}`,
  }));
  readonly xAiVisualAspectRatioOptions: ChoiceOption[] = [
    { value: 'auto', label: 'Auto' },
    { value: '1:1', label: '1:1' },
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4' },
    { value: '3:2', label: '3:2' },
    { value: '2:3', label: '2:3' },
  ];
  readonly xAiImageExtendedAspectRatioOptions: ChoiceOption[] = [
    ...this.xAiVisualAspectRatioOptions,
    { value: '2:1', label: '2:1' },
    { value: '1:2', label: '1:2' },
    { value: '19.5:9', label: '19.5:9' },
    { value: '9:19.5', label: '9:19.5' },
    { value: '20:9', label: '20:9' },
    { value: '9:20', label: '9:20' },
  ];
  readonly openAiImageSizeOptions: ChoiceOption[] = [
    { value: 'auto', label: 'Auto' },
    { value: '1024x1024', label: '1024 square' },
    { value: '1536x1024', label: 'Landscape' },
    { value: '1024x1536', label: 'Portrait' },
    { value: '2048x2048', label: '2K square' },
    { value: '2048x1152', label: '2K landscape' },
    { value: '3840x2160', label: '4K landscape' },
    { value: '2160x3840', label: '4K portrait' },
  ];
  readonly openAiImageQualityOptions: ChoiceOption[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
  ];
  readonly xAiVideoDurationOptions: ChoiceOption[] = Array.from({ length: 15 }, (_, index) => ({
    value: String(index + 1),
    label: `${index + 1}s`,
  }));
  readonly xAiVoiceOptions: VoiceChoiceOption[] = [
    { value: 'ara', label: 'Ara', description: 'Upbeat Female' },
    { value: 'eve', label: 'Eve', description: 'Soothing Female' },
    { value: 'leo', label: 'Leo', description: 'British Male' },
    { value: 'rex', label: 'Rex', description: 'Calm Male' },
    { value: 'sal', label: 'Sal', description: 'Smooth Male' },
  ];
  readonly xAiVoiceLanguageOptions: ChoiceOption[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'en', label: 'English' },
    { value: 'es-ES', label: 'Spanish' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'ja', label: 'Japanese' },
    { value: 'pt-BR', label: 'Portuguese (BR)' },
  ];
  readonly xAiVoiceCodecOptions: ChoiceOption[] = [
    { value: 'mp3', label: 'MP3' },
    { value: 'wav', label: 'WAV' },
  ];
  readonly kokoroVoiceOptions: VoiceChoiceOption[] = [
    { value: 'af_heart', label: 'Heart', description: 'American Female' },
    { value: 'af_alloy', label: 'Alloy', description: 'American Female' },
    { value: 'af_aoede', label: 'Aoede', description: 'American Female' },
    { value: 'af_bella', label: 'Bella', description: 'American Female' },
    { value: 'af_jessica', label: 'Jessica', description: 'American Female' },
    { value: 'af_kore', label: 'Kore', description: 'American Female' },
    { value: 'af_nicole', label: 'Nicole', description: 'American Female' },
    { value: 'af_nova', label: 'Nova', description: 'American Female' },
    { value: 'af_river', label: 'River', description: 'American Female' },
    { value: 'af_sarah', label: 'Sarah', description: 'American Female' },
    { value: 'af_sky', label: 'Sky', description: 'American Female' },
    { value: 'am_adam', label: 'Adam', description: 'American Male' },
    { value: 'am_echo', label: 'Echo', description: 'American Male' },
    { value: 'am_eric', label: 'Eric', description: 'American Male' },
    { value: 'am_fenrir', label: 'Fenrir', description: 'American Male' },
    { value: 'am_liam', label: 'Liam', description: 'American Male' },
    { value: 'am_michael', label: 'Michael', description: 'American Male' },
    { value: 'am_onyx', label: 'Onyx', description: 'American Male' },
    { value: 'am_puck', label: 'Puck', description: 'American Male' },
    { value: 'am_santa', label: 'Santa', description: 'American Male' },
    { value: 'bf_alice', label: 'Alice', description: 'British Female' },
    { value: 'bf_emma', label: 'Emma', description: 'British Female' },
    { value: 'bf_isabella', label: 'Isabella', description: 'British Female' },
    { value: 'bf_lily', label: 'Lily', description: 'British Female' },
    { value: 'bm_daniel', label: 'Daniel', description: 'British Male' },
    { value: 'bm_fable', label: 'Fable', description: 'British Male' },
    { value: 'bm_george', label: 'George', description: 'British Male' },
    { value: 'bm_lewis', label: 'Lewis', description: 'British Male' },
  ];
  readonly supertonicVoiceOptions: VoiceChoiceOption[] = [
    { value: 'F1', label: 'Calm', description: 'Female' },
    { value: 'F2', label: 'Cheerful', description: 'Female' },
    { value: 'F3', label: 'Professional', description: 'Female' },
    { value: 'F4', label: 'Confident', description: 'Female' },
    { value: 'F5', label: 'Gentle', description: 'Female' },
    { value: 'M1', label: 'Energetic', description: 'Male' },
    { value: 'M2', label: 'Deep', description: 'Male' },
    { value: 'M3', label: 'Authoritative', description: 'Male' },
    { value: 'M4', label: 'Friendly', description: 'Male' },
    { value: 'M5', label: 'Storyteller', description: 'Male' },
  ];
  readonly supertonicLanguageOptions: ChoiceOption[] = [
    { value: 'en', label: 'English' },
    { value: 'ko', label: 'Korean' },
    { value: 'es', label: 'Spanish' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'fr', label: 'French' },
  ];
  readonly localVoiceSpeedOptions: ChoiceOption[] = [
    { value: '0.5', label: '0.5x' },
    { value: '0.75', label: '0.75x' },
    { value: '1', label: '1.0x' },
    { value: '1.25', label: '1.25x' },
    { value: '1.5', label: '1.5x' },
    { value: '1.75', label: '1.75x' },
    { value: '2', label: '2.0x' },
  ];
  readonly piperVoiceOptions: ChoiceOption[] = Array.from({ length: 904 }, (_, index) => ({
    value: String(index),
    label: `Voice ${index + 1}`,
  }));
  readonly audioWaveformBars = Array.from({ length: 24 }, (_, index) => index + 1);
  readonly composerModels = computed(() => [
    ...this.localChatModels(),
    ...this.cloudChatModels(),
    ...this.imageModels(),
    ...this.videoModels(),
    ...this.voiceModels(),
  ]);
  readonly visibleComposerModels = computed(() => {
    if (this.isVoiceGenerationMode()) {
      return this.voiceModels();
    }

    if (this.isVideoGenerationMode()) {
      return this.videoModels();
    }

    if (this.isImageMode()) {
      return this.imageModels();
    }

    return [
      ...this.localChatModels(),
      ...this.cloudChatModels(),
    ];
  });
  readonly selectedModelId = signal(this.webGpuAvailable ? 'onnx-community/gemma-4-E2B-it-ONNX' : 'Xenova/distilgpt2');
  readonly selectedModel = computed(() => this.composerModels().find(model => model.id === this.selectedModelId()) ?? null);
  readonly isXAiTextMode = computed(() => this.selectedModel()?.provider === 'xai' && this.selectedModel()?.source === 'cloud' && this.selectedModel()?.task === 'text-generation');
  readonly isOpenAiImageGenerationMode = computed(() => this.selectedModel()?.provider === 'openai' && this.selectedModel()?.source === 'cloud' && this.selectedModel()?.task === 'image-generation');
  readonly isImageGenerationMode = computed(() => this.selectedModel()?.task === 'image-generation');
  readonly isImageUpscalingMode = computed(() => this.selectedModel()?.task === 'image-upscaling');
  readonly isVideoGenerationMode = computed(() => this.selectedModel()?.task === 'video-generation');
  readonly isVoiceGenerationMode = computed(() => this.selectedModel()?.task === 'text-to-speech');
  readonly isXAiVoiceGenerationMode = computed(() => this.selectedModel()?.provider === 'xai' && this.selectedModel()?.task === 'text-to-speech');
  readonly isKokoroVoiceGenerationMode = computed(() => this.selectedModelId() === this.aiService.kokoroSpeechModelId);
  readonly isPiperVoiceGenerationMode = computed(() => this.selectedModelId() === this.aiService.piperSpeechModelId);
  readonly isSupertonicVoiceGenerationMode = computed(() => this.selectedModelId() === this.aiService.supertonicSpeechModelId);
  readonly hasVoiceControls = computed(() => this.isVoiceGenerationMode());
  readonly isImageMode = computed(() => this.isImageGenerationMode() || this.isImageUpscalingMode());
  readonly isVisualGenerationMode = computed(() => this.isImageMode() || this.isVideoGenerationMode());
  readonly isGeneratedMediaMode = computed(() => this.isVisualGenerationMode() || this.isVoiceGenerationMode());
  readonly hasXAiChatTypePicker = computed(() => this.cloudChatModels().some(model => model.provider === 'xai'));
  readonly isXAiComposerMode = computed(() => this.selectedModel()?.provider === 'xai' && this.selectedModel()?.source === 'cloud' && (this.isXAiTextMode() || this.isImageGenerationMode() || this.isVideoGenerationMode() || this.isVoiceGenerationMode()));
  readonly composerPlaceholder = computed(() => {
    const compact = this.narrowHistoryMode();

    if (this.isImageUpscalingMode()) {
      return compact ? 'Attach image' : 'Attach one image to upscale';
    }

    if (this.isImageGenerationMode()) {
      return compact ? 'Describe image' : 'Describe the image you want to create';
    }

    if (this.isVideoGenerationMode()) {
      if (this.xAiVideoMode() === 'extend-video') {
        return compact ? 'Describe next scene' : 'Attach one video and describe what happens next';
      }

      return compact ? 'Describe video' : 'Describe the video you want to create, or attach an image or video as source material';
    }

    if (this.isVoiceGenerationMode()) {
      return compact ? 'Write script' : 'Paste or write the script you want spoken aloud';
    }

    return compact ? 'Ask anything' : 'Ask anything or use #fetch example.com';
  });
  readonly currentXAiMode = computed<XAiComposerMode>(() => this.isVoiceGenerationMode() ? 'voice' : this.isVideoGenerationMode() ? 'video' : this.isImageGenerationMode() ? 'image' : 'text');
  readonly currentXAiModeLabel = computed(() => this.xAiModeOptions.find(option => option.value === this.currentXAiMode())?.label ?? 'Text');
  readonly isXAiImageQualityMode = computed(() => this.cloudSettings().xaiImageResolution === '2k');
  readonly xAiImageModeLabel = computed(() => this.isXAiImageQualityMode() ? 'Quality' : 'Speed');
  readonly xAiImageCountLabel = computed(() => {
    const count = this.aiService.cloudSettings().xaiImageCount;
    return `${count} image${count === 1 ? '' : 's'}`;
  });
  readonly xAiImageAspectRatioLabel = computed(() => this.aiService.cloudSettings().xaiImageAspectRatio || 'Auto');
  readonly openAiImageCountLabel = computed(() => {
    const count = this.aiService.cloudSettings().openaiImageCount;
    return `${count} image${count === 1 ? '' : 's'}`;
  });
  readonly openAiImageSizeLabel = computed(() => this.openAiImageSizeOptions.find(option => option.value === this.aiService.cloudSettings().openaiImageSize)?.label ?? this.aiService.cloudSettings().openaiImageSize);
  readonly openAiImageQualityLabel = computed(() => this.openAiImageQualityOptions.find(option => option.value === this.aiService.cloudSettings().openaiImageQuality)?.label ?? 'Auto');
  readonly xAiVideoAspectRatioLabel = computed(() => this.aiService.cloudSettings().xaiVideoAspectRatio || 'Auto');
  readonly xAiVideoDurationLabel = computed(() => `${this.aiService.cloudSettings().xaiVideoDuration}s`);
  readonly xAiVoiceLabel = computed(() => this.xAiVoiceOptions.find(option => option.value === this.aiService.cloudSettings().xaiVoiceId)?.label ?? 'Eve');
  readonly xAiVoiceLanguageLabel = computed(() => this.xAiVoiceLanguageOptions.find(option => option.value === this.aiService.cloudSettings().xaiVoiceLanguage)?.label ?? 'English');
  readonly xAiVoiceCodecLabel = computed(() => this.xAiVoiceCodecOptions.find(option => option.value === this.aiService.cloudSettings().xaiVoiceCodec)?.label ?? 'MP3');
  readonly kokoroVoiceLabel = computed(() => this.kokoroVoiceOptions.find(option => option.value === this.aiService.cloudSettings().kokoroVoiceId)?.label ?? this.aiService.cloudSettings().kokoroVoiceId);
  readonly kokoroVoiceSpeedLabel = computed(() => `${this.aiService.cloudSettings().kokoroVoiceSpeed.toFixed(1)}x`);
  readonly piperVoiceLabel = computed(() => `Voice ${this.aiService.cloudSettings().piperVoiceId + 1}`);
  readonly piperVoiceSpeedLabel = computed(() => `${this.aiService.cloudSettings().piperVoiceSpeed.toFixed(1)}x`);
  readonly supertonicVoiceLabel = computed(() => this.supertonicVoiceOptions.find(option => option.value === this.aiService.cloudSettings().supertonicVoiceId)?.label ?? this.aiService.cloudSettings().supertonicVoiceId);
  readonly supertonicVoiceSpeedLabel = computed(() => `${this.aiService.cloudSettings().supertonicVoiceSpeed.toFixed(1)}x`);
  readonly supertonicLanguageLabel = computed(() => this.supertonicLanguageOptions.find(option => option.value === this.aiService.cloudSettings().supertonicLanguage)?.label ?? 'English');
  readonly activeVoiceLabel = computed(() => {
    if (this.isXAiVoiceGenerationMode()) {
      return this.xAiVoiceLabel();
    }

    if (this.isKokoroVoiceGenerationMode()) {
      return this.kokoroVoiceLabel();
    }

    if (this.isPiperVoiceGenerationMode()) {
      return this.piperVoiceLabel();
    }

    if (this.isSupertonicVoiceGenerationMode()) {
      return this.supertonicVoiceLabel();
    }

    return 'Default';
  });
  readonly activeVoiceSpeedLabel = computed(() => {
    if (this.isKokoroVoiceGenerationMode()) {
      return this.kokoroVoiceSpeedLabel();
    }

    if (this.isPiperVoiceGenerationMode()) {
      return this.piperVoiceSpeedLabel();
    }

    if (this.isSupertonicVoiceGenerationMode()) {
      return this.supertonicVoiceSpeedLabel();
    }

    return '1.0x';
  });
  readonly activeQuickPrompts = computed(() => {
    if (this.isImageGenerationMode()) {
      return this.imageQuickPrompts;
    }

    if (this.isVideoGenerationMode()) {
      return this.videoQuickPrompts;
    }

    if (this.isVoiceGenerationMode()) {
      return this.voiceQuickPrompts;
    }

    if (this.isImageUpscalingMode()) {
      return this.upscalingQuickPrompts;
    }

    return this.chatQuickPrompts;
  });
  readonly histories = this.historyService.histories;
  readonly unavailableGeneratedImageIds = signal<Set<string>>(new Set());
  readonly filteredHistories = computed(() => {
    const query = this.historyQuery().trim().toLowerCase();
    if (!query) {
      return this.histories();
    }

    return this.histories().filter(entry => {
      const searchTarget = [
        entry.title,
        entry.modelName,
        ...entry.messages.map(message => message.content),
      ].join(' ').toLowerCase();
      return searchTarget.includes(query);
    });
  });
  readonly showHistoryPanel = computed(() => !this.hideHistoryRail() || this.showHistoryDrawer());
  readonly showChatPanel = computed(() => !this.narrowHistoryMode() || !this.showHistoryDrawer());
  readonly activeHistory = computed(() => this.histories().find(entry => entry.id === this.currentConversationId()) ?? null);
  readonly conversationMessageCount = computed(() => this.conversation().filter(message => message.content.trim().length > 0).length);
  readonly conversationAttachmentCount = computed(() => this.conversation().reduce((total, message) => total + (message.attachments?.length ?? 0), 0));
  readonly currentConversationTitle = computed(() => this.activeHistory()?.title ?? 'New local chat');
  readonly canRetryLastReply = computed(() => {
    if (this.isGenerating() || this.selectedModel()?.chatDisabledReason || this.isGeneratedMediaMode()) {
      return false;
    }

    const lastMessage = this.conversation().at(-1);
    return lastMessage?.role === 'assistant' && !lastMessage.generatedImages?.length && !lastMessage.generatedVideos?.length && !lastMessage.generatedAudios?.length;
  });
  readonly chatQuickPrompts: AiQuickPrompt[] = [
    { label: 'Draft a post', prompt: 'Draft a post about [topic].' },
    { label: 'Draft an article', prompt: 'Draft an article for me about [topic] and add hashtags at the bottom.' },
    { label: 'Create an image', prompt: 'Create an image about [topic].', task: 'image-generation' },
    { label: 'Fetch a page', prompt: '#fetch https://nostria.app' },
    { label: 'Explain code', prompt: 'Explain this code change in simple terms.' },
    { label: 'Brainstorm', prompt: 'Brainstorm improvements for this product flow.' },
  ];
  readonly imageQuickPrompts: AiQuickPrompt[] = [
    { label: 'Album artwork', prompt: 'Design a bold album cover for an independent electronic release with geometric light trails and a cinematic atmosphere.' },
    { label: 'Product hero', prompt: 'Create a premium product hero image for a futuristic social app running on glass screens in a bright studio scene.' },
    { label: 'Poster concept', prompt: 'Generate a contemporary poster illustration for a Nostr community event with layered typography and editorial texture.' },
  ];
  readonly videoQuickPrompts: AiQuickPrompt[] = [
    { label: 'Launch scene', prompt: 'Create a cinematic launch video of [subject].', task: 'video-generation' },
    { label: 'Product teaser', prompt: 'Create a short product teaser video for [product].', task: 'video-generation' },
    { label: 'Ambient loop', prompt: 'Create a short ambient loop of [scene].', task: 'video-generation' },
    { label: 'Animate image', prompt: 'Animate the attached image into a short video.', task: 'video-generation' },
  ];
  readonly voiceQuickPrompts: AiQuickPrompt[] = [
    { label: 'Trailer VO', prompt: 'Welcome to Nostria - Your Social Network. Built for human connections. See your friends again. Nostria is social without the noise.', task: 'voice-generation' },
    { label: 'Warm narration', prompt: 'Welcome to Nostria. A calmer place to follow your friends, share what matters, and stay connected without the noise.', task: 'voice-generation' },
    { label: 'Fast teaser', prompt: 'New post. New voice. Same open network. Nostria helps you create, share, and connect in seconds.', task: 'voice-generation' },
  ];
  readonly upscalingQuickPrompts: AiQuickPrompt[] = [
    { label: 'Enhance artwork', prompt: 'Upscale the attached artwork while keeping clean edges and fine line detail.' },
    { label: 'Sharpen photo', prompt: 'Upscale the attached photo and preserve natural textures.' },
    { label: 'Improve screenshot', prompt: 'Upscale the attached screenshot while keeping UI text crisp.' },
  ];
  readonly conversation = signal<ConversationMessage[]>([]);
  readonly composerText = signal('');
  readonly isGenerating = signal(false);
  readonly voiceSettingsPanelOpen = signal(false);
  readonly isDictating = this.speechService.isRecording;
  readonly isDictationTranscribing = this.speechService.isTranscribing;
  readonly audioPlayback = signal<Record<string, AudioPlaybackState>>({});
  readonly xAiVideoMode = signal<'generate' | 'extend-video'>('generate');
  readonly activeVideoOperation = signal<'generate' | 'animate' | 'reference' | 'edit' | 'extend' | null>(null);
  readonly activeVideoStartedAt = signal<number | null>(null);
  readonly activeVideoStatus = signal<AiVideoGenerationProgress['status'] | null>(null);
  readonly activeVideoProgress = signal<number | null>(null);
  readonly statusClock = signal(Date.now());
  readonly chatError = signal('');
  readonly workerProcessingState = this.aiService.processingState;
  readonly workerTaskLabel = computed(() => this.aiService.getTaskName(this.workerProcessingState().task));
  readonly activeModelProgress = computed(() => {
    const model = this.selectedModel();
    if (model?.loading) {
      const progress = Math.max(0, Math.min(94, Math.round(model.progress)));
      return progress > 0 ? progress : null;
    }

    return null;
  });
  readonly activeProcessingProgress = computed(() => this.activeModelProgress() ?? this.activeVideoProgress());
  readonly processingStatusLabel = computed(() => {
    const model = this.selectedModel();
    if (model?.loading) {
      return model.cached ? `Loading ${model.name}...` : `Downloading ${model.name}...`;
    }

    const videoStatus = this.activeVideoStatus();
    if (videoStatus) {
      return `Grok video ${videoStatus}`;
    }

    switch (this.activeVideoOperation()) {
      case 'animate':
        return 'Animating image into Grok video...';
      case 'reference':
        return 'Generating Grok video from references...';
      case 'edit':
        return 'Editing Grok video...';
      case 'extend':
        return 'Extending Grok video...';
      case 'generate':
        return 'Generating Grok video...';
    }

    return this.workerTaskLabel() || (this.isGenerating() ? 'Processing...' : '');
  });
  readonly processingStatusText = computed(() => this.processingStatusLabel().replace(/\.{3}$/, '').trim());
  readonly hasImageVideoInput = computed(() => this.isVideoGenerationMode()
    && this.xAiVideoMode() !== 'extend-video'
    && this.attachedFiles().some(attachment => attachment.mimeType.startsWith('image/')));
  readonly activeVideoElapsedLabel = computed(() => {
    const startedAt = this.activeVideoStartedAt();
    if (!startedAt) {
      return '';
    }

    const elapsedSeconds = Math.max(0, Math.floor((this.statusClock() - startedAt) / 1000));
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });
  readonly videoProcessingHint = computed(() => {
    const operation = this.activeVideoOperation();
    if (!operation) {
      return '';
    }

    const elapsed = this.activeVideoElapsedLabel();
    const prefix = elapsed ? `${elapsed} elapsed` : 'Working';
    const status = this.activeVideoStatus();
    const progress = this.activeVideoProgress();
    const statusText = status ? ` Status: ${status}${progress === null ? '' : ` ${progress}%`}.` : '';
    return `${prefix}.${statusText} xAI video jobs are asynchronous and can take several minutes.`;
  });
  readonly hasInlineStreamingIndicator = computed(() => this.conversation().some(
    message => message.role === 'assistant'
      && !!message.streaming
      && !message.content.trim().length
      && !(message.generatedImages?.length ?? 0)
      && !(message.generatedVideos?.length ?? 0)
      && !(message.generatedAudios?.length ?? 0)
  ));
  readonly showProcessingStatus = computed(() => {
    const busy = this.workerProcessingState().isProcessing || !!this.selectedModel()?.loading || this.isGenerating();
    return busy && !this.hasInlineStreamingIndicator();
  });
  readonly canSend = computed(() => {
    const model = this.selectedModel();
    if (!model || this.isGenerating()) {
      return false;
    }

    if (model.chatDisabledReason) {
      return false;
    }

    return this.composerText().trim().length > 0 || this.attachedFiles().length > 0;
  });
  constructor() {
    if (this.isBrowser) {
      const intervalId = window.setInterval(() => {
        this.statusClock.set(Date.now());
      }, 1000);
      this.destroyRef.onDestroy(() => window.clearInterval(intervalId));
    }

    this.breakpointObserver.observe('(max-width: 1120px)').pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      this.narrowHistoryMode.set(result.matches);
      if (!result.matches) {
        this.showHistoryDrawer.set(false);
      }
    });

    effect(() => {
      this.conversation();
      this.isGenerating();

      if (!this.isBrowser || !this.autoScrollPinned()) {
        return;
      }

      this.scrollConversationToEnd(this.isGenerating() ? 'auto' : 'smooth');
    });

    effect(() => {
      if (!this.isBrowser) {
        return;
      }

      const assistantMessages = this.conversation().filter(message => message.role === 'assistant');
      const activeIds = new Set(assistantMessages.map(message => message.id));

      this.renderedAssistantMessages.update(rendered => {
        const next = { ...rendered };
        for (const key of Object.keys(next)) {
          if (!activeIds.has(key)) {
            delete next[key];
            this.renderedAssistantSource.delete(key);
            this.renderedAssistantVersion.delete(key);
          }
        }
        return next;
      });

      for (const message of assistantMessages) {
        if (this.renderedAssistantSource.get(message.id) === message.content) {
          continue;
        }

        this.renderedAssistantSource.set(message.id, message.content);
        const nextVersion = (this.renderedAssistantVersion.get(message.id) ?? 0) + 1;
        this.renderedAssistantVersion.set(message.id, nextVersion);

        const sections = this.parseAssistantMessageContent(message.content);
        const suggestionLayout = this.parseAssistantSuggestions(sections.answer);
        const initialRendered: RenderedAssistantContent = {
          thinking: this.renderAssistantSection(message.id, nextVersion, 'thinking', sections.thinking),
          answer: suggestionLayout ? null : this.renderAssistantSection(message.id, nextVersion, 'answer', sections.answer),
          suggestionIntro: suggestionLayout
            ? this.renderAssistantSection(message.id, nextVersion, 'suggestionIntro', suggestionLayout.intro)
            : null,
          suggestionOutro: suggestionLayout
            ? this.renderAssistantSection(message.id, nextVersion, 'suggestionOutro', suggestionLayout.outro)
            : null,
          suggestions: suggestionLayout
            ? suggestionLayout.suggestions.map(suggestion => ({
              ...suggestion,
              renderedContent: this.renderAssistantSuggestion(message.id, nextVersion, suggestion),
            }))
            : [],
        };

        this.renderedAssistantMessages.update(rendered => ({
          ...rendered,
          [message.id]: initialRendered,
        }));
      }
    });

    effect(() => {
      const hasApiKeyAccess = this.cloudChatModels().some(model => model.provider === 'xai' && model.cloudAccessMode === 'api-key');
      const hasHostedAccess = this.cloudChatModels().some(model => model.provider === 'xai' && model.cloudAccessMode === 'hosted');
      const preferred = this.preferredXAiChatAccessMode();

      if (preferred === 'api-key' && !hasApiKeyAccess && hasHostedAccess) {
        this.preferredXAiChatAccessMode.set('hosted');
      } else if (preferred === 'hosted' && !hasHostedAccess && hasApiKeyAccess) {
        this.preferredXAiChatAccessMode.set('api-key');
      }
    });

    effect(() => {
      const selection = this.aiService.queuedStandardPrompt();
      if (!selection) {
        return;
      }

      untracked(() => {
        const currentModel = this.selectedModel();
        if (!currentModel || !this.isChatGenerationTask(currentModel.task)) {
          const chatModel = this.composerModels().find(model => this.isChatGenerationTask(model.task) && !model.chatDisabledReason)
            ?? this.composerModels().find(model => this.isChatGenerationTask(model.task));

          if (chatModel) {
            this.selectedModelId.set(chatModel.id);
          }
        }

        this.showHistoryDrawer.set(false);
        this.applyChatPrompt(selection.prompt);
        this.aiService.clearQueuedStandardPrompt();
      });
    });

    void this.initializeModelStatus();

    if (this.isBrowser) {
      void Promise.resolve().then(() => this.openFirstRunAiDialogIfNeeded());
    }
  }

  async openAiInfoDialog(): Promise<void> {
    await this.showAiInfoDialog(false);
  }

  private async openFirstRunAiDialogIfNeeded(): Promise<void> {
    if (this.hasSeenAiInfoDialog()) {
      return;
    }

    this.markAiInfoDialogSeen();

    await this.showAiInfoDialog(true);
  }

  private async showAiInfoDialog(firstRun: boolean): Promise<void> {
    const dialogRef = this.customDialog.open<AiInfoDialogComponent, AiInfoDialogResult>(AiInfoDialogComponent, {
      width: 'min(680px, calc(100vw - 24px))',
      maxWidth: 'calc(100vw - 24px)',
      data: {
        firstRun,
        showSettingsAction: true,
      },
    });

    const result = (await firstValueFrom(dialogRef.afterClosed$)).result;
    if (result === 'settings') {
      this.openSettingsPanel();
    }
  }

  private hasSeenAiInfoDialog(): boolean {
    const pubkey = this.accountState.pubkey();
    if (pubkey && this.accountLocalState.getAiDisclaimerSeen(pubkey)) {
      return true;
    }

    return this.localStorage.getItem(AiComponent.AI_INFO_SEEN_STORAGE_KEY) === 'true';
  }

  private markAiInfoDialogSeen(): void {
    this.localStorage.setItem(AiComponent.AI_INFO_SEEN_STORAGE_KEY, 'true');

    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setAiDisclaimerSeen(pubkey, true);
    }
  }

  openSettingsPanel(): void {
    this.showHistoryDrawer.set(false);
    this.layout.navigateToRightPanel('ai/settings');
  }

  setShareTarget(message: ConversationMessage): void {
    this.activeShareMessage.set(message);
  }

  setActiveGeneratedImage(image: AiGeneratedImage): void {
    this.activeGeneratedImage.set(image);
  }

  setActiveGeneratedVideo(video: AiGeneratedVideo): void {
    this.activeGeneratedVideo.set(video);
  }

  setActiveGeneratedAudio(audio: AiGeneratedAudio): void {
    this.activeGeneratedAudio.set(audio);
  }

  setActiveSuggestion(suggestion: AssistantSuggestion): void {
    this.activeSuggestion.set(suggestion);
  }

  createNewChat(): void {
    this.releaseGeneratedVideoUrls(this.conversation().flatMap(message => message.generatedVideos ?? []));
    this.releaseGeneratedAudioUrls(this.conversation().flatMap(message => message.generatedAudios ?? []));
    this.currentConversationId.set(null);
    this.activeGeneratedImage.set(null);
    this.activeGeneratedVideo.set(null);
    this.activeGeneratedAudio.set(null);
    this.clearAttachedFiles();
    this.showHistoryDrawer.set(false);
    this.clearConversation();
  }

  async openHistory(historyId: string): Promise<void> {
    const history = this.historyService.getHistory(historyId);
    if (!history) {
      this.snackBar.open('That AI chat could not be found.', 'Dismiss', { duration: 4000 });
      return;
    }

    const resolvedModelId = this.resolveModelId(history.modelId);
    if (resolvedModelId) {
      this.selectModel(resolvedModelId);
    }

    this.currentConversationId.set(history.id);
    this.chatError.set('');
    this.activeGeneratedImage.set(null);
    this.activeGeneratedVideo.set(null);
    this.activeGeneratedAudio.set(null);
    this.clearAttachedFiles();
    this.autoScrollPinned.set(true);
    this.showHistoryDrawer.set(false);
    this.releaseGeneratedVideoUrls(this.conversation().flatMap(message => message.generatedVideos ?? []));
    this.releaseGeneratedAudioUrls(this.conversation().flatMap(message => message.generatedAudios ?? []));
    this.conversation.set(await Promise.all(history.messages.map(async message => ({
      id: this.createMessageId(),
      role: message.role,
      content: message.content,
      processingDurationMs: message.processingDurationMs,
      generatedImages: message.generatedImages?.length
        ? await this.restoreGeneratedImages(message.generatedImages)
        : undefined,
      generatedVideos: message.generatedVideos?.length
        ? await this.restoreGeneratedVideos(message.generatedVideos)
        : undefined,
      generatedAudios: message.generatedAudios?.length
        ? await this.restoreGeneratedAudios(message.generatedAudios)
        : undefined,
    }))));
  }

  selectModel(modelId: string): void {
    const model = this.composerModels().find(candidate => candidate.id === modelId);
    if (!model) {
      return;
    }

    if (model.provider === 'xai' && model.task === 'text-generation' && model.source === 'cloud') {
      this.preferredXAiChatAccessMode.set(model.cloudAccessMode === 'hosted' ? 'hosted' : 'api-key');
    }

    this.selectedModelId.set(model.id);
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }

    event.preventDefault();
    if (this.canSend()) {
      void this.sendMessage();
    }
  }

  toggleHistoryPanel(): void {
    if (!this.narrowHistoryMode()) {
      return;
    }

    this.showHistoryDrawer.update(value => !value);
  }

  openImageSettings(): void {
    this.openSettingsPanel();
  }

  selectGrokMode(mode: XAiComposerMode): void {
    const model = mode === 'text'
      ? this.getPreferredXAiTextModel()
      : mode === 'image'
        ? this.imageModels().find(candidate => candidate.task === 'image-generation' && candidate.provider === 'xai')
        : mode === 'video'
          ? this.videoModels().find(candidate => candidate.task === 'video-generation' && candidate.provider === 'xai')
          : this.voiceModels().find(candidate => candidate.task === 'text-to-speech' && candidate.provider === 'xai');

    if (model) {
      this.selectedModelId.set(model.id);
    }
  }

  updateXAiImageCount(value: string | number): void {
    this.aiService.updateCloudSettings({ xaiImageCount: this.parsePositiveInt(value, this.aiService.cloudSettings().xaiImageCount) });
  }

  updateXAiImageResolution(value: string): void {
    this.aiService.updateCloudSettings({ xaiImageResolution: value === '2k' ? '2k' : '1k' });
  }

  setXAiImageGenerationMode(mode: 'speed' | 'quality'): void {
    this.updateXAiImageResolution(mode === 'quality' ? '2k' : '1k');
  }

  updateOpenAiImageCount(value: string | number): void {
    this.aiService.updateCloudSettings({ openaiImageCount: this.parsePositiveInt(value, this.aiService.cloudSettings().openaiImageCount) });
  }

  updateOpenAiImageSize(value: string): void {
    this.aiService.updateCloudSettings({ openaiImageSize: value.trim() || this.aiService.cloudSettings().openaiImageSize });
  }

  updateOpenAiImageQuality(value: string): void {
    this.aiService.updateCloudSettings({ openaiImageQuality: value.trim() || this.aiService.cloudSettings().openaiImageQuality });
  }

  updateXAiImageAspectRatio(value: string): void {
    this.aiService.updateCloudSettings({ xaiImageAspectRatio: value.trim() || this.aiService.cloudSettings().xaiImageAspectRatio });
  }

  updateXAiVideoDuration(value: string | number): void {
    this.aiService.updateCloudSettings({ xaiVideoDuration: this.parsePositiveInt(value, this.aiService.cloudSettings().xaiVideoDuration) });
  }

  updateXAiVideoResolution(value: string): void {
    this.aiService.updateCloudSettings({ xaiVideoResolution: value === '720p' ? '720p' : '480p' });
  }

  updateXAiVideoAspectRatio(value: string): void {
    this.aiService.updateCloudSettings({ xaiVideoAspectRatio: value.trim() || this.aiService.cloudSettings().xaiVideoAspectRatio });
  }

  updateXAiVoiceId(value: string): void {
    this.aiService.updateCloudSettings({ xaiVoiceId: value.trim() || this.aiService.cloudSettings().xaiVoiceId });
  }

  updateXAiVoiceLanguage(value: string): void {
    this.aiService.updateCloudSettings({ xaiVoiceLanguage: value.trim() || this.aiService.cloudSettings().xaiVoiceLanguage });
  }

  updateXAiVoiceCodec(value: 'mp3' | 'wav'): void {
    this.aiService.updateCloudSettings({ xaiVoiceCodec: value === 'wav' ? 'wav' : 'mp3' });
  }

  updateKokoroVoiceId(value: string): void {
    this.aiService.updateCloudSettings({ kokoroVoiceId: value.trim() || this.aiService.cloudSettings().kokoroVoiceId });
  }

  updateKokoroVoiceSpeed(value: string | number): void {
    this.aiService.updateCloudSettings({ kokoroVoiceSpeed: this.parseBoundedNumber(value, this.aiService.cloudSettings().kokoroVoiceSpeed, 0.5, 2) });
  }

  updatePiperVoiceId(value: string | number): void {
    const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
    this.aiService.updateCloudSettings({
      piperVoiceId: Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), 0), 903) : this.aiService.cloudSettings().piperVoiceId,
    });
  }

  updatePiperVoiceSpeed(value: string | number): void {
    this.aiService.updateCloudSettings({ piperVoiceSpeed: this.parseBoundedNumber(value, this.aiService.cloudSettings().piperVoiceSpeed, 0.5, 2) });
  }

  updateSupertonicVoiceId(value: string): void {
    this.aiService.updateCloudSettings({ supertonicVoiceId: value.trim() || this.aiService.cloudSettings().supertonicVoiceId });
  }

  updateSupertonicVoiceSpeed(value: string | number): void {
    this.aiService.updateCloudSettings({ supertonicVoiceSpeed: this.parseBoundedNumber(value, this.aiService.cloudSettings().supertonicVoiceSpeed, 0.5, 2) });
  }

  updateSupertonicLanguage(value: string): void {
    this.aiService.updateCloudSettings({ supertonicLanguage: value.trim() || this.aiService.cloudSettings().supertonicLanguage });
  }

  toggleVoiceSettingsPanel(): void {
    this.voiceSettingsPanelOpen.update(value => !value);
  }

  async togglePromptDictation(): Promise<void> {
    if (!this.isBrowser || this.isGenerating()) {
      return;
    }

    await this.speechService.toggleRecording({
      onTranscription: text => {
        const current = this.composerText().trimEnd();
        this.composerText.set(current ? `${current} ${text}` : text);
        this.focusComposerPromptPlaceholder(this.composerText());
      },
    });
  }

  setXAiVideoMode(mode: 'generate' | 'extend-video'): void {
    this.xAiVideoMode.set(mode);
  }

  openAttachmentPicker(): void {
    this.attachmentInputRef()?.nativeElement.click();
  }

  stopGeneration(): void {
    if (!this.isGenerating()) {
      return;
    }

    this.chatError.set('');
    this.aiService.stopActiveGeneration();
  }

  async onAttachmentSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      return;
    }

    try {
      const attachments = await Promise.all(files.map(file => this.createAttachment(file)));
      this.attachedFiles.update(existing => [...existing, ...attachments]);
    } catch (err) {
      this.logger.error('AI attachment read error:', err);
      this.snackBar.open('Failed to attach one or more files.', 'Dismiss', { duration: 4000 });
    } finally {
      input.value = '';
    }
  }

  removeAttachment(id: string): void {
    this.attachedFiles.update(attachments => {
      const removed = attachments.find(attachment => attachment.id === id);
      this.releaseAttachmentPreviewUrls(removed ? [removed] : undefined);
      return attachments.filter(attachment => attachment.id !== id);
    });
  }

  applyChatPrompt(prompt: string): void {
    this.composerText.set(prompt);
    this.focusComposerPromptPlaceholder(prompt);
  }

  applyImagePrompt(prompt: string): void {
    const imageModel = this.imageModels().find(model => model.task === 'image-generation');
    if (imageModel) {
      this.selectedModelId.set(imageModel.id);
    }

    this.composerText.set(prompt);
    this.focusComposerPromptPlaceholder(prompt);
  }

  applyVideoPrompt(prompt: string): void {
    const videoModel = this.videoModels().find(model => model.task === 'video-generation');
    if (videoModel) {
      this.selectedModelId.set(videoModel.id);
    }

    this.composerText.set(prompt);
    this.focusComposerPromptPlaceholder(prompt);
  }

  applyVoicePrompt(prompt: string, audio?: AiGeneratedAudio): void {
    const voiceModel = audio
      ? this.resolveVoiceModelForAudio(audio)
      : this.voiceModels().find(model => model.task === 'text-to-speech');
    if (voiceModel) {
      if (audio) {
        this.applyVoiceSettingsFromAudio(audio);
      }
      this.selectedModelId.set(voiceModel.id);
    }

    this.composerText.set(prompt);
    this.focusComposerPromptPlaceholder(prompt);
  }

  async regenerateVoice(audio: AiGeneratedAudio): Promise<void> {
    const voiceModel = this.resolveVoiceModelForAudio(audio);
    if (!voiceModel || this.isGenerating()) {
      return;
    }

    this.applyVoiceSettingsFromAudio(audio);
    this.selectedModelId.set(voiceModel.id);
    this.composerText.set('');
    await this.generateVoiceMessage(voiceModel, audio.prompt);
  }

  useAudioPromptInComposer(audio: AiGeneratedAudio): void {
    this.applyVoicePrompt(audio.prompt, audio);
  }

  private resolveVoiceModelForAudio(audio: AiGeneratedAudio): ModelInfo | undefined {
    const modelId = audio.voiceSettings?.modelId || audio.model;
    return this.voiceModels().find(model => model.id === modelId)
      ?? this.voiceModels().find(model => model.task === 'text-to-speech');
  }

  private applyVoiceSettingsFromAudio(audio: AiGeneratedAudio): void {
    const settings = audio.voiceSettings;
    if (!settings) {
      return;
    }

    if (settings.provider === 'xai') {
      this.aiService.updateCloudSettings({
        xaiVoiceId: typeof settings.voice === 'string' ? settings.voice : this.aiService.cloudSettings().xaiVoiceId,
        xaiVoiceLanguage: settings.language || this.aiService.cloudSettings().xaiVoiceLanguage,
        xaiVoiceCodec: settings.codec === 'wav' ? 'wav' : this.aiService.cloudSettings().xaiVoiceCodec,
      });
      return;
    }

    if (settings.modelId === this.aiService.kokoroSpeechModelId) {
      this.aiService.updateCloudSettings({
        kokoroVoiceId: typeof settings.voice === 'string' ? settings.voice : this.aiService.cloudSettings().kokoroVoiceId,
        kokoroVoiceSpeed: typeof settings.speed === 'number' ? settings.speed : this.aiService.cloudSettings().kokoroVoiceSpeed,
      });
      return;
    }

    if (settings.modelId === this.aiService.piperSpeechModelId) {
      this.aiService.updateCloudSettings({
        piperVoiceId: typeof settings.voice === 'number' ? settings.voice : this.aiService.cloudSettings().piperVoiceId,
        piperVoiceSpeed: typeof settings.speed === 'number' ? settings.speed : this.aiService.cloudSettings().piperVoiceSpeed,
      });
      return;
    }

    if (settings.modelId === this.aiService.supertonicSpeechModelId) {
      this.aiService.updateCloudSettings({
        supertonicVoiceId: typeof settings.voice === 'string' ? settings.voice : this.aiService.cloudSettings().supertonicVoiceId,
        supertonicVoiceSpeed: typeof settings.speed === 'number' ? settings.speed : this.aiService.cloudSettings().supertonicVoiceSpeed,
        supertonicLanguage: settings.language || this.aiService.cloudSettings().supertonicLanguage,
      });
    }
  }

  private reusableMessageContent(message: ConversationMessage): string {
    const content = message.content.trim();
    if (content) {
      return message.content;
    }

    const audioPrompt = message.generatedAudios?.[0]?.prompt;
    if (audioPrompt) {
      return audioPrompt;
    }

    const videoPrompt = message.generatedVideos?.[0]?.prompt;
    if (videoPrompt) {
      return videoPrompt;
    }

    return message.generatedImages?.[0]?.revisedPrompt || message.generatedImages?.[0]?.prompt || '';
  }

  applyActiveQuickPrompt(prompt: AiQuickPrompt): void {
    if (prompt.task === 'voice-generation' || this.isVoiceGenerationMode()) {
      this.applyVoicePrompt(prompt.prompt);
      return;
    }

    if (prompt.task === 'video-generation' || this.isVideoGenerationMode()) {
      this.applyVideoPrompt(prompt.prompt);
      return;
    }

    if (prompt.task === 'image-generation' || this.isImageGenerationMode()) {
      this.applyImagePrompt(prompt.prompt);
      return;
    }

    this.applyChatPrompt(prompt.prompt);
  }

  clearHistoryQuery(): void {
    this.historyQuery.set('');
  }

  deleteHistory(historyId: string): void {
    void this.deleteHistoryWithCacheCleanup(historyId);
  }

  private async deleteHistoryWithCacheCleanup(historyId: string): Promise<void> {
    const history = this.historyService.getHistory(historyId);
    if (!history) {
      return;
    }

    await this.removeHistoryAssetsFromCache(history);

    if (this.currentConversationId() === historyId) {
      await this.removeConversationAttachmentsFromCache(this.conversation());
    }

    this.historyService.deleteHistory(historyId);
    if (this.currentConversationId() === historyId) {
      this.createNewChat();
    }

  }

  async copyMessage(message: ConversationMessage): Promise<void> {
    try {
      await this.copyTextToClipboard(message.content);
    } catch (error) {
      this.logger.warn('Failed to copy AI message', error);
      this.snackBar.open('Could not copy that message.', 'Dismiss', { duration: 3500 });
    }
  }

  async copySuggestion(): Promise<void> {
    const suggestion = this.activeSuggestion();
    if (!suggestion) {
      return;
    }

    try {
      await this.copyTextToClipboard(this.suggestionShareContent(suggestion));
    } catch (error) {
      this.logger.warn('Failed to copy AI suggestion', error);
      this.snackBar.open('Could not copy that suggestion.', 'Dismiss', { duration: 3500 });
    }
  }

  useSuggestionInComposer(): void {
    const suggestion = this.activeSuggestion();
    if (!suggestion) {
      return;
    }

    const content = this.suggestionShareContent(suggestion);
    this.composerText.set(content);
    this.focusComposerPromptPlaceholder(content);
  }

  async shareSuggestionToArticleEditor(): Promise<void> {
    const suggestion = this.activeSuggestion();
    if (!suggestion) {
      return;
    }

    const articleSource = this.suggestionArticleSource(suggestion);
    const draft = this.parseArticleDraft(articleSource);
    await this.layout.createArticle(undefined, undefined, draft);
  }

  async shareSuggestionToNoteEditor(): Promise<void> {
    const suggestion = this.activeSuggestion();
    if (!suggestion) {
      return;
    }

    await this.eventService.createNote({ content: this.suggestionShareContent(suggestion) });
  }

  async shareToArticleEditor(): Promise<void> {
    const message = this.activeShareMessage();
    if (!message?.content.trim()) {
      return;
    }

    const draft = this.parseArticleDraft(message.content);
    await this.layout.createArticle(undefined, undefined, draft);
  }

  async shareToNoteEditor(): Promise<void> {
    const message = this.activeShareMessage();
    if (!message?.content.trim()) {
      return;
    }

    await this.eventService.createNote({ content: message.content.trim() });
  }

  async shareToPublicChat(): Promise<void> {
    const message = this.activeShareMessage();
    if (!message?.content.trim()) {
      return;
    }

    try {
      await this.copyTextToClipboard(message.content.trim());
    } catch (error) {
      this.logger.warn('Failed to copy AI message for public chat', error);
      this.snackBar.open('Could not copy the message for public chat.', 'Dismiss', { duration: 3500 });
    }
  }

  async shareViaDirectMessage(): Promise<void> {
    const message = this.activeShareMessage();
    if (!message?.content.trim()) {
      return;
    }

    await this.layout.openMessagesWithDraft(message.content.trim());
  }

  async shareGeneratedImageToNoteEditor(): Promise<void> {
    const image = this.activeGeneratedImage();
    if (!image) {
      return;
    }

    try {
      const file = await this.createFileFromGeneratedImage(image);
      await this.eventService.createNote({
        content: image.revisedPrompt || image.prompt,
        files: [file],
      });
    } catch (error) {
      this.logger.error('Failed to open generated image in note editor', error);
      this.snackBar.open('Could not open the generated image in note editor.', 'Dismiss', { duration: 3500 });
    }
  }

  async publishGeneratedImage(): Promise<void> {
    const image = this.activeGeneratedImage();
    if (!image) {
      return;
    }

    try {
      const file = await this.createFileFromGeneratedImage(image);
      const uploadResult = await this.mediaService.uploadFile(file, false, this.mediaService.mediaServers());
      if (uploadResult.status === 'success' && uploadResult.item) {
        await this.layout.publishSingleItem(uploadResult.item);
        return;
      }

      throw new Error(uploadResult.message ?? 'Upload failed.');
    } catch (error) {
      this.logger.error('Failed to publish generated image', error);
      this.snackBar.open('Could not publish the generated image.', 'Dismiss', { duration: 3500 });
    }
  }

  async shareGeneratedVideoToNoteEditor(): Promise<void> {
    const video = this.activeGeneratedVideo();
    if (!video) {
      return;
    }

    try {
      const file = await this.createFileFromGeneratedVideo(video);
      await this.eventService.createNote({
        content: video.prompt,
        files: [file],
      });
    } catch (error) {
      this.logger.error('Failed to open generated video in note editor', error);
      this.snackBar.open('Could not open the generated video in note editor.', 'Dismiss', { duration: 3500 });
    }
  }

  async publishGeneratedVideo(): Promise<void> {
    const video = this.activeGeneratedVideo();
    if (!video) {
      return;
    }

    try {
      const file = await this.createFileFromGeneratedVideo(video);
      const uploadResult = await this.mediaService.uploadFile(file, false, this.mediaService.mediaServers());
      if (uploadResult.status === 'success' && uploadResult.item) {
        await this.layout.publishSingleItem(uploadResult.item);
        return;
      }

      throw new Error(uploadResult.message ?? 'Upload failed.');
    } catch (error) {
      this.logger.error('Failed to publish generated video', error);
      this.snackBar.open('Could not publish the generated video.', 'Dismiss', { duration: 3500 });
    }
  }

  reuseMessage(message: ConversationMessage): void {
    const content = this.reusableMessageContent(message);
    this.composerText.set(content);
    this.focusComposerPromptPlaceholder(content);
  }

  async deleteMessage(message: ConversationMessage): Promise<void> {
    const nextConversation = this.conversation().filter(entry => entry.id !== message.id);
    const retainedCacheKeys = this.collectRetainedCacheKeys(nextConversation, this.attachedFiles());

    await this.removeGeneratedImagesFromCache(message.generatedImages, retainedCacheKeys);
    await this.removeGeneratedVideosFromCache(message.generatedVideos, retainedCacheKeys);
    await this.removeGeneratedAudiosFromCache(message.generatedAudios, retainedCacheKeys);
    this.releaseGeneratedVideoUrls(message.generatedVideos);
    this.releaseGeneratedAudioUrls(message.generatedAudios);
    this.releaseAttachmentPreviewUrls(message.attachments);

    if (this.activeShareMessage()?.id === message.id) {
      this.activeShareMessage.set(null);
    }

    const activeGeneratedImage = this.activeGeneratedImage();
    if (activeGeneratedImage && message.generatedImages?.some(image => image.id === activeGeneratedImage.id)) {
      this.activeGeneratedImage.set(null);
    }

    const activeGeneratedVideo = this.activeGeneratedVideo();
    if (activeGeneratedVideo && message.generatedVideos?.some(video => video.id === activeGeneratedVideo.id)) {
      this.activeGeneratedVideo.set(null);
    }

    const activeGeneratedAudio = this.activeGeneratedAudio();
    if (activeGeneratedAudio && message.generatedAudios?.some(audio => audio.id === activeGeneratedAudio.id)) {
      this.activeGeneratedAudio.set(null);
    }

    if (this.hasPersistableMessages(nextConversation)) {
      this.conversation.set(nextConversation);
      this.persistCurrentConversation();
    } else {
      const currentConversationId = this.currentConversationId();
      if (currentConversationId) {
        this.historyService.deleteHistory(currentConversationId);
      }
      this.currentConversationId.set(null);
      this.clearConversation();
    }

  }

  async retryLastReply(): Promise<void> {
    const model = this.selectedModel();
    const currentConversation = this.conversation();
    const lastMessage = currentConversation.at(-1);

    if (!model || !this.isChatGenerationTask(model.task) || lastMessage?.role !== 'assistant' || this.isGenerating()) {
      return;
    }

    const generationConversation = currentConversation.slice(0, -1);
    const assistantMessageId = this.createMessageId();
    this.chatError.set('');
    this.conversation.set([
      ...generationConversation,
      this.createPendingAssistantMessage(assistantMessageId),
    ]);
    this.autoScrollPinned.set(true);

    if (model.source !== 'cloud' && !model.loaded) {
      const loaded = await this.ensureLocalModelReady(model);
      if (!loaded) {
        this.replaceMessageContent(assistantMessageId, 'The selected model could not be loaded in this browser.', false);
        this.finishMessageProcessing(assistantMessageId);
        this.persistCurrentConversation();
        return;
      }
    }

    this.isGenerating.set(true);

    try {
      let assistantReply: string;
      if (model.source === 'cloud' && model.provider) {
        const input = this.buildGenerationInput(model, generationConversation) as AiChatMessage[];
        assistantReply = await this.aiService.generateCloudText(input, model.provider, model.cloudModel, model.cloudAccessMode);
      } else if (model.task === 'image-text-to-text') {
        const input = await this.buildMultimodalGenerationInput(generationConversation);
        assistantReply = await this.aiService.generateMultimodalText(
          input,
          model.preferredParams,
          model.id,
          (progress: AiGenerationProgress) => {
            if (progress.status === 'stream') {
              this.appendToMessage(assistantMessageId, progress.text);
            }
          },
        );
      } else {
        const input = this.buildGenerationInput(model, generationConversation);
        assistantReply = this.extractAssistantReply(await this.aiService.generateText(
          input,
          model.preferredParams,
          model.id,
          (progress: AiGenerationProgress) => {
            if (progress.status === 'stream') {
              this.appendToMessage(assistantMessageId, progress.text);
            }
          },
        ));
      }
      const currentReply = this.getMessageContent(assistantMessageId);
      this.replaceMessageContent(assistantMessageId, currentReply.trim().length > 0 ? currentReply.trimEnd() : assistantReply, false);
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
    } catch (err) {
      if (this.aiService.isAbortError(err)) {
        this.finalizeStoppedGeneration(assistantMessageId);
        return;
      }

      this.logger.error('AI retry error:', err);
      const attachmentContext = generationConversation
        .filter(message => message.role === 'user')
        .map(message => message.attachmentContext ?? '')
        .join('\n\n');
      const message = this.resolveGenerationErrorMessage(model, err, attachmentContext);
      this.chatError.set(message);
      this.replaceMessageContent(assistantMessageId, `Model error: ${message}`, false);
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
    } finally {
      this.isGenerating.set(false);
    }
  }

  useImagePromptInChat(image: AiGeneratedImage): void {
    void this.prepareGeneratedImageForNextPrompt(
      image,
      'chat',
      `Use this image concept as context and turn it into a polished post or product idea:\n\n${image.revisedPrompt || image.prompt}`,
    );
  }

  remixGeneratedImage(image: AiGeneratedImage): void {
    void this.prepareGeneratedImageForNextPrompt(image, 'image', image.revisedPrompt || image.prompt);
  }

  isGeneratedImageAvailable(image: AiGeneratedImage): boolean {
    return image.src.trim().length > 0 && !this.unavailableGeneratedImageIds().has(image.id);
  }

  markGeneratedImageAvailable(image: AiGeneratedImage): void {
    if (!this.unavailableGeneratedImageIds().has(image.id)) {
      return;
    }

    this.unavailableGeneratedImageIds.update(ids => {
      const next = new Set(ids);
      next.delete(image.id);
      return next;
    });
  }

  markGeneratedImageUnavailable(image: AiGeneratedImage): void {
    this.unavailableGeneratedImageIds.update(ids => {
      if (ids.has(image.id)) {
        return ids;
      }

      return new Set(ids).add(image.id);
    });
  }

  useVideoPromptInChat(video: AiGeneratedVideo): void {
    const textModel = this.localChatModels()[0] ?? this.cloudChatModels()[0];
    if (textModel) {
      this.selectedModelId.set(textModel.id);
    }

    const prompt = `Use this video concept as context and turn it into a polished post, storyboard, or campaign idea:\n\n${video.prompt}`;
    this.composerText.set(prompt);
    this.focusComposerPromptPlaceholder(prompt);
  }

  async extendGeneratedVideo(video: AiGeneratedVideo): Promise<void> {
    const videoModel = this.videoModels().find(model => model.task === 'video-generation');
    if (!videoModel) {
      this.chatError.set('No video generation model is available. Add an xAI API key in AI Settings.');
      return;
    }

    try {
      const file = await this.createFileFromGeneratedVideo(video);
      const attachment = await this.createAttachment(file);
      this.selectedModelId.set(videoModel.id);
      this.xAiVideoMode.set('extend-video');
      this.setComposerAttachments([attachment]);
      this.composerText.set(`Continue this video seamlessly. Keep the same subject and style, then: [describe what happens next]`);
      this.focusComposerPromptPlaceholder(this.composerText());
    } catch (error) {
      this.logger.error('Failed to prepare generated video for extension', error);
      this.chatError.set(error instanceof Error ? error.message : 'Could not prepare the generated video for extension.');
      this.snackBar.open('Could not prepare the generated video for extension.', 'Dismiss', { duration: 3500 });
    }
  }

  private async prepareGeneratedImageForNextPrompt(
    image: AiGeneratedImage,
    target: 'chat' | 'image',
    prompt: string,
  ): Promise<void> {
    const model = target === 'image'
      ? this.selectGeneratedImageRemixModel(image)
      : this.localChatModels()[0] ?? this.cloudChatModels()[0];

    if (!model) {
      this.chatError.set(target === 'image' ? 'No image generation model is available.' : 'No chat model is available.');
      return;
    }

    try {
      const attachment = await this.createAttachmentFromGeneratedImage(image);
      this.selectedModelId.set(model.id);
      this.setComposerAttachments([attachment]);
      this.composerText.set(prompt);
      this.focusComposerPromptPlaceholder(prompt);
    } catch (error) {
      this.logger.error('Failed to prepare generated image for follow-up prompt', error);
      this.chatError.set(error instanceof Error ? error.message : 'Could not prepare the image for the next prompt.');
      this.snackBar.open('Could not attach the selected image.', 'Dismiss', { duration: 3500 });
    }
  }

  private selectGeneratedImageRemixModel(image: AiGeneratedImage): ModelInfo | null {
    if (image.provider === 'local') {
      const localModel = this.imageModels().find(candidate => candidate.task === 'image-generation' && candidate.source !== 'cloud' && candidate.id === image.model)
        ?? this.imageModels().find(candidate => candidate.task === 'image-generation' && candidate.source !== 'cloud');

      if (localModel) {
        this.selectedModelId.set(localModel.id);
      }

      return localModel ?? null;
    }

    if (image.provider === 'xai' || image.provider === 'openai') {
      const nextSettings: Partial<import('../../services/ai.service').AiCloudSettings> = {
        preferredImageProvider: image.provider,
      };

      if (image.provider === 'xai') {
        nextSettings['xaiImageModel'] = image.imageSettings?.model || image.model;
        if (image.imageSettings?.xaiImageAspectRatio) {
          nextSettings['xaiImageAspectRatio'] = image.imageSettings.xaiImageAspectRatio;
        }
        if (image.imageSettings?.xaiImageResolution) {
          nextSettings['xaiImageResolution'] = image.imageSettings.xaiImageResolution;
        }
        if (image.imageSettings?.xaiImageCount) {
          nextSettings['xaiImageCount'] = image.imageSettings.xaiImageCount;
        }
      } else {
        nextSettings['openaiImageModel'] = image.imageSettings?.model || image.model;
        if (image.imageSettings?.openaiImageSize) {
          nextSettings['openaiImageSize'] = image.imageSettings.openaiImageSize;
        }
        if (image.imageSettings?.openaiImageQuality) {
          nextSettings['openaiImageQuality'] = image.imageSettings.openaiImageQuality;
        }
        if (image.imageSettings?.openaiImageCount) {
          nextSettings['openaiImageCount'] = image.imageSettings.openaiImageCount;
        }
      }

      this.aiService.updateCloudSettings(nextSettings);

      const cloudModel = this.imageModels().find(candidate => candidate.task === 'image-generation' && candidate.provider === image.provider)
        ?? this.imageModels().find(candidate => candidate.task === 'image-generation');

      if (cloudModel) {
        this.selectedModelId.set(cloudModel.id);
      }

      return cloudModel ?? null;
    }

    const fallbackModel = this.imageModels().find(candidate => candidate.task === 'image-generation') ?? null;
    if (fallbackModel) {
      this.selectedModelId.set(fallbackModel.id);
    }

    return fallbackModel;
  }

  async upscaleGeneratedImage(image: AiGeneratedImage): Promise<void> {
    if (this.isGenerating()) {
      return;
    }

    const model = this.models().find(candidate => candidate.task === 'image-upscaling');
    if (!model) {
      this.chatError.set('No image upscaling model is available.');
      return;
    }

    try {
      const attachment = await this.createAttachmentFromGeneratedImage(image);
      this.selectedModelId.set(model.id);
      await this.upscaleImageMessage(
        model,
        `Upscale this image and preserve the original composition: ${image.revisedPrompt || image.prompt}`,
        [attachment],
      );
    } catch (error) {
      this.logger.error('Failed to queue generated image for upscaling', error);
      this.chatError.set(error instanceof Error ? error.message : 'Could not prepare the image for upscaling.');
      this.snackBar.open('Could not prepare the image for upscaling.', 'Dismiss', { duration: 3500 });
    }
  }

  openGeneratedImagePreview(image: AiGeneratedImage): void {
    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: image.src,
        mediaType: image.mimeType || 'image/png',
        mediaTitle: image.revisedPrompt || image.prompt || 'Generated image',
        mediaOriginalUrl: image.originalUrl,
        mediaCacheKey: image.cacheKey,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  openGeneratedVideoPreview(video: AiGeneratedVideo): void {
    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: video.src,
        mediaType: 'video',
        mediaTitle: video.prompt || 'Generated video',
        mediaOriginalUrl: video.originalUrl,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  async downloadImage(image: AiGeneratedImage): Promise<void> {
    if (!this.isBrowser || typeof document === 'undefined') {
      return;
    }

    try {
      const blob = await this.getGeneratedImageDownloadBlob(image);
      const extension = this.fileExtensionForMimeType(blob.type || image.mimeType || 'image/png');
      this.downloadBlob(blob, `${image.id}.${extension}`);
    } catch (error) {
      this.logger.warn('Direct download failed for generated image; opening in new tab instead.', error);
      if (this.openUrlInNewTab(image.originalUrl || image.src)) {
        return;
      }

      this.snackBar.open('Could not download the generated image.', 'Dismiss', { duration: 3500 });
    }
  }

  async downloadVideo(video: AiGeneratedVideo): Promise<void> {
    if (!this.isBrowser || typeof document === 'undefined') {
      return;
    }

    try {
      const blob = await this.getGeneratedVideoBlob(video);
      const extension = this.fileExtensionForMimeType(blob.type || video.mimeType || 'video/mp4');
      this.downloadBlob(blob, `${video.id}.${extension}`);
    } catch (error) {
      this.logger.warn('Failed to download generated video', error);
      if (this.openUrlInNewTab(video.originalUrl || video.src)) {
        return;
      }

      this.snackBar.open('Could not download the generated video.', 'Dismiss', { duration: 3500 });
    }
  }

  async downloadAudio(audio: AiGeneratedAudio): Promise<void> {
    if (!this.isBrowser || typeof document === 'undefined') {
      return;
    }

    try {
      const blob = await this.getGeneratedAudioBlob(audio);
      const extension = this.fileExtensionForMimeType(blob.type || audio.mimeType || 'audio/mpeg');
      this.downloadBlob(blob, `${audio.id}.${extension}`);
    } catch (error) {
      this.logger.warn('Failed to download generated audio', error);
      this.snackBar.open('Could not download the generated audio.', 'Dismiss', { duration: 3500 });
    }
  }

  audioState(audio: AiGeneratedAudio): AudioPlaybackState {
    return this.audioPlayback()[audio.id] ?? { playing: false, currentTime: 0, duration: 0 };
  }

  audioProgress(audio: AiGeneratedAudio): number {
    const state = this.audioState(audio);
    if (state.duration <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(100, (state.currentTime / state.duration) * 100));
  }

  formatAudioTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return '0:00';
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  toggleAudioPlayback(audio: AiGeneratedAudio, event: Event): void {
    const player = this.findAudioPlayer(audio, event);
    if (!player) {
      return;
    }

    if (player.paused) {
      void player.play();
    } else {
      player.pause();
    }
  }

  seekGeneratedAudio(audio: AiGeneratedAudio, event: Event): void {
    const input = event.target as HTMLInputElement;
    const player = this.findAudioPlayer(audio, event);
    const duration = this.audioState(audio).duration;
    if (!player || duration <= 0) {
      return;
    }

    const nextTime = Math.max(0, Math.min(duration, (Number(input.value) / 100) * duration));
    player.currentTime = nextTime;
    this.updateAudioPlaybackState(audio.id, { currentTime: nextTime });
  }

  onGeneratedAudioLoaded(audio: AiGeneratedAudio, event: Event): void {
    const player = event.target as HTMLAudioElement;
    const duration = Number.isFinite(player.duration) ? player.duration : 0;
    this.updateAudioPlaybackState(audio.id, { duration, currentTime: player.currentTime || 0 });

    if (!this.autoPlayedAudioIds.has(audio.id)) {
      this.autoPlayedAudioIds.add(audio.id);
      void player.play().catch(() => {
        this.updateAudioPlaybackState(audio.id, { playing: false });
      });
    }
  }

  onGeneratedAudioTimeUpdate(audio: AiGeneratedAudio, event: Event): void {
    const player = event.target as HTMLAudioElement;
    this.updateAudioPlaybackState(audio.id, {
      currentTime: player.currentTime || 0,
      duration: Number.isFinite(player.duration) ? player.duration : this.audioState(audio).duration,
    });
  }

  onGeneratedAudioPlay(audio: AiGeneratedAudio): void {
    this.updateAudioPlaybackState(audio.id, { playing: true });
  }

  onGeneratedAudioPause(audio: AiGeneratedAudio): void {
    this.updateAudioPlaybackState(audio.id, { playing: false });
  }

  onGeneratedAudioEnded(audio: AiGeneratedAudio, event: Event): void {
    const player = event.target as HTMLAudioElement;
    player.loop = false;
    this.updateAudioPlaybackState(audio.id, { playing: false, currentTime: 0 });
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  private async getGeneratedImageDownloadBlob(image: AiGeneratedImage): Promise<Blob> {
    if (this.isBrowser && typeof caches !== 'undefined' && image.cacheKey) {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      const cached = await cache.match(image.cacheKey);
      if (cached?.ok) {
        return cached.blob();
      }
    }

    const candidateUrls = [image.originalUrl, image.src]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    let lastError: unknown;
    for (const url of candidateUrls) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Could not fetch generated image (${response.status}).`);
        }

        return response.blob();
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error('Could not fetch generated image.');
  }

  private openUrlInNewTab(url: string | undefined): boolean {
    if (!url?.trim() || !this.isBrowser) {
      return false;
    }

    const openedWindow = globalThis.open(url.trim(), '_blank', 'noopener,noreferrer');
    return openedWindow !== null;
  }

  formatFileSize(size: number): string {
    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 * 1024) {
      return `${Math.round(size / 102.4) / 10} KB`;
    }

    return `${Math.round(size / 104857.6) / 10} MB`;
  }

  renderedAssistantMessage(id: string): SafeHtml | string {
    return this.renderedAssistantMessages()[id]?.answer ?? '';
  }

  renderedAssistantThinking(id: string): SafeHtml | null {
    return this.renderedAssistantMessages()[id]?.thinking ?? null;
  }

  renderedAssistantAnswer(id: string): SafeHtml | null {
    return this.renderedAssistantMessages()[id]?.answer ?? null;
  }

  renderedAssistantSuggestionIntro(id: string): SafeHtml | null {
    return this.renderedAssistantMessages()[id]?.suggestionIntro ?? null;
  }

  renderedAssistantSuggestionOutro(id: string): SafeHtml | null {
    return this.renderedAssistantMessages()[id]?.suggestionOutro ?? null;
  }

  renderedAssistantSuggestions(id: string): RenderedAssistantSuggestion[] {
    return this.renderedAssistantMessages()[id]?.suggestions ?? [];
  }

  formatHistoryTimestamp(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(timestamp);
  }

  statusLabel(model: ModelInfo): string {
    if (model.source === 'cloud') {
      if (model.task === 'text-generation') {
        if (model.provider === 'openai') {
          return 'Key';
        }

        if (model.provider === 'xai') {
          return model.cloudAccessMode === 'hosted' ? 'Hosted' : 'Key';
        }
      }

      if (model.task === 'text-generation' && model.provider === 'xai') {
        return model.cloudAccessMode === 'hosted' ? 'Hosted' : 'Key';
      }

      if (model.task === 'image-generation') {
        return 'Image';
      }

      if (model.task === 'video-generation') {
        return 'Video';
      }

      if (model.task === 'text-to-speech') {
        return 'Voice';
      }

      return 'Hosted';
    }

    if (model.loading) {
      return `Loading ${Math.round(model.progress)}%`;
    }

    if (model.loaded) {
      return 'Loaded';
    }

    if (model.cached) {
      return 'Cached';
    }

    return 'Not loaded';
  }

  private getPreferredXAiTextModel(): ModelInfo | undefined {
    const preferredMode = this.preferredXAiChatAccessMode();
    return this.cloudChatModels().find(candidate => candidate.provider === 'xai' && candidate.cloudAccessMode === preferredMode)
      ?? this.cloudChatModels().find(candidate => candidate.provider === 'xai');
  }

  private resolveModelId(modelId: string): string | null {
    if (this.composerModels().some(model => model.id === modelId)) {
      return modelId;
    }

    if (modelId === 'cloud-chat:xai') {
      return this.getPreferredXAiTextModel()?.id ?? null;
    }

    return null;
  }

  async loadModel(model: ModelInfo): Promise<boolean> {
    if (model.chatDisabledReason) {
      this.chatError.set(model.chatDisabledReason);
      return false;
    }

    this.updateModelStatus(model.id, { loading: true, progress: 0 });

    try {
      await this.aiService.loadModel(
        model.task,
        model.id,
        (data: unknown) => {
          const progress = data as { status?: string; progress?: number };
          if (progress.status === 'progress' && typeof progress.progress === 'number') {
            const currentProgress = this.models().find(candidate => candidate.id === model.id)?.progress ?? 0;
            const normalizedProgress = progress.progress <= 1 ? progress.progress * 100 : progress.progress;
            this.updateModelStatus(model.id, { progress: Math.max(currentProgress, Math.min(normalizedProgress, 94)) });
          }
        },
        model.loadOptions,
      );
      this.updateModelStatus(model.id, { loaded: true, cached: true, progress: 100 });
      return true;
    } catch (err) {
      this.logger.error('AI model load error:', err);
      this.chatError.set(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this.updateModelStatus(model.id, { loading: false });
    }
  }

  clearConversation(): void {
    this.clearAttachedFiles();
    this.releaseConversationAttachmentPreviewUrls(this.conversation());
    this.releaseGeneratedVideoUrls(this.conversation().flatMap(message => message.generatedVideos ?? []));
    this.releaseGeneratedAudioUrls(this.conversation().flatMap(message => message.generatedAudios ?? []));
    this.chatError.set('');
    this.activeGeneratedImage.set(null);
    this.activeGeneratedVideo.set(null);
    this.activeGeneratedAudio.set(null);
    this.conversation.set([]);
  }

  onConversationScroll(event: Event): void {
    const panel = event.target as HTMLDivElement;
    const distanceFromBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    this.autoScrollPinned.set(distanceFromBottom < 48);
  }

  async sendMessage(): Promise<void> {
    const model = this.selectedModel();
    const promptText = this.composerText().trim();
    const attachments = this.attachedFiles();

    if (!model || (!promptText && attachments.length === 0)) {
      return;
    }

    if (this.isChatGenerationTask(model.task)) {
      const visualIntent = this.detectVisualIntent(promptText, attachments);
      if (visualIntent && await this.routeVisualIntent(visualIntent, attachments)) {
        return;
      }
    }

    if (model.task === 'image-generation') {
      await this.generateImageMessage(model, promptText, attachments);
      return;
    }

    if (model.task === 'video-generation') {
      await this.generateVideoMessage(model, promptText, attachments);
      return;
    }

    if (model.task === 'text-to-speech') {
      await this.generateVoiceMessage(model, promptText);
      return;
    }

    if (model.task === 'image-upscaling') {
      await this.upscaleImageMessage(model, promptText, attachments);
      return;
    }

    let preparedPrompt: { prompt: string; attachmentContext: string };
    let messageAttachments: ComposerAttachment[] | undefined;

    try {
      preparedPrompt = await this.preparePromptSubmission(model, promptText, attachments);
      messageAttachments = await this.createMessageAttachments(attachments);
    } catch (err) {
      this.logger.error('AI prompt preparation error:', err);
      this.chatError.set(err instanceof Error ? err.message : String(err));
      return;
    }

    if (!preparedPrompt.prompt) {
      return;
    }

    this.chatError.set('');
    const assistantMessageId = this.createMessageId();
    const userMessage: ConversationMessage = {
      id: this.createMessageId(),
      role: 'user',
      content: preparedPrompt.prompt,
      attachments: messageAttachments,
      attachmentContext: preparedPrompt.attachmentContext,
    };
    const generationConversation = [...this.conversation(), userMessage];
    this.conversation.set([
      ...generationConversation,
      this.createPendingAssistantMessage(assistantMessageId),
    ]);
    this.composerText.set('');
    this.clearAttachedFiles();
    this.autoScrollPinned.set(true);
    this.showHistoryDrawer.set(false);

    if (model.source !== 'cloud' && !model.loaded) {
      const loaded = await this.ensureLocalModelReady(model);
      if (!loaded) {
        this.replaceMessageContent(assistantMessageId, 'The selected model could not be loaded in this browser.', false);
        this.finishMessageProcessing(assistantMessageId);
        this.persistCurrentConversation();
        return;
      }
    }

    this.isGenerating.set(true);

    try {
      let assistantReply: string;
      if (model.source === 'cloud' && model.provider) {
        const input = this.buildGenerationInput(model, generationConversation) as AiChatMessage[];
        assistantReply = await this.aiService.generateCloudText(input, model.provider, model.cloudModel, model.cloudAccessMode);
      } else if (model.task === 'image-text-to-text') {
        const input = await this.buildMultimodalGenerationInput(generationConversation);
        assistantReply = await this.aiService.generateMultimodalText(
          input,
          model.preferredParams,
          model.id,
          (progress: AiGenerationProgress) => {
            if (progress.status === 'stream') {
              this.appendToMessage(assistantMessageId, progress.text);
            }
          },
        );
      } else {
        const input = this.buildGenerationInput(model, generationConversation);
        assistantReply = this.extractAssistantReply(await this.aiService.generateText(
          input,
          model.preferredParams,
          model.id,
          (progress: AiGenerationProgress) => {
            if (progress.status === 'stream') {
              this.appendToMessage(assistantMessageId, progress.text);
            }
          },
        ));
      }
      const currentReply = this.getMessageContent(assistantMessageId);
      this.replaceMessageContent(assistantMessageId, currentReply.trim().length > 0 ? currentReply.trimEnd() : assistantReply, false);
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
    } catch (err) {
      if (this.aiService.isAbortError(err)) {
        this.finalizeStoppedGeneration(assistantMessageId);
        return;
      }

      this.logger.error('AI chat error:', err);
      const message = this.resolveGenerationErrorMessage(model, err, preparedPrompt.attachmentContext);
      this.chatError.set(message);
      this.replaceMessageContent(assistantMessageId, `Model error: ${message}`, false);
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
    } finally {
      this.isGenerating.set(false);
    }
  }

  private updateModelStatus(id: string, updates: Partial<ModelInfo>): void {
    this.models.update(models => models.map(model => model.id === id ? { ...model, ...updates } : model));
  }

  private isChatGenerationTask(task: string): boolean {
    return task === 'text-generation' || task === 'image-text-to-text';
  }

  private async initializeModelStatus(): Promise<void> {
    for (const model of this.models()) {
      try {
        const status = await this.aiService.checkModel(model.task, model.id);
        this.updateModelStatus(model.id, { loaded: status.loaded, cached: status.cached });
      } catch (err) {
        this.logger.warn('Model status check failed', err);
      }
    }
  }

  private createMessageId(): string {
    this.nextMessageId.update(value => value + 1);
    return `msg-${this.nextMessageId()}`;
  }

  private createPendingAssistantMessage(id: string): ConversationMessage {
    return {
      id,
      role: 'assistant',
      content: '',
      streaming: true,
      processingStartedAt: Date.now(),
    };
  }

  private parsePositiveInt(value: string | number, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return Math.round(parsed);
  }

  private parseBoundedNumber(value: string | number, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(Math.max(parsed, min), max);
  }

  private findAudioPlayer(audio: AiGeneratedAudio, event: Event): HTMLAudioElement | null {
    const host = (event.currentTarget as HTMLElement | null)?.closest('.generated-audio-card');
    const players = Array.from(host?.querySelectorAll<HTMLAudioElement>('audio[data-audio-id]') ?? []);
    return players.find(player => player.dataset['audioId'] === audio.id) ?? null;
  }

  private updateAudioPlaybackState(audioId: string, patch: Partial<AudioPlaybackState>): void {
    const fallbackState: AudioPlaybackState = {
      playing: false,
      currentTime: 0,
      duration: 0,
    };

    this.audioPlayback.update(states => ({
      ...states,
      [audioId]: {
        ...(states[audioId] ?? fallbackState),
        ...patch,
      },
    }));
  }

  private handleVoiceGenerationProgress(messageId: string, progress: AiVoiceGenerationProgress): AiGeneratedAudio | null {
    if (progress.status !== 'audio-chunk') {
      return null;
    }

    this.conversation.update(messages => messages.map(message => {
      if (message.id !== messageId) {
        return message;
      }

      return {
        ...message,
        generatedAudios: [
          ...(message.generatedAudios ?? []),
          progress.audio,
        ],
      };
    }));

    return progress.audio;
  }

  private appendToMessage(id: string, text: string): void {
    this.conversation.update(messages => messages.map(message => {
      if (message.id !== id) {
        return message;
      }

      return {
        ...message,
        content: `${message.content}${text}`,
        streaming: true,
      };
    }));
  }

  private replaceMessageContent(id: string, content: string, streaming: boolean): void {
    this.conversation.update(messages => messages.map(message => {
      if (message.id !== id) {
        return message;
      }

      return {
        ...message,
        content,
        streaming,
      };
    }));
  }

  private finishMessageProcessing(id: string): void {
    const finishedAt = Date.now();
    this.conversation.update(messages => messages.map(message => {
      if (message.id !== id || message.processingDurationMs !== undefined) {
        return message;
      }

      return {
        ...message,
        processingDurationMs: Math.max(0, finishedAt - (message.processingStartedAt ?? finishedAt)),
      };
    }));
  }

  processingTimeLabel(message: ConversationMessage): string {
    const duration = message.processingDurationMs ?? (
      message.streaming && message.processingStartedAt
        ? Math.max(0, this.statusClock() - message.processingStartedAt)
        : null
    );

    if (duration === null) {
      return '';
    }

    return message.streaming
      ? `Processing for ${this.formatProcessingDuration(duration)}`
      : `Processed in ${this.formatProcessingDuration(duration)}`;
  }

  private formatProcessingDuration(durationMs: number): string {
    if (durationMs < 1000) {
      return `${Math.max(1, Math.round(durationMs))}ms`;
    }

    const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes === 0) {
      return `${totalSeconds}s`;
    }

    if (seconds === 0) {
      return `${minutes}m`;
    }

    return `${minutes}m ${seconds}s`;
  }

  private getMessageContent(id: string): string {
    return this.conversation().find(message => message.id === id)?.content ?? '';
  }

  private scrollConversationToEnd(behavior: ScrollBehavior): void {
    requestAnimationFrame(() => {
      const anchor = this.conversationEndRef()?.nativeElement;
      if (anchor) {
        anchor.scrollIntoView({ behavior, block: 'end' });
        return;
      }

      const panel = this.conversationPanelRef()?.nativeElement;
      panel?.scrollTo({ top: panel.scrollHeight, behavior });
    });
  }

  private async ensureLocalModelReady(model: ModelInfo): Promise<boolean> {
    if (model.loaded) {
      return true;
    }

    return this.loadModel(model);
  }

  private focusComposerPromptPlaceholder(prompt: string): void {
    if (!this.isBrowser) {
      return;
    }

    requestAnimationFrame(() => {
      const textarea = this.composerInputRef()?.nativeElement;
      if (!textarea) {
        return;
      }

      textarea.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      textarea.focus();

      const placeholderMatch = /\[[^\]]+\]/.exec(prompt);
      if (placeholderMatch && typeof placeholderMatch.index === 'number') {
        textarea.setSelectionRange(placeholderMatch.index, placeholderMatch.index + placeholderMatch[0].length);
        return;
      }

      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    });
  }

  private parseAssistantMessageContent(content: string): { thinking: string; answer: string } {
    const thinkPattern = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
    const thinkingBlocks: string[] = [];
    const answerParts: string[] = [];
    let cursor = 0;

    for (const match of content.matchAll(thinkPattern)) {
      const start = match.index ?? 0;
      if (start > cursor) {
        answerParts.push(content.slice(cursor, start));
      }

      const thinking = (match[1] ?? '').trim();
      if (thinking) {
        thinkingBlocks.push(thinking);
      }

      cursor = start + match[0].length;
    }

    if (cursor < content.length) {
      answerParts.push(content.slice(cursor));
    }

    const answer = answerParts.join('').replace(/<\/think>/gi, '').trim();
    const thinking = thinkingBlocks.join('\n\n').trim();

    if (!thinking) {
      return {
        thinking: '',
        answer: content.trim(),
      };
    }

    return { thinking, answer };
  }

  private renderAssistantSection(
    messageId: string,
    version: number,
    section: keyof RenderedAssistantContent,
    content: string,
  ): SafeHtml | null {
    const trimmed = content.trim();
    if (!trimmed) {
      return null;
    }

    return this.formatService.markdownToHtmlNonBlocking(trimmed, updatedHtml => {
      if (this.renderedAssistantVersion.get(messageId) !== version) {
        return;
      }

      this.renderedAssistantMessages.update(rendered => {
        const current = rendered[messageId];
        if (!current) {
          return rendered;
        }

        return {
          ...rendered,
          [messageId]: {
            ...current,
            [section]: updatedHtml,
          },
        };
      });
    });
  }

  private renderAssistantSuggestion(
    messageId: string,
    version: number,
    suggestion: AssistantSuggestion,
  ): SafeHtml | null {
    const trimmed = suggestion.content.trim();
    if (!trimmed) {
      return null;
    }

    return this.formatService.markdownToHtmlNonBlocking(trimmed, updatedHtml => {
      if (this.renderedAssistantVersion.get(messageId) !== version) {
        return;
      }

      this.renderedAssistantMessages.update(rendered => {
        const current = rendered[messageId];
        if (!current) {
          return rendered;
        }

        return {
          ...rendered,
          [messageId]: {
            ...current,
            suggestions: current.suggestions.map(entry => entry.id === suggestion.id
              ? { ...entry, renderedContent: updatedHtml }
              : entry),
          },
        };
      });
    });
  }

  private parseAssistantSuggestions(answer: string): { intro: string; suggestions: AssistantSuggestion[]; outro: string } | null {
    const normalized = answer.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
      return null;
    }

    const headerMatches = Array.from(normalized.matchAll(/(^.*$)/gm))
      .map(match => {
        const rawLine = match[0] ?? '';
        const title = this.parseSuggestionHeader(rawLine);
        if (!title) {
          return null;
        }

        return {
          index: match.index ?? 0,
          rawLine,
          title,
        };
      })
      .filter((match): match is { index: number; rawLine: string; title: string } => match !== null);

    if (headerMatches.length === 0) {
      return null;
    }

    const intro = normalized.slice(0, headerMatches[0].index).trim();
    const suggestions = headerMatches.map((match, index) => {
      const start = match.index + match.rawLine.length;
      const end = index + 1 < headerMatches.length ? headerMatches[index + 1].index : normalized.length;
      const content = normalized.slice(start, end).trim();

      return {
        id: `${index + 1}-${match.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title: match.title,
        content,
      } satisfies AssistantSuggestion;
    });

    let outro = '';
    const lastSuggestion = suggestions.at(-1);
    if (lastSuggestion) {
      const extracted = this.extractSuggestionOutro(lastSuggestion.content);
      outro = extracted.outro;
      lastSuggestion.content = extracted.content;
    }

    return { intro, suggestions, outro };
  }

  private suggestionShareContent(suggestion: AssistantSuggestion): string {
    const normalized = suggestion.content
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.replace(/^\s*>\s?/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return this.extractSuggestionOutro(normalized).content;
  }

  private suggestionArticleSource(suggestion: AssistantSuggestion): string {
    const title = suggestion.title.replace(/^(?:Option|Choice|Version|Variation)\s+\d+\s*[:.-]?\s*/i, '').trim();
    if (!title) {
      return this.suggestionShareContent(suggestion);
    }

    return `${title}\n\n${this.suggestionShareContent(suggestion)}`;
  }

  private parseSuggestionHeader(value: string): string | null {
    const normalized = value
      .trim()
      .replace(/^>\s*/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .replace(/^__(.+)__$/, '$1')
      .trim();

    if (/^(?:Option|Choice|Version|Variation)\s+\d+[\w\s.-]*:\s*.+$/i.test(normalized)) {
      return normalized;
    }

    return null;
  }

  private extractSuggestionOutro(content: string): { content: string; outro: string } {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    const lines = normalized.split('\n');

    for (let startIndex = lines.length - 1; startIndex > 0; startIndex--) {
      const outro = lines.slice(startIndex).join('\n').trim();
      const body = lines.slice(0, startIndex).join('\n').trim();

      if (!body || !outro) {
        continue;
      }

      if (!this.isSuggestionOutroParagraph(outro)) {
        continue;
      }

      return {
        content: body,
        outro,
      };
    }

    const inlineMatch = /^(?<body>[\s\S]*?)\n{1,2}(?<outro>(?:Which|What|Would|Do you|Should|Want|Need|Prefer|Let me know|Tell me|I can refine|I can adjust|I can tune)[\s\S]*)$/i.exec(normalized);
    const body = inlineMatch?.groups?.['body']?.trim() ?? '';
    const outro = inlineMatch?.groups?.['outro']?.trim() ?? '';

    if (!body || !outro || !this.isSuggestionOutroParagraph(outro)) {
      return { content: normalized, outro: '' };
    }

    return {
      content: body,
      outro,
    };
  }

  private isSuggestionOutroParagraph(value: string): boolean {
    const normalized = this.normalizeSuggestionOutroText(value);
    if (!normalized) {
      return false;
    }

    if (normalized.startsWith('>') || normalized.startsWith('- ') || normalized.startsWith('* ')) {
      return false;
    }

    if (!normalized.includes('?') && !/(refine|adjust|tune|change the focus|pick one|choose one)/i.test(normalized)) {
      return false;
    }

    return /^(which|what|would|do you|should|want|need|prefer|let me know|tell me|i can refine|i can adjust|i can tune)/i.test(normalized);
  }

  private normalizeSuggestionOutroText(value: string): string {
    return value
      .trim()
      .replace(/^>\s*/, '')
      .replace(/^\*\*(.+)\*\*$/s, '$1')
      .replace(/^__(.+)__$/s, '$1')
      .replace(/^\*(.+)\*$/s, '$1')
      .replace(/^_(.+)_$/s, '$1')
      .trim();
  }

  private detectVisualIntent(promptText: string, attachments: ComposerAttachment[]): VisualIntent | null {
    const prompt = promptText.trim();
    if (!prompt) {
      return null;
    }

    if (
      attachments.length === 1
      && attachments[0].mimeType.startsWith('image/')
      && /(upscale|enhance|sharpen|super[- ]resolution|higher[- ]resolution|increase resolution|denoise|restore|improve (?:this )?(?:image|photo|artwork|screenshot))/i.test(prompt)
    ) {
      return { task: 'image-upscaling', prompt };
    }

    if (
      /(^\/?video\b|\b(generate|create|make|render|animate|produce)\b[\s\S]{0,80}\b(video|clip|animation|teaser|motion graphic|scene)\b|\b(video|clip|animation|teaser|motion graphic|scene)\b[\s\S]{0,80}\b(generate|create|make|render|animate|produce)\b)/i.test(prompt)
    ) {
      return { task: 'video-generation', prompt };
    }

    if (
      attachments.length === 0
      && /(^\/?image\b|\b(generate|create|make|render|draw|illustrate|paint|design)\b[\s\S]{0,80}\b(image|picture|photo|art|artwork|illustration|poster|cover|portrait|scene|logo|wallpaper)\b|\b(image|picture|photo|art|artwork|illustration|poster|cover|portrait|scene|logo|wallpaper)\b[\s\S]{0,80}\b(generate|create|make|render|draw|illustrate|paint|design)\b)/i.test(prompt)
    ) {
      return { task: 'image-generation', prompt };
    }

    return null;
  }

  private async routeVisualIntent(intent: VisualIntent, attachments: ComposerAttachment[]): Promise<boolean> {
    const model = this.pickVisualModel(intent.task);
    if (!model) {
      this.chatError.set(
        intent.task === 'image-generation'
          ? 'No image generation model is available. Select Janus Pro or configure a hosted image provider.'
          : intent.task === 'video-generation'
            ? 'No video generation model is available. Add an xAI API key in AI Settings.'
            : 'No image upscaling model is available.',
      );
      return true;
    }

    this.selectedModelId.set(model.id);

    if (intent.task === 'image-generation') {
      await this.generateImageMessage(model, intent.prompt, attachments);
      return true;
    }

    if (intent.task === 'video-generation') {
      await this.generateVideoMessage(model, intent.prompt, attachments);
      return true;
    }

    await this.upscaleImageMessage(model, intent.prompt, attachments);
    return true;
  }

  private pickVisualModel(task: VisualIntent['task']): ModelInfo | null {
    return this.imageModels().find(model => model.task === task && !model.chatDisabledReason) ?? null;
  }

  private persistCurrentConversation(): void {
    const model = this.selectedModel();
    if (!model) {
      return;
    }

    const savedId = this.historyService.saveConversation({
      id: this.currentConversationId(),
      modelId: model.id,
      modelName: model.name,
      messages: this.conversation().map(message => ({
        role: message.role,
        content: message.content,
        processingDurationMs: message.processingDurationMs,
        generatedImages: message.generatedImages?.map(image => this.toHistoryGeneratedImage(image)),
        generatedVideos: message.generatedVideos?.map(video => this.toHistoryGeneratedVideo(video)),
        generatedAudios: message.generatedAudios?.map(audio => this.toHistoryGeneratedAudio(audio)),
      })),
    });

    this.currentConversationId.set(savedId);
  }

  private hasPersistableMessages(messages: ConversationMessage[]): boolean {
    return messages.some(message => {
      if (message.content.trim().length > 0) {
        return true;
      }

      return (message.generatedImages?.length ?? 0) > 0 || (message.generatedVideos?.length ?? 0) > 0 || (message.generatedAudios?.length ?? 0) > 0;
    });
  }

  private async generateVoiceMessage(model: ModelInfo, promptText: string): Promise<void> {
    const prompt = promptText.trim();
    if (!prompt) {
      return;
    }

    const userMessage: ConversationMessage = {
      id: this.createMessageId(),
      role: 'user',
      content: prompt,
    };

    this.chatError.set('');
    this.conversation.set([...this.conversation(), userMessage]);
    this.composerText.set('');
    this.clearAttachedFiles();
    this.autoScrollPinned.set(true);
    this.showHistoryDrawer.set(false);
    this.isGenerating.set(true);

    let assistantMessageId: string | null = null;

    try {
      if (model.source !== 'cloud' && !model.loaded) {
        const loaded = await this.ensureLocalModelReady(model);
        if (!loaded) {
          this.conversation.update(messages => [
            ...messages,
            {
              id: this.createMessageId(),
              role: 'assistant',
              content: 'The selected voice model could not be loaded in this browser.',
            },
          ]);
          this.persistCurrentConversation();
          return;
        }
      }

      assistantMessageId = this.createMessageId();
      this.conversation.update(messages => [
        ...messages,
        this.createPendingAssistantMessage(assistantMessageId!),
      ]);

      const streamedAudioUrls: string[] = [];
      const audios = model.source === 'cloud'
        ? await this.aiService.generateVoice(prompt, model.provider ?? 'xai')
        : await this.aiService.generateVoice(prompt, 'local', model.id, progress => {
          const audio = this.handleVoiceGenerationProgress(assistantMessageId!, progress);
          if (audio?.src.startsWith('blob:')) {
            streamedAudioUrls.push(audio.src);
          }
        });
      const cachedAudios = await Promise.all(audios.map(audio => this.cacheGeneratedAudio(audio)));

      this.conversation.update(messages => messages.map(message => {
        if (message.id !== assistantMessageId) {
          return message;
        }

        return {
          ...message,
          content: '',
          streaming: false,
          generatedAudios: cachedAudios,
        };
      }));
      this.releaseObjectUrls(streamedAudioUrls);
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
    } catch (err) {
      if (this.aiService.isAbortError(err)) {
        if (assistantMessageId) {
          this.finalizeStoppedGeneration(assistantMessageId);
        }
        return;
      }

      this.logger.error('AI voice generation error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.chatError.set(message);
      if (assistantMessageId) {
        this.replaceMessageContent(assistantMessageId, `Voice generation error: ${message}`, false);
        this.finishMessageProcessing(assistantMessageId);
      } else {
        this.conversation.update(messages => [
          ...messages,
          {
            id: this.createMessageId(),
            role: 'assistant',
            content: `Voice generation error: ${message}`,
          },
        ]);
      }
      this.persistCurrentConversation();
    } finally {
      this.isGenerating.set(false);
    }
  }

  private async generateImageMessage(model: ModelInfo, promptText: string, attachments: ComposerAttachment[]): Promise<void> {
    const prompt = promptText.trim();
    if (!prompt) {
      return;
    }

    const imageOptions = await this.buildImageGenerationOptions(model, attachments);
    const messageAttachments = await this.createMessageAttachments(attachments);

    const assistantMessageId = this.createMessageId();
    const userMessage: ConversationMessage = {
      id: this.createMessageId(),
      role: 'user',
      content: prompt,
      attachments: messageAttachments,
    };

    this.chatError.set('');
    this.conversation.set([
      ...this.conversation(),
      userMessage,
      this.createPendingAssistantMessage(assistantMessageId),
    ]);
    this.composerText.set('');
    this.clearAttachedFiles();
    this.autoScrollPinned.set(true);
    this.showHistoryDrawer.set(false);
    this.isGenerating.set(true);

    try {
      if (model.source !== 'cloud' && !model.loaded) {
        const loaded = await this.ensureLocalModelReady(model);
        if (!loaded) {
          this.replaceMessageContent(assistantMessageId, 'The selected model could not be loaded in this browser.', false);
          this.finishMessageProcessing(assistantMessageId);
          this.persistCurrentConversation();
          return;
        }
      }

      const images = model.source === 'cloud'
        ? await this.aiService.generateImage(prompt, model.provider, imageOptions)
        : await this.aiService.generateLocalImage(prompt, model.id);
      const cachedImages = await Promise.all(images.map(image => this.cacheGeneratedImage(image)));
      this.conversation.update(messages => messages.map(message => {
        if (message.id !== assistantMessageId) {
          return message;
        }

        return {
          ...message,
          content: '',
          streaming: false,
          generatedImages: cachedImages,
        };
      }));
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
      this.queueGeneratedImageCacheBackfill(cachedImages);
    } catch (err) {
      if (this.aiService.isAbortError(err)) {
        this.finalizeStoppedGeneration(assistantMessageId);
        return;
      }

      this.logger.error('AI image generation error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.chatError.set(message);
      this.replaceMessageContent(assistantMessageId, `Image generation error: ${message}`, false);
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
    } finally {
      this.isGenerating.set(false);
    }
  }

  private async generateVideoMessage(model: ModelInfo, promptText: string, attachments: ComposerAttachment[]): Promise<void> {
    const prompt = promptText.trim();
    if (!prompt) {
      return;
    }

    const videoOptions = await this.buildVideoGenerationOptions(attachments);
    const messageAttachments = await this.createMessageAttachments(attachments);
    const assistantMessageId = this.createMessageId();
    const userMessage: ConversationMessage = {
      id: this.createMessageId(),
      role: 'user',
      content: prompt,
      attachments: messageAttachments,
    };

    this.chatError.set('');
    this.conversation.set([
      ...this.conversation(),
      userMessage,
      this.createPendingAssistantMessage(assistantMessageId),
    ]);
    this.composerText.set('');
    this.clearAttachedFiles();
    this.autoScrollPinned.set(true);
    this.showHistoryDrawer.set(false);
    this.isGenerating.set(true);
    this.beginVideoOperation(this.resolveVideoOperation(videoOptions));

    try {
      const videos = await this.aiService.generateVideo(
        prompt,
        videoOptions,
        progress => this.updateVideoGenerationProgress(progress),
      );
      const displayVideos = videos.map(video => this.prepareGeneratedVideo(video));

      this.conversation.update(messages => messages.map(message => {
        if (message.id !== assistantMessageId) {
          return message;
        }

        return {
          ...message,
          content: '',
          streaming: false,
          generatedVideos: displayVideos,
        };
      }));
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
    } catch (err) {
      if (this.aiService.isAbortError(err)) {
        this.finalizeStoppedGeneration(assistantMessageId);
        return;
      }

      this.logger.error('AI video generation error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.chatError.set(message);
      this.replaceMessageContent(assistantMessageId, `Video generation error: ${message}`, false);
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
    } finally {
      this.endVideoOperation();
      this.isGenerating.set(false);
    }
  }

  private async upscaleImageMessage(model: ModelInfo, promptText: string, attachments: ComposerAttachment[]): Promise<void> {
    if (attachments.length !== 1) {
      this.chatError.set('Attach exactly one image to upscale.');
      return;
    }

    const [attachment] = attachments;
    if (!attachment.mimeType.startsWith('image/')) {
      this.chatError.set('Image upscaling only supports image attachments.');
      return;
    }

    const prompt = promptText.trim() || `Upscale ${attachment.name}`;
    const messageAttachments = await this.createMessageAttachments(attachments);
    const assistantMessageId = this.createMessageId();
    const userMessage: ConversationMessage = {
      id: this.createMessageId(),
      role: 'user',
      content: prompt,
      attachments: messageAttachments,
    };

    this.chatError.set('');
    this.conversation.set([
      ...this.conversation(),
      userMessage,
      this.createPendingAssistantMessage(assistantMessageId),
    ]);
    this.composerText.set('');
    this.attachedFiles.set([]);
    this.autoScrollPinned.set(true);
    this.showHistoryDrawer.set(false);
    this.isGenerating.set(true);

    try {
      if (!model.loaded) {
        const loaded = await this.ensureLocalModelReady(model);
        if (!loaded) {
          this.replaceMessageContent(assistantMessageId, 'The selected model could not be loaded in this browser.', false);
          this.finishMessageProcessing(assistantMessageId);
          this.persistCurrentConversation();
          return;
        }
      }

      const imageBlob = await this.readAttachmentBlob(attachment);
      const images = await this.aiService.upscaleLocalImage(imageBlob, model.id, prompt);
      const cachedImages = await Promise.all(images.map(image => this.cacheGeneratedImage(image)));

      this.conversation.update(messages => messages.map(message => {
        if (message.id !== assistantMessageId) {
          return message;
        }

        return {
          ...message,
          content: '',
          streaming: false,
          generatedImages: cachedImages,
        };
      }));
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
      this.queueGeneratedImageCacheBackfill(cachedImages);
    } catch (err) {
      if (this.aiService.isAbortError(err)) {
        this.finalizeStoppedGeneration(assistantMessageId);
        return;
      }

      this.logger.error('AI image upscaling error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.chatError.set(message);
      this.replaceMessageContent(assistantMessageId, `Image upscaling error: ${message}`, false);
      this.finishMessageProcessing(assistantMessageId);
      this.persistCurrentConversation();
    } finally {
      this.isGenerating.set(false);
    }
  }

  private finalizeStoppedGeneration(assistantMessageId: string): void {
    const currentReply = this.getMessageContent(assistantMessageId).trimEnd();
    this.chatError.set('');
    this.replaceMessageContent(assistantMessageId, currentReply || 'Generation stopped.', false);
    this.finishMessageProcessing(assistantMessageId);
    this.persistCurrentConversation();
  }

  private async buildImageGenerationOptions(model: ModelInfo, attachments: ComposerAttachment[]): Promise<AiImageGenerationOptions | undefined> {
    if (attachments.length === 0) {
      return undefined;
    }

    if (model.provider !== 'xai') {
      throw new Error('Hosted image attachments are currently supported only for xAI / Grok image generation.');
    }

    const imageAttachments = attachments.filter(attachment => attachment.mimeType.startsWith('image/'));
    if (imageAttachments.length !== attachments.length) {
      throw new Error('xAI image generation only supports image attachments.');
    }

    return {
      inputImages: await Promise.all(imageAttachments.map(attachment => attachment.sourceUrl?.trim()
        ? Promise.resolve(attachment.sourceUrl.trim())
        : this.readAttachmentAsDataUrl(attachment))),
    };
  }

  private async buildVideoGenerationOptions(attachments: ComposerAttachment[]): Promise<AiVideoGenerationOptions | undefined> {
    if (attachments.length === 0) {
      if (this.xAiVideoMode() === 'extend-video') {
        throw new Error('Attach one source video to use Grok video extension mode.');
      }

      return undefined;
    }

    const imageAttachments = attachments.filter(attachment => attachment.mimeType.startsWith('image/'));
    const videoAttachments = attachments.filter(attachment => attachment.mimeType.startsWith('video/'));

    if (imageAttachments.length > 0 && videoAttachments.length > 0) {
      throw new Error('Use either image attachments or a single video attachment for Grok video generation, not both together.');
    }

    if (videoAttachments.length > 1) {
      throw new Error('Attach at most one source video when editing or extending with Grok video.');
    }

    if (videoAttachments.length === 1) {
      return {
        mode: this.xAiVideoMode(),
        inputVideo: await this.readAttachmentAsDataUrl(videoAttachments[0]),
      };
    }

    if (imageAttachments.length === 1) {
      if (this.xAiVideoMode() === 'extend-video') {
        throw new Error('Grok video extension mode requires a video attachment, not an image.');
      }

      return {
        mode: 'generate',
        inputImage: await this.readAttachmentAsDataUrl(imageAttachments[0]),
      };
    }

    if (imageAttachments.length > 1) {
      if (this.xAiVideoMode() === 'extend-video') {
        throw new Error('Grok video extension mode requires a single source video attachment.');
      }

      return {
        mode: 'generate',
        referenceImages: await Promise.all(imageAttachments.map(attachment => this.readAttachmentAsDataUrl(attachment))),
      };
    }

    throw new Error('Grok video generation supports image or video attachments only.');
  }

  private resolveVideoOperation(options?: AiVideoGenerationOptions): 'generate' | 'animate' | 'reference' | 'edit' | 'extend' {
    if (options?.mode === 'extend-video') {
      return 'extend';
    }

    if (options?.inputVideo) {
      return 'edit';
    }

    if (options?.referenceImages?.length) {
      return 'reference';
    }

    if (options?.inputImage) {
      return 'animate';
    }

    return 'generate';
  }

  private beginVideoOperation(operation: 'generate' | 'animate' | 'reference' | 'edit' | 'extend'): void {
    this.activeVideoOperation.set(operation);
    this.activeVideoStartedAt.set(Date.now());
    this.activeVideoStatus.set(null);
    this.activeVideoProgress.set(null);
    this.statusClock.set(Date.now());
  }

  private endVideoOperation(): void {
    this.activeVideoOperation.set(null);
    this.activeVideoStartedAt.set(null);
    this.activeVideoStatus.set(null);
    this.activeVideoProgress.set(null);
  }

  private updateVideoGenerationProgress(progress: AiVideoGenerationProgress): void {
    this.activeVideoStatus.set(progress.status);
    this.activeVideoProgress.set(typeof progress.progress === 'number' ? progress.progress : null);
  }

  private prepareGeneratedVideo(video: AiGeneratedVideo): AiGeneratedVideo {
    return {
      ...video,
      originalUrl: video.originalUrl || video.src,
      mimeType: video.mimeType || 'video/mp4',
    };
  }

  private async cacheGeneratedImage(
    image: AiGeneratedImage,
    options?: { maxAttempts?: number; delayMs?: number; logFailure?: boolean },
  ): Promise<AiGeneratedImage> {
    if (!this.isBrowser || typeof caches === 'undefined') {
      return image;
    }

    const cacheKey = `https://nostria.local/cache/ai/generated/${encodeURIComponent(image.id)}`;
    const blob = await this.fetchGeneratedAssetBlob(image.originalUrl || image.src, 'image', options);
    if (!blob) {
      return image;
    }

    const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
    await cache.put(cacheKey, new Response(blob, {
      headers: new Headers({
        'content-type': blob.type || image.mimeType || 'image/png',
      }),
    }));

    return {
      ...image,
      cacheKey,
      mimeType: blob.type || image.mimeType || 'image/png',
    };
  }

  private queueGeneratedImageCacheBackfill(images: AiGeneratedImage[]): void {
    const imagesToCache = images.filter(image => !image.cacheKey && !this.pendingGeneratedImageCacheIds.has(image.id));
    if (imagesToCache.length === 0) {
      return;
    }

    imagesToCache.forEach(image => this.pendingGeneratedImageCacheIds.add(image.id));
    void this.backfillGeneratedImagesInCache(imagesToCache);
  }

  private async backfillGeneratedImagesInCache(images: AiGeneratedImage[]): Promise<void> {
    try {
      const recachedImages = await Promise.all(images.map(image => this.cacheGeneratedImage(image, {
        maxAttempts: 20,
        delayMs: 1500,
        logFailure: false,
      })));
      const updatedImages = recachedImages.filter((image, index) => image.cacheKey && image.cacheKey !== images[index].cacheKey);
      if (updatedImages.length > 0) {
        this.replaceGeneratedImages(updatedImages);
      }
    } finally {
      images.forEach(image => this.pendingGeneratedImageCacheIds.delete(image.id));
    }
  }

  private replaceGeneratedImages(updatedImages: AiGeneratedImage[]): void {
    const updatedById = new Map(updatedImages.map(image => [image.id, image]));
    this.conversation.update(messages => messages.map(message => {
      if (!message.generatedImages?.some(image => updatedById.has(image.id))) {
        return message;
      }

      return {
        ...message,
        generatedImages: message.generatedImages.map(image => updatedById.get(image.id) ?? image),
      };
    }));
    this.persistCurrentConversation();
  }

  private async fetchGeneratedAssetBlob(
    url: string,
    assetType: 'image' | 'video',
    options?: { maxAttempts?: number; delayMs?: number; logFailure?: boolean },
  ): Promise<Blob | null> {
    const maxAttempts = options?.maxAttempts ?? 4;
    const delayMs = options?.delayMs ?? 750;
    const logFailure = options?.logFailure ?? true;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Could not cache generated ${assetType} (${response.status}).`);
        }

        return await response.blob();
      } catch (error) {
        if (attempt === maxAttempts) {
          if (logFailure) {
            this.logger.warn(`Failed to cache generated ${assetType}; keeping original URL instead.`, error);
          }
          return null;
        }

        await this.delay(delayMs);
      }
    }

    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      globalThis.setTimeout(resolve, ms);
    });
  }

  private async cacheGeneratedVideo(
    video: AiGeneratedVideo,
    options?: { maxAttempts?: number; delayMs?: number; logFailure?: boolean },
  ): Promise<AiGeneratedVideo> {
    if (!this.isBrowser || typeof caches === 'undefined') {
      return video;
    }

    const cacheKey = `https://nostria.local/cache/ai/generated/${encodeURIComponent(video.id)}`;
    const blob = await this.fetchGeneratedAssetBlob(video.originalUrl || video.src, 'video', options);
    if (!blob) {
      return {
        ...video,
        originalUrl: video.originalUrl || video.src,
      };
    }

    const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
    await cache.put(cacheKey, new Response(blob, {
      headers: new Headers({
        'content-type': blob.type || video.mimeType || 'video/mp4',
      }),
    }));

    return {
      ...video,
      src: URL.createObjectURL(blob),
      originalUrl: video.originalUrl || video.src,
      cacheKey,
      mimeType: blob.type || video.mimeType || 'video/mp4',
    };
  }

  private queueGeneratedVideoCacheBackfill(videos: AiGeneratedVideo[]): void {
    const videosToCache = videos.filter(video => !video.cacheKey && !this.pendingGeneratedVideoCacheIds.has(video.id));
    if (videosToCache.length === 0) {
      return;
    }

    videosToCache.forEach(video => this.pendingGeneratedVideoCacheIds.add(video.id));
    void this.backfillGeneratedVideosInCache(videosToCache);
  }

  private async backfillGeneratedVideosInCache(videos: AiGeneratedVideo[]): Promise<void> {
    try {
      const recachedVideos = await Promise.all(videos.map(video => this.cacheGeneratedVideo(video, {
        maxAttempts: 20,
        delayMs: 1500,
        logFailure: false,
      })));
      const updatedVideos = recachedVideos.filter((video, index) => video.cacheKey && video.cacheKey !== videos[index].cacheKey);
      if (updatedVideos.length > 0) {
        this.replaceGeneratedVideos(updatedVideos);
      }
    } finally {
      videos.forEach(video => this.pendingGeneratedVideoCacheIds.delete(video.id));
    }
  }

  private replaceGeneratedVideos(updatedVideos: AiGeneratedVideo[]): void {
    const updatedById = new Map(updatedVideos.map(video => [video.id, video]));
    this.conversation.update(messages => messages.map(message => {
      if (!message.generatedVideos?.some(video => updatedById.has(video.id))) {
        return message;
      }

      return {
        ...message,
        generatedVideos: message.generatedVideos.map(video => {
          const updatedVideo = updatedById.get(video.id);
          if (!updatedVideo) {
            return video;
          }

          if (video.src.startsWith('blob:') && video.src !== updatedVideo.src) {
            URL.revokeObjectURL(video.src);
          }

          return updatedVideo;
        }),
      };
    }));
    this.persistCurrentConversation();
  }

  private async cacheGeneratedAudio(audio: AiGeneratedAudio): Promise<AiGeneratedAudio> {
    if (!this.isBrowser || typeof caches === 'undefined') {
      return audio;
    }

    const cacheKey = `https://nostria.local/cache/ai/generated/${encodeURIComponent(audio.id)}`;
    const response = await fetch(audio.src);
    if (!response.ok) {
      throw new Error(`Could not cache generated audio (${response.status}).`);
    }

    const blob = await response.blob();
    const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
    await cache.put(cacheKey, new Response(blob, {
      headers: new Headers({
        'content-type': blob.type || audio.mimeType || 'audio/mpeg',
      }),
    }));

    return {
      ...audio,
      src: URL.createObjectURL(blob),
      cacheKey,
      mimeType: blob.type || audio.mimeType || 'audio/mpeg',
    };
  }

  private async removeGeneratedImagesFromCache(images?: AiGeneratedImage[], retainedCacheKeys?: ReadonlySet<string>): Promise<void> {
    if (!this.isBrowser || typeof caches === 'undefined' || !images?.length) {
      return;
    }

    const cacheKeys = images
      .map(image => image.cacheKey)
      .filter((cacheKey): cacheKey is string => !!cacheKey && !retainedCacheKeys?.has(cacheKey));
    await this.removeCacheEntries(cacheKeys, 'Failed to delete generated image cache entries');
  }

  private async removeGeneratedVideosFromCache(videos?: AiGeneratedVideo[], retainedCacheKeys?: ReadonlySet<string>): Promise<void> {
    if (!this.isBrowser || typeof caches === 'undefined' || !videos?.length) {
      return;
    }

    const cacheKeys = videos
      .map(video => video.cacheKey)
      .filter((cacheKey): cacheKey is string => !!cacheKey && !retainedCacheKeys?.has(cacheKey));
    await this.removeCacheEntries(cacheKeys, 'Failed to delete generated video cache entries');
  }

  private async removeGeneratedAudiosFromCache(audios?: AiGeneratedAudio[], retainedCacheKeys?: ReadonlySet<string>): Promise<void> {
    if (!this.isBrowser || typeof caches === 'undefined' || !audios?.length) {
      return;
    }

    const cacheKeys = audios
      .map(audio => audio.cacheKey)
      .filter((cacheKey): cacheKey is string => !!cacheKey && !retainedCacheKeys?.has(cacheKey));
    await this.removeCacheEntries(cacheKeys, 'Failed to delete generated audio cache entries');
  }

  private async removeConversationAttachmentsFromCache(messages: ConversationMessage[]): Promise<void> {
    const cacheKeys = messages.flatMap(message => message.attachments?.map(attachment => attachment.cacheKey) ?? []);
    await this.removeCacheEntries(cacheKeys, 'Failed to delete chat attachment cache entries');
  }

  private async removeHistoryAssetsFromCache(history: import('../../services/ai-chat-history.service').AiChatHistoryEntry): Promise<void> {
    const cacheKeys = history.messages.flatMap(message => [
      ...(message.generatedImages?.map(image => image.cacheKey).filter((cacheKey): cacheKey is string => !!cacheKey) ?? []),
      ...(message.generatedVideos?.map(video => video.cacheKey).filter((cacheKey): cacheKey is string => !!cacheKey) ?? []),
      ...(message.generatedAudios?.map(audio => audio.cacheKey).filter((cacheKey): cacheKey is string => !!cacheKey) ?? []),
    ]);

    await this.removeCacheEntries(cacheKeys, 'Failed to delete chat asset cache entries');
  }

  private async removeCacheEntries(cacheKeys: string[], warningMessage: string): Promise<void> {
    if (!this.isBrowser || typeof caches === 'undefined' || cacheKeys.length === 0) {
      return;
    }

    try {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      await Promise.all([...new Set(cacheKeys)].map(cacheKey => cache.delete(cacheKey)));
    } catch (error) {
      this.logger.warn(warningMessage, error);
    }
  }

  private async restoreGeneratedImages(images: AiHistoryGeneratedImage[]): Promise<AiGeneratedImage[]> {
    return Promise.all(images.map(async image => ({
      ...image,
      src: await this.resolveGeneratedImageSource(image),
    })));
  }

  private async restoreGeneratedVideos(videos: AiHistoryGeneratedVideo[]): Promise<AiGeneratedVideo[]> {
    return Promise.all(videos.map(async video => ({
      ...video,
      src: await this.resolveGeneratedVideoSource(video),
    })));
  }

  private async restoreGeneratedAudios(audios: AiHistoryGeneratedAudio[]): Promise<AiGeneratedAudio[]> {
    return Promise.all(audios.map(async audio => ({
      ...audio,
      src: await this.resolveGeneratedAudioSource(audio),
    })));
  }

  private async resolveGeneratedImageSource(image: AiHistoryGeneratedImage): Promise<string> {
    if (!this.isBrowser || typeof caches === 'undefined' || !image.cacheKey) {
      return image.originalUrl ?? '';
    }

    try {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      const response = await cache.match(image.cacheKey);
      if (!response?.ok) {
        return image.originalUrl ?? '';
      }

      const blob = await response.blob();
      return await this.blobToDataUrl(blob);
    } catch (error) {
      this.logger.warn('Failed to restore generated image from cache', error);
      return image.originalUrl ?? '';
    }
  }

  private async resolveGeneratedVideoSource(video: AiHistoryGeneratedVideo): Promise<string> {
    if (!this.isBrowser || typeof caches === 'undefined' || !video.cacheKey) {
      return video.originalUrl ?? '';
    }

    try {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      const response = await cache.match(video.cacheKey);
      if (!response?.ok) {
        return video.originalUrl ?? '';
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (error) {
      this.logger.warn('Failed to restore generated video from cache', error);
      return video.originalUrl ?? '';
    }
  }

  private async resolveGeneratedAudioSource(audio: AiHistoryGeneratedAudio): Promise<string> {
    if (!this.isBrowser || typeof caches === 'undefined' || !audio.cacheKey) {
      return '';
    }

    try {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      const response = await cache.match(audio.cacheKey);
      if (!response?.ok) {
        return '';
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (error) {
      this.logger.warn('Failed to restore generated audio from cache', error);
      return '';
    }
  }

  private releaseGeneratedVideoUrls(videos?: AiGeneratedVideo[]): void {
    if (!videos?.length) {
      return;
    }

    for (const video of videos) {
      if (video.src.startsWith('blob:')) {
        URL.revokeObjectURL(video.src);
      }
    }
  }

  private releaseGeneratedAudioUrls(audios?: AiGeneratedAudio[]): void {
    if (!audios?.length) {
      return;
    }

    for (const audio of audios) {
      if (audio.src.startsWith('blob:')) {
        URL.revokeObjectURL(audio.src);
      }
    }
  }

  private releaseObjectUrls(urls: string[]): void {
    for (const url of urls) {
      URL.revokeObjectURL(url);
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('Could not read image data.'));
      reader.readAsDataURL(blob);
    });
  }

  private async createFileFromGeneratedImage(image: AiGeneratedImage): Promise<File> {
    const blob = await this.getGeneratedImageBlob(image);
    const extension = this.fileExtensionForMimeType(blob.type || image.mimeType || 'image/png');
    return new File([blob], `${image.id}.${extension}`, { type: blob.type || image.mimeType || 'image/png' });
  }

  private async createAttachmentFromGeneratedImage(image: AiGeneratedImage): Promise<ComposerAttachment> {
    if (!image.cacheKey) {
      const file = await this.createFileFromGeneratedImage(image);
      return this.createAttachment(file);
    }

    const blob = await this.getGeneratedImageBlob(image);
    const mimeType = blob.type || image.mimeType || 'image/png';
    const extension = this.fileExtensionForMimeType(mimeType);
    const fileName = `${image.id}.${extension}`;

    return {
      id: `generated-${image.id}`,
      name: fileName,
      size: blob.size,
      mimeType,
      kind: 'file',
      context: `- ${fileName} (${mimeType}, ${this.formatFileSize(blob.size)}). Binary file attached; include only its metadata in your reasoning.`,
      cacheKey: image.cacheKey,
      sourceUrl: image.provider === 'xai' ? image.originalUrl : undefined,
      previewUrl: URL.createObjectURL(blob),
    };
  }

  private async createFileFromGeneratedVideo(video: AiGeneratedVideo): Promise<File> {
    const blob = await this.getGeneratedVideoBlob(video);
    const extension = this.fileExtensionForMimeType(blob.type || video.mimeType || 'video/mp4');
    return new File([blob], `${video.id}.${extension}`, { type: blob.type || video.mimeType || 'video/mp4' });
  }

  private async createFileFromGeneratedAudio(audio: AiGeneratedAudio): Promise<File> {
    const blob = await this.getGeneratedAudioBlob(audio);
    const extension = this.fileExtensionForMimeType(blob.type || audio.mimeType || 'audio/mpeg');
    return new File([blob], `${audio.id}.${extension}`, { type: blob.type || audio.mimeType || 'audio/mpeg' });
  }

  private async getGeneratedImageBlob(image: AiGeneratedImage): Promise<Blob> {
    if (this.isBrowser && typeof caches !== 'undefined' && image.cacheKey) {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      const cached = await cache.match(image.cacheKey);
      if (cached?.ok) {
        return cached.blob();
      }
    }

    const remoteSources = [image.originalUrl, image.src]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    for (const source of remoteSources) {
      try {
        return await this.fetchImageBlobWithProxyFallback(source);
      } catch {
        continue;
      }
    }

    throw new Error('Could not fetch generated image.');
  }

  private async fetchImageBlobWithProxyFallback(url: string): Promise<Blob> {
    const response = await this.corsProxy.fetch(url);
    if (!response.ok) {
      throw new Error(`Could not fetch asset (${response.status}).`);
    }

    return response.blob();
  }

  private async getGeneratedVideoBlob(video: AiGeneratedVideo): Promise<Blob> {
    if (this.isBrowser && typeof caches !== 'undefined' && video.cacheKey) {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      const cached = await cache.match(video.cacheKey);
      if (cached?.ok) {
        return cached.blob();
      }
    }

    return this.fetchGeneratedVideoBlobWithRetry(video, 'download');
  }

  formatUsdTicks(costInUsdTicks: number | undefined): string {
    if (typeof costInUsdTicks !== 'number' || !Number.isFinite(costInUsdTicks)) {
      return '';
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(costInUsdTicks / 10_000_000_000);
  }

  private async fetchGeneratedVideoBlobWithRetry(video: Pick<AiGeneratedVideo, 'src' | 'originalUrl' | 'mimeType'>, reason: 'cache' | 'download'): Promise<Blob> {
    const videoUrl = (video.originalUrl || video.src || '').trim();
    if (!videoUrl) {
      throw new Error('Could not fetch generated video.');
    }

    let lastError: unknown = null;

    for (let attempt = 0; attempt < AiComponent.GENERATED_VIDEO_FETCH_MAX_ATTEMPTS; attempt += 1) {
      const delayMs = attempt === 0
        ? AiComponent.GENERATED_VIDEO_FETCH_INITIAL_DELAY_MS
        : AiComponent.GENERATED_VIDEO_FETCH_RETRY_DELAY_MS;
      await this.delay(delayMs);

      try {
        const response = await fetch(videoUrl);
        if (!response.ok) {
          throw new Error(`Could not ${reason} generated video (${response.status}).`);
        }

        return await response.blob();
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Could not ${reason} generated video.`);
  }

  private async getGeneratedAudioBlob(audio: AiGeneratedAudio): Promise<Blob> {
    if (this.isBrowser && typeof caches !== 'undefined' && audio.cacheKey) {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      const cached = await cache.match(audio.cacheKey);
      if (cached?.ok) {
        return cached.blob();
      }
    }

    const response = await fetch(audio.src);
    if (!response.ok) {
      throw new Error(`Could not fetch generated audio (${response.status}).`);
    }

    return response.blob();
  }

  private fileExtensionForMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/webp':
        return 'webp';
      case 'image/gif':
        return 'gif';
      case 'video/mp4':
        return 'mp4';
      case 'video/webm':
        return 'webm';
      case 'audio/wav':
      case 'audio/x-wav':
        return 'wav';
      case 'audio/mpeg':
      case 'audio/mp3':
        return 'mp3';
      default:
        return 'png';
    }
  }

  private toHistoryGeneratedImage(image: AiGeneratedImage): AiHistoryGeneratedImage {
    return {
      id: image.id,
      provider: image.provider,
      providerLabel: image.providerLabel,
      model: image.model,
      prompt: image.prompt,
      revisedPrompt: image.revisedPrompt,
      originalUrl: image.originalUrl,
      cacheKey: image.cacheKey,
      mimeType: image.mimeType,
      imageSettings: image.imageSettings,
    };
  }

  private toHistoryGeneratedVideo(video: AiGeneratedVideo): AiHistoryGeneratedVideo {
    return {
      id: video.id,
      provider: video.provider,
      providerLabel: video.providerLabel,
      model: video.model,
      prompt: video.prompt,
      originalUrl: video.originalUrl,
      costInUsdTicks: video.costInUsdTicks,
      cacheKey: video.cacheKey,
      mimeType: video.mimeType,
      duration: video.duration,
    };
  }

  private toHistoryGeneratedAudio(audio: AiGeneratedAudio): AiHistoryGeneratedAudio {
    return {
      id: audio.id,
      provider: audio.provider,
      providerLabel: audio.providerLabel,
      model: audio.model,
      prompt: audio.prompt,
      cacheKey: audio.cacheKey,
      mimeType: audio.mimeType,
      voiceId: audio.voiceId,
      language: audio.language,
      voiceSettings: audio.voiceSettings,
    };
  }

  private async preparePromptSubmission(model: ModelInfo, promptText: string, attachments: ComposerAttachment[]): Promise<{ prompt: string; attachmentContext: string }> {
    const fetchedContexts = await this.resolveFetchedPromptContexts(model, promptText);
    const prompt = this.resolvePromptText(promptText, attachments, fetchedContexts);

    return {
      prompt,
      attachmentContext: this.combinePromptContexts(
        this.buildAttachmentContext(attachments),
        this.buildFetchedPromptContext(fetchedContexts),
      ),
    };
  }

  private resolvePromptText(promptText: string, attachments: ComposerAttachment[], fetchedContexts: FetchedPromptContext[]): string {
    const cleanedPrompt = this.stripFetchCommands(promptText);
    if (cleanedPrompt) {
      return cleanedPrompt;
    }

    if (attachments.length > 0 && fetchedContexts.length > 0) {
      return 'Use the attached files and fetched page content as context.';
    }

    if (attachments.length > 0) {
      return 'Please analyze the attached files.';
    }

    if (fetchedContexts.length === 1) {
      return `Use the fetched page content from ${fetchedContexts[0].url} as context.`;
    }

    if (fetchedContexts.length > 1) {
      return 'Use the fetched page content as context.';
    }

    return '';
  }

  private combinePromptContexts(...contexts: string[]): string {
    return contexts
      .map(context => context.trim())
      .filter(context => context.length > 0)
      .join('\n\n');
  }

  private async resolveFetchedPromptContexts(model: ModelInfo, promptText: string): Promise<FetchedPromptContext[]> {
    const urls = this.extractFetchUrls(promptText);
    if (urls.length === 0 && AiComponent.FETCH_KEYWORD_PATTERN.test(promptText)) {
      throw new Error('Invalid #fetch URL. Use #fetch followed by a URL or domain name.');
    }

    if (urls.length === 0) {
      return [];
    }

    const fetchContextCharLimit = model.fetchContextCharLimit ?? AiComponent.FETCH_MARKDOWN_CHAR_LIMIT;
    return Promise.all(urls.map(url => this.fetchMarkdownContext(url, fetchContextCharLimit)));
  }

  private extractFetchUrls(promptText: string): string[] {
    const matches = Array.from(promptText.matchAll(AiComponent.FETCH_COMMAND_PATTERN));
    if (matches.length === 0) {
      return [];
    }

    const uniqueUrls = new Set<string>();
    for (const match of matches) {
      const rawUrl = match[2]?.trim();
      if (!rawUrl) {
        continue;
      }

      uniqueUrls.add(this.normalizeFetchUrl(rawUrl));
    }

    return Array.from(uniqueUrls);
  }

  private normalizeFetchUrl(rawUrl: string): string {
    const normalizedInput = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(normalizedInput);
    } catch {
      throw new Error('Invalid #fetch URL. Use #fetch followed by a URL or domain name.');
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('The #fetch command only supports http and https URLs.');
    }

    return parsedUrl.toString();
  }

  private stripFetchCommands(promptText: string): string {
    const withoutCommands = promptText.replace(AiComponent.FETCH_COMMAND_PATTERN, '$1');

    return withoutCommands
      .replace(/[\t ]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[\t ]{2,}/g, ' ')
      .trim();
  }

  private async fetchMarkdownContext(url: string, charLimit = AiComponent.FETCH_MARKDOWN_CHAR_LIMIT): Promise<FetchedPromptContext> {
    const metadataBaseUrl = environment.metadataUrl.endsWith('/')
      ? environment.metadataUrl
      : `${environment.metadataUrl}/`;
    const apiUrl = `${metadataBaseUrl}markdown?url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl, {
      headers: {
        accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1',
      },
    });

    if (!response.ok) {
      throw new Error(`Could not fetch markdown content for ${url}.`);
    }

    const markdown = (await response.text()).trim();
    if (!markdown) {
      throw new Error(`No markdown content was returned for ${url}.`);
    }

    const truncatedMarkdown = markdown.length > charLimit
      ? `${markdown.slice(0, charLimit).trimEnd()}\n\n[Truncated for AI context]`
      : markdown;

    return {
      url,
      markdown: truncatedMarkdown,
    };
  }

  private buildFetchedPromptContext(fetchedContexts: FetchedPromptContext[]): string {
    if (fetchedContexts.length === 0) {
      return '';
    }

    return [
      'Fetched web content:',
      ...fetchedContexts.map(({ url, markdown }) => `- Source: ${url}\n\n\`\`\`markdown\n${markdown}\n\`\`\``),
    ].join('\n\n');
  }

  private buildGenerationInput(model: ModelInfo, conversation: ConversationMessage[]): string | AiChatMessage[] {
    if (model.chatMode === 'messages') {
      return [
        { role: 'system', content: this.systemPrompt },
        ...conversation.map(message => ({
          role: message.role,
          content: this.buildGenerationMessageContent(message),
        })),
      ];
    }

    const transcript = conversation
      .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${this.buildGenerationMessageContent(message)}`)
      .join('\n\n');

    return `${this.systemPrompt}\n\n${transcript}\n\nAssistant:`;
  }

  private resolveGenerationErrorMessage(model: ModelInfo, error: unknown, attachmentContext = ''): string {
    const message = error instanceof Error ? error.message : String(error);
    const includesFetchedContext = attachmentContext.includes('Fetched web content:');

    if (model.id === 'onnx-community/gemma-4-E2B-it-ONNX' && message.includes('operation does not support unaligned accesses')) {
      return includesFetchedContext
        ? 'Gemma 4 hit a WebGPU runtime limitation while processing fetched page content. The #fetch command itself is already stripped before inference, but the fetched markdown context can still trigger this Gemma backend error. Try Qwen 3.5, a cloud model, or a shorter fetched page.'
        : 'Gemma 4 hit a WebGPU runtime limitation in this browser. Try Qwen 3.5 or a cloud model for this prompt.';
    }

    return message;
  }

  private async buildMultimodalGenerationInput(conversation: ConversationMessage[]): Promise<AiMultimodalChatMessage[]> {
    const messages = await Promise.all(conversation.map(message => this.buildMultimodalMessage(message)));
    return [
      {
        role: 'system',
        content: [{ type: 'text', text: this.systemPrompt }],
      },
      ...messages,
    ];
  }

  private async buildMultimodalMessage(message: ConversationMessage): Promise<AiMultimodalChatMessage> {
    const parts: AiMultimodalChatPart[] = [];
    const imageAttachments = (message.attachments ?? []).filter(attachment => attachment.mimeType.startsWith('image/'));

    for (const attachment of imageAttachments) {
      parts.push({
        type: 'image',
        image: await this.readAttachmentBlob(attachment),
      });
    }

    const text = this.buildGenerationMessageContent(message).trim();
    if (text || parts.length === 0) {
      parts.push({ type: 'text', text });
    }

    return {
      role: message.role,
      content: parts,
    };
  }

  private buildGenerationMessageContent(message: ConversationMessage): string {
    if (!message.attachmentContext) {
      return message.content;
    }

    return `${message.content}\n\n${message.attachmentContext}`.trim();
  }

  private buildAttachmentContext(attachments: ComposerAttachment[]): string {
    if (attachments.length === 0) {
      return '';
    }

    return [
      'Attached files:',
      ...attachments.map(attachment => attachment.context),
    ].join('\n\n');
  }

  private async createAttachment(file: File): Promise<ComposerAttachment> {
    const mimeType = file.type || 'application/octet-stream';
    const isTextFile = this.isTextLikeFile(file);
    const fileId = `${file.name}-${file.lastModified}-${file.size}-${this.createMessageId()}`;
    const cacheKey = this.getAiUploadCacheKey(fileId, file.name);
    const previewUrl = mimeType.startsWith('image/') ? URL.createObjectURL(file) : undefined;

    await this.storeFileInCache(cacheKey, file);

    if (!isTextFile) {
      return {
        id: fileId,
        name: file.name,
        size: file.size,
        mimeType,
        kind: 'file',
        context: `- ${file.name} (${mimeType}, ${this.formatFileSize(file.size)}). Binary file attached; include only its metadata in your reasoning.`,
        cacheKey,
        previewUrl,
      };
    }

    const rawText = await this.readCachedFileText(cacheKey, file);
    const truncated = rawText.length > 12000 ? rawText.slice(0, 12000) : rawText;
    const note = rawText.length > truncated.length ? '\n[Truncated for local context]' : '';
    const languageHint = this.fileLanguageHint(file.name);
    const codeFence = languageHint ? `\`\`\`${languageHint}` : '```';

    return {
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType,
      kind: 'text',
      context: `- ${file.name} (${mimeType}, ${this.formatFileSize(file.size)})\n\n${codeFence}\n${truncated}${note}\n${'```'}`,
      cacheKey,
      previewUrl,
    };
  }

  private async createMessageAttachments(attachments: ComposerAttachment[]): Promise<ComposerAttachment[] | undefined> {
    if (attachments.length === 0) {
      return undefined;
    }

    return Promise.all(attachments.map(async attachment => {
      if (!attachment.mimeType.startsWith('image/')) {
        return { ...attachment };
      }

      const blob = await this.readAttachmentBlob(attachment);
      return {
        ...attachment,
        previewUrl: URL.createObjectURL(blob),
      };
    }));
  }

  private setComposerAttachments(attachments: ComposerAttachment[]): void {
    this.releaseAttachmentPreviewUrls(this.attachedFiles());
    this.attachedFiles.set(attachments);
  }

  private clearAttachedFiles(): void {
    this.releaseAttachmentPreviewUrls(this.attachedFiles());
    this.attachedFiles.set([]);
  }

  private releaseAttachmentPreviewUrls(attachments?: ComposerAttachment[]): void {
    if (!attachments?.length) {
      return;
    }

    for (const attachment of attachments) {
      if (attachment.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    }
  }

  private releaseConversationAttachmentPreviewUrls(messages: ConversationMessage[]): void {
    for (const message of messages) {
      this.releaseAttachmentPreviewUrls(message.attachments);
    }
  }

  private getAiUploadCacheKey(attachmentId: string, fileName: string): string {
    return `https://nostria.local/cache/ai/${encodeURIComponent(attachmentId)}/${encodeURIComponent(fileName)}`;
  }

  private async storeFileInCache(cacheKey: string, file: File): Promise<void> {
    if (!this.isBrowser || typeof caches === 'undefined') {
      return;
    }

    try {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      await cache.put(cacheKey, new Response(file, {
        headers: new Headers({
          'content-type': file.type || 'application/octet-stream',
          'x-nostria-file-name': file.name,
        }),
      }));
    } catch (error) {
      this.logger.warn('Failed to write AI upload cache', error);
    }
  }

  private async readCachedFileText(cacheKey: string, file: File): Promise<string> {
    if (!this.isBrowser || typeof caches === 'undefined') {
      return file.text();
    }

    try {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      const response = await cache.match(cacheKey);
      if (response?.ok) {
        return await response.text();
      }
    } catch (error) {
      this.logger.warn('Failed to read AI upload cache', error);
    }

    return file.text();
  }

  private async readAttachmentBlob(attachment: ComposerAttachment): Promise<Blob> {
    if (!this.isBrowser || typeof caches === 'undefined') {
      throw new Error('Attachment cache is unavailable in this browser.');
    }

    const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
    const response = await cache.match(attachment.cacheKey);
    if (!response?.ok) {
      throw new Error(`Could not load the attached image '${attachment.name}'.`);
    }

    return response.blob();
  }

  private async readAttachmentAsDataUrl(attachment: ComposerAttachment): Promise<string> {
    const blob = await this.readAttachmentBlob(attachment);
    return this.blobToDataUrl(blob);
  }

  private collectRetainedCacheKeys(messages: ConversationMessage[], attachments: ComposerAttachment[] = []): Set<string> {
    return new Set([
      ...messages.flatMap(message => message.attachments?.map(attachment => attachment.cacheKey) ?? []),
      ...messages.flatMap(message => message.generatedImages?.map(image => image.cacheKey).filter((cacheKey): cacheKey is string => !!cacheKey) ?? []),
      ...messages.flatMap(message => message.generatedVideos?.map(video => video.cacheKey).filter((cacheKey): cacheKey is string => !!cacheKey) ?? []),
      ...messages.flatMap(message => message.generatedAudios?.map(audio => audio.cacheKey).filter((cacheKey): cacheKey is string => !!cacheKey) ?? []),
      ...attachments.map(attachment => attachment.cacheKey),
    ]);
  }

  private isTextLikeFile(file: File): boolean {
    if (file.type.startsWith('text/')) {
      return true;
    }

    const textExtensions = new Set([
      'md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css', 'scss', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'rs', 'go', 'java', 'cs', 'php', 'sql', 'sh', 'ps1', 'log', 'csv', 'ini', 'conf', 'env',
    ]);
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    return textExtensions.has(extension);
  }

  private fileLanguageHint(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    switch (extension) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
        return 'javascript';
      case 'json':
        return 'json';
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'scss':
      case 'css':
        return extension;
      case 'html':
      case 'htm':
        return 'html';
      case 'yml':
      case 'yaml':
        return 'yaml';
      case 'py':
        return 'python';
      case 'sh':
        return 'bash';
      case 'ps1':
        return 'powershell';
      default:
        return '';
    }
  }

  private extractAssistantReply(result: unknown): string {
    if (!Array.isArray(result) || result.length === 0) {
      return 'No output was returned by the model.';
    }

    const firstResult = result[0] as { generated_text?: unknown };
    const generated = firstResult.generated_text;

    if (typeof generated === 'string') {
      return generated.trim() || 'The model returned an empty reply.';
    }

    if (Array.isArray(generated)) {
      const lastMessage = generated.at(-1) as { content?: string } | undefined;
      if (typeof lastMessage?.content === 'string' && lastMessage.content.trim().length > 0) {
        return lastMessage.content.trim();
      }
    }

    return JSON.stringify(firstResult, null, 2);
  }

  private async copyTextToClipboard(text: string): Promise<void> {
    if (!this.isBrowser || typeof navigator === 'undefined' || !navigator.clipboard) {
      throw new Error('Clipboard access is not available in this browser.');
    }

    await navigator.clipboard.writeText(text);
  }

  private parseArticleDraft(content: string): ArticleEditorDialogInitialDraft {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    const lines = normalized.split('\n');
    const hashtags = new Set<string>();

    const footerLines: string[] = [];
    let cursor = lines.length - 1;
    while (cursor >= 0) {
      const candidate = lines[cursor].trim();
      if (!candidate) {
        footerLines.unshift(lines[cursor]);
        cursor--;
        continue;
      }

      if (this.isHashtagFooterLine(candidate)) {
        footerLines.unshift(lines[cursor]);
        for (const tag of candidate.match(/#([a-zA-Z0-9_]+)/g) ?? []) {
          hashtags.add(tag.slice(1).toLowerCase());
        }
        cursor--;
        continue;
      }

      break;
    }

    const bodyLines = lines.slice(0, cursor + 1);
    while (bodyLines.length > 0 && !bodyLines[bodyLines.length - 1].trim()) {
      bodyLines.pop();
    }

    let title = '';
    if (bodyLines.length > 0) {
      const firstLine = bodyLines[0].trim();
      if (/^#{1,6}\s+/.test(firstLine)) {
        title = firstLine.replace(/^#{1,6}\s+/, '').trim();
        bodyLines.shift();
      } else if (firstLine.length > 0 && firstLine.length <= 120) {
        title = firstLine;
        bodyLines.shift();
      }
    }

    while (bodyLines.length > 0 && !bodyLines[0].trim()) {
      bodyLines.shift();
    }

    const body = bodyLines.join('\n').trim();
    const summarySource = body.split(/\n\n+/).find(paragraph => paragraph.trim().length > 0) ?? '';
    const summary = summarySource.length > 180 ? `${summarySource.slice(0, 177).trimEnd()}...` : summarySource;

    return {
      title,
      summary,
      content: body,
      tags: [...hashtags],
    };
  }

  private isHashtagFooterLine(value: string): boolean {
    return /^#?[a-zA-Z0-9_]+(?:[\s,]+#?[a-zA-Z0-9_]+)*$/.test(value) && value.includes('#');
  }
}
