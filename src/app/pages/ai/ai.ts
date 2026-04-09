import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, PLATFORM_ID, computed, effect, inject, signal, viewChild } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SafeHtml } from '@angular/platform-browser';
import { AiChatMessage, AiCloudProvider, AiGeneratedImage, AiGenerationProgress, AiModelLoadOptions, AiService } from '../../services/ai.service';
import { AiChatHistoryService } from '../../services/ai-chat-history.service';
import { FormatService } from '../../services/format/format.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
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

type AiWorkspaceView = 'chat' | 'create';

interface AiQuickPrompt {
  label: string;
  prompt: string;
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

  private readonly aiService = inject(AiService);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formatService = inject(FormatService);
  private readonly historyService = inject(AiChatHistoryService);
  private readonly layout = inject(LayoutService);
  private readonly logger = inject(LoggerService);
  private readonly panelNav = inject(PanelNavigationService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly snackBar = inject(MatSnackBar);
  private readonly conversationPanelRef = viewChild<ElementRef<HTMLDivElement>>('conversationPanel');
  private readonly conversationEndRef = viewChild<ElementRef<HTMLDivElement>>('conversationEnd');
  private readonly attachmentInputRef = viewChild<ElementRef<HTMLInputElement>>('attachmentInput');

  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly systemPrompt = 'You are Nostria\'s local AI assistant. Keep replies concise, practical, and grounded in the user\'s request.';
  private readonly nextMessageId = signal(0);
  private readonly renderedAssistantSource = new Map<string, string>();
  private readonly renderedAssistantVersion = new Map<string, number>();
  readonly webGpuAvailable = this.isBrowser && typeof navigator !== 'undefined' && 'gpu' in navigator;
  readonly autoScrollPinned = signal(true);
  readonly splitPaneMode = computed(() => this.panelNav.hasRightContent() && !this.panelNav.isMobile());
  readonly currentConversationId = signal<string | null>(null);
  readonly narrowHistoryMode = signal(false);
  readonly showHistoryDrawer = signal(false);
  readonly workspaceView = signal<AiWorkspaceView>('chat');
  readonly historyQuery = signal('');
  readonly renderedAssistantMessages = signal<Record<string, SafeHtml>>({});
  readonly attachedFiles = signal<ComposerAttachment[]>([]);
  readonly imagePrompt = signal('');
  readonly generatedImages = signal<AiGeneratedImage[]>([]);
  readonly imageGenerationError = signal('');
  readonly isGeneratingImage = signal(false);
  readonly hideHistoryRail = computed(() => this.splitPaneMode() || this.narrowHistoryMode());

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
      preferredParams: {
        max_new_tokens: 384,
        do_sample: true,
        temperature: 0.7,
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

  readonly chatModels = computed(() => this.models().filter(model => model.task === 'text-generation'));
  readonly availableImageProviders = computed(() => this.aiService.getConfiguredImageProviders());
  readonly selectedImageProvider = signal<AiCloudProvider | null>(this.aiService.getActiveImageProvider());
  readonly selectedChatModelId = signal(this.webGpuAvailable ? 'onnx-community/gemma-4-E2B-it-ONNX' : 'Xenova/distilgpt2');
  readonly selectedChatModel = computed(() => this.chatModels().find(model => model.id === this.selectedChatModelId()) ?? null);
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
    if (this.isGenerating() || this.selectedChatModel()?.chatDisabledReason) {
      return false;
    }

    const lastMessage = this.conversation().at(-1);
    return lastMessage?.role === 'assistant';
  });
  readonly chatQuickPrompts: AiQuickPrompt[] = [
    { label: 'Summarize a feature', prompt: 'Summarize the latest Nostria architecture direction.' },
    { label: 'Draft a post', prompt: 'Help me write a better Nostr post about this idea.' },
    { label: 'Explain code', prompt: 'Explain this code change in simple terms.' },
    { label: 'Brainstorm', prompt: 'Brainstorm improvements for this product flow.' },
  ];
  readonly imageQuickPrompts: AiQuickPrompt[] = [
    { label: 'Album artwork', prompt: 'Design a bold album cover for an independent electronic release with geometric light trails and a cinematic atmosphere.' },
    { label: 'Product hero', prompt: 'Create a premium product hero image for a futuristic social app running on glass screens in a bright studio scene.' },
    { label: 'Poster concept', prompt: 'Generate a contemporary poster illustration for a Nostr community event with layered typography and editorial texture.' },
  ];
  readonly conversation = signal<ConversationMessage[]>([
    {
      id: this.createMessageId(),
      role: 'assistant',
      content: 'Choose a local model, load it, and start chatting. Responses stay on your device.',
    },
  ]);
  readonly composerText = signal('');
  readonly isGenerating = signal(false);
  readonly chatError = signal('');
  readonly canSend = computed(() => {
    const model = this.selectedChatModel();
    if (!model || this.isGenerating()) {
      return false;
    }

    if (model.chatDisabledReason) {
      return false;
    }

    return this.composerText().trim().length > 0 || this.attachedFiles().length > 0;
  });
  readonly selectedModelStatus = computed(() => this.selectedChatModel() ? this.statusLabel(this.selectedChatModel()!) : 'Unavailable');

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
      const activeProvider = this.aiService.getActiveImageProvider(this.selectedImageProvider());
      if (activeProvider !== this.selectedImageProvider()) {
        this.selectedImageProvider.set(activeProvider);
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

        const initialHtml = this.formatService.markdownToHtmlNonBlocking(message.content, updatedHtml => {
          if (this.renderedAssistantVersion.get(message.id) !== nextVersion) {
            return;
          }

          this.renderedAssistantMessages.update(rendered => ({
            ...rendered,
            [message.id]: updatedHtml,
          }));
        });

        this.renderedAssistantMessages.update(rendered => ({
          ...rendered,
          [message.id]: initialHtml,
        }));
      }
    });

    void this.initializeModelStatus();
  }

  openSettingsPanel(): void {
    this.showHistoryDrawer.set(false);
    this.layout.navigateToRightPanel('ai/settings');
  }

  setWorkspaceView(view: AiWorkspaceView): void {
    this.workspaceView.set(view);
  }

  createNewChat(): void {
    this.currentConversationId.set(null);
    this.attachedFiles.set([]);
    this.showHistoryDrawer.set(false);
    this.workspaceView.set('chat');
    this.clearConversation();
  }

  openHistory(historyId: string): void {
    const history = this.historyService.getHistory(historyId);
    if (!history) {
      this.snackBar.open('That AI chat could not be found.', 'Dismiss', { duration: 4000 });
      return;
    }

    if (this.chatModels().some(model => model.id === history.modelId)) {
      this.selectedChatModelId.set(history.modelId);
    }

    this.currentConversationId.set(history.id);
    this.chatError.set('');
    this.attachedFiles.set([]);
    this.autoScrollPinned.set(true);
    this.showHistoryDrawer.set(false);
    this.workspaceView.set('chat');
    this.conversation.set(history.messages.map(message => ({
      id: this.createMessageId(),
      role: message.role,
      content: message.content,
    })));
  }

  selectChatModel(modelId: string): void {
    this.selectedChatModelId.set(modelId);
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

  selectImageProvider(provider: AiCloudProvider): void {
    this.selectedImageProvider.set(provider);
    this.workspaceView.set('create');
  }

  async generateImage(): Promise<void> {
    const prompt = this.imagePrompt().trim();
    if (!prompt || this.isGeneratingImage()) {
      return;
    }

    this.imageGenerationError.set('');
    this.isGeneratingImage.set(true);
    this.workspaceView.set('create');

    try {
      const generatedImages = await this.aiService.generateImage(prompt, this.selectedImageProvider());
      this.generatedImages.set(generatedImages);
    } catch (err) {
      this.logger.error('AI image generation error:', err);
      this.imageGenerationError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.isGeneratingImage.set(false);
    }
  }

  openImageSettings(): void {
    this.openSettingsPanel();
  }

  openAttachmentPicker(): void {
    this.attachmentInputRef()?.nativeElement.click();
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
    this.workspaceView.set('chat');
    this.composerText.set(prompt);
  }

  applyImagePrompt(prompt: string): void {
    this.workspaceView.set('create');
    this.imagePrompt.set(prompt);
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
    if (!this.isBrowser || typeof navigator === 'undefined' || !navigator.clipboard) {
      this.snackBar.open('Clipboard access is not available in this browser.', 'Dismiss', { duration: 3500 });
      return;
    }

    try {
      await navigator.clipboard.writeText(message.content);
      this.snackBar.open(message.role === 'assistant' ? 'Reply copied.' : 'Prompt copied.', 'Dismiss', { duration: 2400 });
    } catch (error) {
      this.logger.warn('Failed to copy AI message', error);
      this.snackBar.open('Could not copy that message.', 'Dismiss', { duration: 3500 });
    }
  }

  reuseMessage(message: ConversationMessage): void {
    this.workspaceView.set('chat');
    this.composerText.set(message.content);
    this.snackBar.open(message.role === 'assistant' ? 'Reply moved into the composer.' : 'Prompt ready to edit.', 'Dismiss', { duration: 2400 });
  }

  async retryLastReply(): Promise<void> {
    const model = this.selectedChatModel();
    const currentConversation = this.conversation();
    const lastMessage = currentConversation.at(-1);

    if (!model || lastMessage?.role !== 'assistant' || this.isGenerating()) {
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

    if (!model.loaded) {
      const loaded = await this.loadModel(model);
      if (!loaded) {
        this.replaceMessageContent(assistantMessageId, 'The selected model could not be loaded in this browser.', false);
        this.persistCurrentConversation();
        return;
      }
    }

    this.isGenerating.set(true);

    try {
      const input = this.buildGenerationInput(model, generationConversation);
      const result = await this.aiService.generateText(
        input,
        model.preferredParams,
        model.id,
        (progress: AiGenerationProgress) => {
          if (progress.status === 'stream') {
            this.appendToMessage(assistantMessageId, progress.text);
          }
        },
      );
      const assistantReply = this.extractAssistantReply(result);
      const currentReply = this.getMessageContent(assistantMessageId);
      this.replaceMessageContent(assistantMessageId, currentReply.trim().length > 0 ? currentReply.trimEnd() : assistantReply, false);
      this.persistCurrentConversation();
    } catch (err) {
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
    this.workspaceView.set('chat');
    this.composerText.set(`Use this image concept as context and turn it into a polished post or product idea:\n\n${image.revisedPrompt || image.prompt}`);
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
    return this.renderedAssistantMessages()[id] ?? '';
  }

  formatHistoryTimestamp(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(timestamp);
  }

  statusLabel(model: ModelInfo): string {
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

  async loadSelectedModel(): Promise<void> {
    const model = this.selectedChatModel();
    if (!model) {
      return;
    }

    await this.loadModel(model);
  }

  clearConversation(): void {
    this.chatError.set('');
    this.conversation.set([
      {
        id: this.createMessageId(),
        role: 'assistant',
        content: 'Conversation cleared. Ask a new question whenever you are ready.',
      },
    ]);
  }

  imageProviderLabel(provider: AiCloudProvider | null): string {
    return provider ? this.aiService.getProviderLabel(provider) : 'Unavailable';
  }

  selectedImageModel(): string {
    const provider = this.selectedImageProvider();
    return provider ? this.aiService.getImageModel(provider) : '';
  }

  onConversationScroll(event: Event): void {
    const panel = event.target as HTMLDivElement;
    const distanceFromBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    this.autoScrollPinned.set(distanceFromBottom < 48);
  }

  async sendMessage(): Promise<void> {
    const model = this.selectedChatModel();
    const promptText = this.composerText().trim();
    const attachments = this.attachedFiles();
    const prompt = promptText || (attachments.length > 0 ? 'Please analyze the attached files.' : '');

    if (!model || !prompt) {
      return;
    }

    this.workspaceView.set('chat');
    this.chatError.set('');
    const assistantMessageId = this.createMessageId();
    const userMessage: ConversationMessage = {
      id: this.createMessageId(),
      role: 'user',
      content: prompt,
      attachments,
      attachmentContext: this.buildAttachmentContext(attachments),
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

    if (!model.loaded) {
      const loaded = await this.loadModel(model);
      if (!loaded) {
        this.replaceMessageContent(assistantMessageId, 'The selected model could not be loaded in this browser.', false);
        this.persistCurrentConversation();
        return;
      }
    }

    this.isGenerating.set(true);

    try {
      const input = this.buildGenerationInput(model, generationConversation);
      const result = await this.aiService.generateText(
        input,
        model.preferredParams,
        model.id,
        (progress: AiGenerationProgress) => {
          if (progress.status === 'stream') {
            this.appendToMessage(assistantMessageId, progress.text);
          }
        },
      );
      const assistantReply = this.extractAssistantReply(result);
      const currentReply = this.getMessageContent(assistantMessageId);
      this.replaceMessageContent(assistantMessageId, currentReply.trim().length > 0 ? currentReply.trimEnd() : assistantReply, false);
      this.persistCurrentConversation();
    } catch (err) {
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

  private persistCurrentConversation(): void {
    const model = this.selectedChatModel();
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
      })),
    });

    this.currentConversationId.set(savedId);
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
}
