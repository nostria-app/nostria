import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, PLATFORM_ID, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { AiChatMessage, AiCloudProvider, AiGeneratedImage, AiGenerationProgress, AiModelLoadOptions, AiMultimodalChatMessage, AiMultimodalChatPart, AiService } from '../../services/ai.service';
import { AiChatHistoryService, AiHistoryGeneratedImage } from '../../services/ai-chat-history.service';
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
  cloudModel?: string;
  loadOptions?: AiModelLoadOptions;
  chatMode?: 'messages' | 'prompt';
  chatDisabledReason?: string;
  preferredParams?: Record<string, unknown>;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  attachments?: ComposerAttachment[];
  attachmentContext?: string;
  generatedImages?: AiGeneratedImage[];
}

interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: 'text' | 'file';
  context: string;
  cacheKey: string;
}

interface AiQuickPrompt {
  label: string;
  prompt: string;
  task?: 'image-generation';
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
  task: 'image-generation' | 'image-upscaling';
  prompt: string;
}

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
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatSelectModule,
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
  readonly webGpuAvailable = this.isBrowser && typeof navigator !== 'undefined' && 'gpu' in navigator;
  readonly autoScrollPinned = signal(true);
  readonly splitPaneMode = computed(() => this.panelNav.hasRightContent() && !this.panelNav.isMobile());
  readonly currentConversationId = signal<string | null>(null);
  readonly narrowHistoryMode = signal(false);
  readonly showHistoryDrawer = signal(false);
  readonly historyQuery = signal('');
  readonly activeShareMessage = signal<ConversationMessage | null>(null);
  readonly activeGeneratedImage = signal<AiGeneratedImage | null>(null);
  readonly activeSuggestion = signal<AssistantSuggestion | null>(null);
  readonly renderedAssistantMessages = signal<Record<string, RenderedAssistantContent>>({});
  readonly attachedFiles = signal<ComposerAttachment[]>([]);
  readonly hideHistoryRail = computed(() => this.splitPaneMode() || this.narrowHistoryMode());

  readonly models = signal<ModelInfo[]>([
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
      preferredParams: {
        max_new_tokens: 384,
        do_sample: true,
        temperature: 0.7,
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
      id: 'onnx-community/Qwen3-1.7B-ONNX',
      task: 'text-generation',
      name: 'Qwen 3 1.7B',
      description: 'Higher-capacity Qwen 3 local chat model for stronger answers on capable GPUs.',
      size: '~1.7B parameters',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q4f16',
      loadOptions: { device: 'webgpu', dtype: 'q4f16' },
      chatMode: 'messages',
      chatDisabledReason: this.webGpuAvailable ? undefined : 'Requires WebGPU support in the browser.',
      preferredParams: {
        max_new_tokens: 512,
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
  ]);

  readonly localChatModels = computed(() => this.models().filter(model => this.isChatGenerationTask(model.task) && model.source !== 'cloud'));
  readonly cloudChatModels = computed<ModelInfo[]>(() => {
    const providers: AiCloudProvider[] = ['xai', 'openai'];
    return providers
      .filter(provider => this.aiService.hasCloudApiKey(provider))
      .map(provider => ({
        id: `cloud-chat:${provider}`,
        task: 'text-generation',
        name: this.aiService.getProviderLabel(provider),
        description: `Hosted chat replies through ${this.aiService.getProviderLabel(provider)}.`,
        size: 'Hosted API',
        loading: false,
        progress: 100,
        loaded: true,
        cached: false,
        runtime: `${this.aiService.getProviderLabel(provider)} API`,
        source: 'cloud',
        provider,
        cloudModel: this.aiService.getChatModel(provider),
        chatMode: 'messages',
      }));
  });
  readonly imageModels = computed<ModelInfo[]>(() => {
    const localImageModels = this.models().filter(model => model.task === 'image-generation' || model.task === 'image-upscaling');
    const preferredProvider = this.aiService.getActiveImageProvider();
    const providers: AiCloudProvider[] = ['xai', 'openai'];
    const sortedProviders = providers
      .filter(provider => this.aiService.hasCloudApiKey(provider))
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
  readonly composerModels = computed(() => [
    ...this.localChatModels(),
    ...this.cloudChatModels(),
    ...this.imageModels(),
  ]);
  readonly selectedModelId = signal(this.webGpuAvailable ? 'onnx-community/gemma-4-E2B-it-ONNX' : 'Xenova/distilgpt2');
  readonly selectedModel = computed(() => this.composerModels().find(model => model.id === this.selectedModelId()) ?? null);
  readonly isImageGenerationMode = computed(() => this.selectedModel()?.task === 'image-generation');
  readonly isImageUpscalingMode = computed(() => this.selectedModel()?.task === 'image-upscaling');
  readonly isImageMode = computed(() => this.isImageGenerationMode() || this.isImageUpscalingMode());
  readonly activeQuickPrompts = computed(() => {
    if (this.isImageGenerationMode()) {
      return this.imageQuickPrompts;
    }

    if (this.isImageUpscalingMode()) {
      return this.upscalingQuickPrompts;
    }

    return this.chatQuickPrompts;
  });
  readonly histories = this.historyService.histories;
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
    if (this.isGenerating() || this.selectedModel()?.chatDisabledReason || this.isImageMode()) {
      return false;
    }

    const lastMessage = this.conversation().at(-1);
    return lastMessage?.role === 'assistant' && !lastMessage.generatedImages?.length;
  });
  readonly chatQuickPrompts: AiQuickPrompt[] = [
    { label: 'Draft a post', prompt: 'Draft a short-form Nostr note post about [topic].' },
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
  readonly upscalingQuickPrompts: AiQuickPrompt[] = [
    { label: 'Enhance artwork', prompt: 'Upscale the attached artwork while keeping clean edges and fine line detail.' },
    { label: 'Sharpen photo', prompt: 'Upscale the attached photo and preserve natural textures.' },
    { label: 'Improve screenshot', prompt: 'Upscale the attached screenshot while keeping UI text crisp.' },
  ];
  readonly conversation = signal<ConversationMessage[]>([]);
  readonly composerText = signal('');
  readonly isGenerating = signal(false);
  readonly chatError = signal('');
  readonly workerProcessingState = this.aiService.processingState;
  readonly workerTaskLabel = computed(() => this.aiService.getTaskName(this.workerProcessingState().task));
  readonly activeModelProgress = computed(() => {
    const model = this.selectedModel();
    if (model?.loading) {
      return Math.max(0, Math.min(100, Math.round(model.progress)));
    }

    return null;
  });
  readonly processingStatusLabel = computed(() => {
    const model = this.selectedModel();
    if (model?.loading) {
      return model.cached ? `Loading ${model.name}...` : `Downloading ${model.name}...`;
    }

    return this.workerTaskLabel() || (this.isGenerating() ? 'Processing...' : '');
  });
  readonly processingStatusText = computed(() => this.processingStatusLabel().replace(/\.{3}$/, '').trim());
  readonly hasInlineStreamingIndicator = computed(() => this.conversation().some(message => message.role === 'assistant' && !!message.streaming && !message.content.trim().length && !(message.generatedImages?.length ?? 0)));
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
        this.snackBar.open(`Prompt ready: ${selection.title}`, 'Dismiss', { duration: 2600 });
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

  setActiveSuggestion(suggestion: AssistantSuggestion): void {
    this.activeSuggestion.set(suggestion);
  }

  createNewChat(): void {
    this.currentConversationId.set(null);
    this.attachedFiles.set([]);
    this.showHistoryDrawer.set(false);
    this.clearConversation();
  }

  async openHistory(historyId: string): Promise<void> {
    const history = this.historyService.getHistory(historyId);
    if (!history) {
      this.snackBar.open('That AI chat could not be found.', 'Dismiss', { duration: 4000 });
      return;
    }

    if (this.composerModels().some(model => model.id === history.modelId)) {
      this.selectedModelId.set(history.modelId);
    }

    this.currentConversationId.set(history.id);
    this.chatError.set('');
    this.attachedFiles.set([]);
    this.autoScrollPinned.set(true);
    this.showHistoryDrawer.set(false);
    this.conversation.set(await Promise.all(history.messages.map(async message => ({
      id: this.createMessageId(),
      role: message.role,
      content: message.content,
      generatedImages: message.generatedImages?.length
        ? await this.restoreGeneratedImages(message.generatedImages)
        : undefined,
    }))));
  }

  selectModel(modelId: string): void {
    this.selectedModelId.set(modelId);
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
    this.attachedFiles.update(attachments => attachments.filter(attachment => attachment.id !== id));
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

  applyActiveQuickPrompt(prompt: AiQuickPrompt): void {
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
    const history = this.historyService.getHistory(historyId);
    if (!history) {
      return;
    }

    this.historyService.deleteHistory(historyId);
    if (this.currentConversationId() === historyId) {
      this.createNewChat();
    }

    this.snackBar.open(`Removed '${history.title}'.`, 'Dismiss', { duration: 3000 });
  }

  async copyMessage(message: ConversationMessage): Promise<void> {
    try {
      await this.copyTextToClipboard(message.content);
      this.snackBar.open(message.role === 'assistant' ? 'Reply copied.' : 'Prompt copied.', 'Dismiss', { duration: 2400 });
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
      this.snackBar.open('Suggestion copied.', 'Dismiss', { duration: 2400 });
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

    this.composerText.set(this.suggestionShareContent(suggestion));
    this.snackBar.open('Suggestion moved into the composer.', 'Dismiss', { duration: 2400 });
  }

  async shareSuggestionToArticleEditor(): Promise<void> {
    const suggestion = this.activeSuggestion();
    if (!suggestion) {
      return;
    }

    const articleSource = this.suggestionArticleSource(suggestion);
    const draft = this.parseArticleDraft(articleSource);
    await this.layout.createArticle(undefined, undefined, draft);
    this.snackBar.open('Opened in article editor.', 'Dismiss', { duration: 2600 });
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
    this.snackBar.open('Opened in article editor.', 'Dismiss', { duration: 2600 });
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
      this.snackBar.open('Copied for public chat. Open a public chat and paste it there.', 'Dismiss', { duration: 3200 });
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
      this.snackBar.open('Opened in note editor.', 'Dismiss', { duration: 2600 });
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
        const published = await this.layout.publishSingleItem(uploadResult.item);
        if (published) {
          this.snackBar.open('Generated image published.', 'Dismiss', { duration: 2600 });
        }
        return;
      }

      throw new Error(uploadResult.message ?? 'Upload failed.');
    } catch (error) {
      this.logger.error('Failed to publish generated image', error);
      this.snackBar.open('Could not publish the generated image.', 'Dismiss', { duration: 3500 });
    }
  }

  reuseMessage(message: ConversationMessage): void {
    this.composerText.set(message.content);
    this.snackBar.open(message.role === 'assistant' ? 'Reply moved into the composer.' : 'Prompt ready to edit.', 'Dismiss', { duration: 2400 });
  }

  async deleteMessage(message: ConversationMessage): Promise<void> {
    const nextConversation = this.conversation().filter(entry => entry.id !== message.id);

    await this.removeGeneratedImagesFromCache(message.generatedImages);

    if (this.activeShareMessage()?.id === message.id) {
      this.activeShareMessage.set(null);
    }

    const activeGeneratedImage = this.activeGeneratedImage();
    if (activeGeneratedImage && message.generatedImages?.some(image => image.id === activeGeneratedImage.id)) {
      this.activeGeneratedImage.set(null);
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

    this.snackBar.open(message.role === 'assistant' ? 'Reply deleted.' : 'Prompt deleted.', 'Dismiss', { duration: 2400 });
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
      { id: assistantMessageId, role: 'assistant', content: '', streaming: true },
    ]);
    this.autoScrollPinned.set(true);

    if (model.source !== 'cloud' && !model.loaded) {
      const loaded = await this.ensureLocalModelReady(model);
      if (!loaded) {
        this.replaceMessageContent(assistantMessageId, 'The selected model could not be loaded in this browser.', false);
        this.persistCurrentConversation();
        return;
      }
    }

    this.isGenerating.set(true);

    try {
      let assistantReply: string;
      if (model.source === 'cloud' && model.provider) {
        const input = this.buildGenerationInput(model, generationConversation) as AiChatMessage[];
        assistantReply = await this.aiService.generateCloudText(input, model.provider, model.cloudModel);
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
      this.persistCurrentConversation();
    } catch (err) {
      if (this.aiService.isAbortError(err)) {
        this.finalizeStoppedGeneration(assistantMessageId);
        return;
      }

      this.logger.error('AI retry error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.chatError.set(message);
      this.replaceMessageContent(assistantMessageId, `Model error: ${message}`, false);
      this.persistCurrentConversation();
    } finally {
      this.isGenerating.set(false);
    }
  }

  useImagePromptInChat(image: AiGeneratedImage): void {
    const textModel = this.localChatModels()[0] ?? this.cloudChatModels()[0];
    if (textModel) {
      this.selectedModelId.set(textModel.id);
    }

    this.composerText.set(`Use this image concept as context and turn it into a polished post or product idea:\n\n${image.revisedPrompt || image.prompt}`);
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
      const file = await this.createFileFromGeneratedImage(image);
      const attachment = await this.createAttachment(file);
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
        mediaType: 'image',
        mediaTitle: image.revisedPrompt || image.prompt || 'Generated image',
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  downloadImage(image: AiGeneratedImage): void {
    if (!this.isBrowser || typeof document === 'undefined') {
      return;
    }

    const link = document.createElement('a');
    link.href = image.src;
    link.download = `${image.id}.png`;
    link.rel = 'noopener';
    link.click();
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
      return model.task === 'image-generation' ? 'Image' : 'Hosted';
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
            this.updateModelStatus(model.id, { progress: Math.max(currentProgress, progress.progress) });
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
    this.chatError.set('');
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

    if (model.task === 'image-upscaling') {
      await this.upscaleImageMessage(model, promptText, attachments);
      return;
    }

    let preparedPrompt: { prompt: string; attachmentContext: string };

    try {
      preparedPrompt = await this.preparePromptSubmission(promptText, attachments);
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
      attachments,
      attachmentContext: preparedPrompt.attachmentContext,
    };
    const generationConversation = [...this.conversation(), userMessage];
    this.conversation.set([
      ...generationConversation,
      { id: assistantMessageId, role: 'assistant', content: '', streaming: true },
    ]);
    this.composerText.set('');
    this.attachedFiles.set([]);
    this.autoScrollPinned.set(true);
    this.showHistoryDrawer.set(false);

    if (model.source !== 'cloud' && !model.loaded) {
      const loaded = await this.ensureLocalModelReady(model);
      if (!loaded) {
        this.replaceMessageContent(assistantMessageId, 'The selected model could not be loaded in this browser.', false);
        this.persistCurrentConversation();
        return;
      }
    }

    this.isGenerating.set(true);

    try {
      let assistantReply: string;
      if (model.source === 'cloud' && model.provider) {
        const input = this.buildGenerationInput(model, generationConversation) as AiChatMessage[];
        assistantReply = await this.aiService.generateCloudText(input, model.provider, model.cloudModel);
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
      this.persistCurrentConversation();
    } catch (err) {
      if (this.aiService.isAbortError(err)) {
        this.finalizeStoppedGeneration(assistantMessageId);
        return;
      }

      this.logger.error('AI chat error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.chatError.set(message);
      this.replaceMessageContent(assistantMessageId, `Model error: ${message}`, false);
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

    const notice = model.cached
      ? `Loading ${model.name}...`
      : `Downloading ${model.name} for first use...`;
    this.snackBar.open(notice, undefined, { duration: 2400 });

    const loaded = await this.loadModel(model);
    if (loaded) {
      this.snackBar.open(`${model.name} is ready.`, undefined, { duration: 1800 });
    }

    return loaded;
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

    const headerPattern = /^Option\s+[^\n:]+:\s*.+$/gm;
    const matches = Array.from(normalized.matchAll(headerPattern));
    if (matches.length < 2) {
      return null;
    }

    const intro = normalized.slice(0, matches[0].index ?? 0).trim();
    const suggestions = matches.map((match, index) => {
      const title = match[0].trim();
      const start = (match.index ?? 0) + match[0].length;
      const end = index + 1 < matches.length ? (matches[index + 1].index ?? normalized.length) : normalized.length;
      const content = normalized.slice(start, end).trim();

      return {
        id: `${index + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title,
        content,
      } satisfies AssistantSuggestion;
    });

    let outro = '';
    const lastSuggestion = suggestions.at(-1);
    if (lastSuggestion) {
      const splitMatch = /\n\n([^\n][\s\S]*)$/.exec(lastSuggestion.content);
      const trailingText = splitMatch?.[1]?.trim() ?? '';
      if (trailingText && /\?$/.test(trailingText) && !trailingText.startsWith('>') && !trailingText.startsWith('- ')) {
        outro = trailingText;
        lastSuggestion.content = lastSuggestion.content.slice(0, splitMatch!.index).trimEnd();
      }
    }

    return { intro, suggestions, outro };
  }

  private suggestionShareContent(suggestion: AssistantSuggestion): string {
    return suggestion.content.trim();
  }

  private suggestionArticleSource(suggestion: AssistantSuggestion): string {
    const title = suggestion.title.replace(/^Option\s+[^\n:]+:\s*/, '').trim();
    if (!title) {
      return this.suggestionShareContent(suggestion);
    }

    return `${title}\n\n${this.suggestionShareContent(suggestion)}`;
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
          : 'No image upscaling model is available.',
      );
      return true;
    }

    this.selectedModelId.set(model.id);
    this.snackBar.open(
      intent.task === 'image-generation'
        ? `Using ${model.name} to generate the image.`
        : `Using ${model.name} to upscale the image.`,
      'Dismiss',
      { duration: 2400 },
    );

    if (intent.task === 'image-generation') {
      await this.generateImageMessage(model, intent.prompt, attachments);
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
        generatedImages: message.generatedImages?.map(image => this.toHistoryGeneratedImage(image)),
      })),
    });

    this.currentConversationId.set(savedId);
  }

  private hasPersistableMessages(messages: ConversationMessage[]): boolean {
    return messages.some(message => {
      if (message.content.trim().length > 0) {
        return true;
      }

      return (message.generatedImages?.length ?? 0) > 0;
    });
  }

  private async generateImageMessage(model: ModelInfo, promptText: string, attachments: ComposerAttachment[]): Promise<void> {
    if (attachments.length > 0) {
      this.chatError.set('Image generation does not support file attachments yet.');
      return;
    }

    const prompt = promptText.trim();
    if (!prompt) {
      return;
    }

    const assistantMessageId = this.createMessageId();
    const userMessage: ConversationMessage = {
      id: this.createMessageId(),
      role: 'user',
      content: prompt,
    };

    this.chatError.set('');
    this.conversation.set([
      ...this.conversation(),
      userMessage,
      { id: assistantMessageId, role: 'assistant', content: '', streaming: true },
    ]);
    this.composerText.set('');
    this.autoScrollPinned.set(true);
    this.showHistoryDrawer.set(false);
    this.isGenerating.set(true);

    try {
      if (model.source !== 'cloud' && !model.loaded) {
        const loaded = await this.ensureLocalModelReady(model);
        if (!loaded) {
          this.replaceMessageContent(assistantMessageId, 'The selected model could not be loaded in this browser.', false);
          this.persistCurrentConversation();
          return;
        }
      }

      const images = model.source === 'cloud'
        ? await this.aiService.generateImage(prompt, model.provider)
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
      this.persistCurrentConversation();
    } catch (err) {
      if (this.aiService.isAbortError(err)) {
        this.finalizeStoppedGeneration(assistantMessageId);
        return;
      }

      this.logger.error('AI image generation error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.chatError.set(message);
      this.replaceMessageContent(assistantMessageId, `Image generation error: ${message}`, false);
      this.persistCurrentConversation();
    } finally {
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
    const assistantMessageId = this.createMessageId();
    const userMessage: ConversationMessage = {
      id: this.createMessageId(),
      role: 'user',
      content: prompt,
      attachments,
    };

    this.chatError.set('');
    this.conversation.set([
      ...this.conversation(),
      userMessage,
      { id: assistantMessageId, role: 'assistant', content: '', streaming: true },
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
      this.persistCurrentConversation();
    } catch (err) {
      if (this.aiService.isAbortError(err)) {
        this.finalizeStoppedGeneration(assistantMessageId);
        return;
      }

      this.logger.error('AI image upscaling error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.chatError.set(message);
      this.replaceMessageContent(assistantMessageId, `Image upscaling error: ${message}`, false);
      this.persistCurrentConversation();
    } finally {
      this.isGenerating.set(false);
    }
  }

  private finalizeStoppedGeneration(assistantMessageId: string): void {
    const currentReply = this.getMessageContent(assistantMessageId).trimEnd();
    this.chatError.set('');
    this.replaceMessageContent(assistantMessageId, currentReply || 'Generation stopped.', false);
    this.persistCurrentConversation();
    this.snackBar.open('Generation stopped.', 'Dismiss', { duration: 1800 });
  }

  private async cacheGeneratedImage(image: AiGeneratedImage): Promise<AiGeneratedImage> {
    if (!this.isBrowser || typeof caches === 'undefined') {
      return image;
    }

    const cacheKey = `https://nostria.local/cache/ai/generated/${encodeURIComponent(image.id)}`;
    const response = await fetch(image.src);
    if (!response.ok) {
      throw new Error(`Could not cache generated image (${response.status}).`);
    }

    const blob = await response.blob();
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

  private async removeGeneratedImagesFromCache(images?: AiGeneratedImage[]): Promise<void> {
    if (!this.isBrowser || typeof caches === 'undefined' || !images?.length) {
      return;
    }

    try {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      await Promise.all(images.map(async image => {
        if (!image.cacheKey) {
          return;
        }

        await cache.delete(image.cacheKey);
      }));
    } catch (error) {
      this.logger.warn('Failed to delete generated image cache entries', error);
    }
  }

  private async restoreGeneratedImages(images: AiHistoryGeneratedImage[]): Promise<AiGeneratedImage[]> {
    return Promise.all(images.map(async image => ({
      ...image,
      src: await this.resolveGeneratedImageSource(image),
    })));
  }

  private async resolveGeneratedImageSource(image: AiHistoryGeneratedImage): Promise<string> {
    if (!this.isBrowser || typeof caches === 'undefined' || !image.cacheKey) {
      return '';
    }

    try {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      const response = await cache.match(image.cacheKey);
      if (!response?.ok) {
        return '';
      }

      const blob = await response.blob();
      return await this.blobToDataUrl(blob);
    } catch (error) {
      this.logger.warn('Failed to restore generated image from cache', error);
      return '';
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

  private async getGeneratedImageBlob(image: AiGeneratedImage): Promise<Blob> {
    if (this.isBrowser && typeof caches !== 'undefined' && image.cacheKey) {
      const cache = await caches.open(AiComponent.AI_UPLOAD_CACHE);
      const cached = await cache.match(image.cacheKey);
      if (cached?.ok) {
        return cached.blob();
      }
    }

    const response = await fetch(image.src);
    if (!response.ok) {
      throw new Error(`Could not fetch generated image (${response.status}).`);
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
      cacheKey: image.cacheKey,
      mimeType: image.mimeType,
    };
  }

  private async preparePromptSubmission(promptText: string, attachments: ComposerAttachment[]): Promise<{ prompt: string; attachmentContext: string }> {
    const fetchedContexts = await this.resolveFetchedPromptContexts(promptText);
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

  private async resolveFetchedPromptContexts(promptText: string): Promise<FetchedPromptContext[]> {
    const urls = this.extractFetchUrls(promptText);
    if (urls.length === 0 && AiComponent.FETCH_KEYWORD_PATTERN.test(promptText)) {
      throw new Error('Invalid #fetch URL. Use #fetch followed by a URL or domain name.');
    }

    if (urls.length === 0) {
      return [];
    }

    return Promise.all(urls.map(url => this.fetchMarkdownContext(url)));
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

  private async fetchMarkdownContext(url: string): Promise<FetchedPromptContext> {
    const apiUrl = `https://metadata.nostria.app/markdown?url=${encodeURIComponent(url)}`;
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

    const truncatedMarkdown = markdown.length > AiComponent.FETCH_MARKDOWN_CHAR_LIMIT
      ? `${markdown.slice(0, AiComponent.FETCH_MARKDOWN_CHAR_LIMIT).trimEnd()}\n\n[Truncated for AI context]`
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
    };
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
