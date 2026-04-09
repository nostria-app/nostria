import { ChangeDetectionStrategy, Component, ElementRef, PLATFORM_ID, computed, effect, inject, signal, viewChild } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { AiChatMessage, AiGenerationProgress, AiModelLoadOptions, AiService } from '../../services/ai.service';
import { AiChatHistoryService } from '../../services/ai-chat-history.service';
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
}

@Component({
  selector: 'app-ai',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
  ],
  templateUrl: './ai.html',
  styleUrl: './ai.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiComponent {
  private readonly aiService = inject(AiService);
  private readonly historyService = inject(AiChatHistoryService);
  private readonly layout = inject(LayoutService);
  private readonly logger = inject(LoggerService);
  private readonly panelNav = inject(PanelNavigationService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly conversationPanelRef = viewChild<ElementRef<HTMLDivElement>>('conversationPanel');
  private readonly conversationEndRef = viewChild<ElementRef<HTMLDivElement>>('conversationEnd');

  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly systemPrompt = 'You are Nostria\'s local AI assistant. Keep replies concise, practical, and grounded in the user\'s request.';
  private readonly nextMessageId = signal(0);
  readonly webGpuAvailable = this.isBrowser && typeof navigator !== 'undefined' && 'gpu' in navigator;
  readonly autoScrollPinned = signal(true);
  readonly splitPaneMode = computed(() => this.panelNav.hasRightContent() && !this.panelNav.isMobile());
  readonly currentConversationId = signal<string | null>(null);

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
  readonly selectedChatModelId = signal(this.webGpuAvailable ? 'onnx-community/gemma-4-E2B-it-ONNX' : 'Xenova/distilgpt2');
  readonly selectedChatModel = computed(() => this.chatModels().find(model => model.id === this.selectedChatModelId()) ?? null);
  readonly histories = this.historyService.histories;
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

    return this.composerText().trim().length > 0;
  });
  readonly selectedModelStatus = computed(() => this.selectedChatModel() ? this.statusLabel(this.selectedChatModel()!) : 'Unavailable');

  constructor() {
    effect(() => {
      this.conversation();
      this.isGenerating();

      if (!this.isBrowser || !this.autoScrollPinned()) {
        return;
      }

      this.scrollConversationToEnd(this.isGenerating() ? 'auto' : 'smooth');
    });

    void this.initializeModelStatus();
  }

  openSettingsPanel(): void {
    this.layout.navigateToRightPanel('ai/settings');
  }

  createNewChat(): void {
    this.currentConversationId.set(null);
    this.clearConversation();
  }

  openHistory(historyId: string): void {
    this.layout.navigateToRightPanel(`ai/history/${historyId}`);
  }

  selectChatModel(modelId: string): void {
    this.selectedChatModelId.set(modelId);
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

  onConversationScroll(event: Event): void {
    const panel = event.target as HTMLDivElement;
    const distanceFromBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    this.autoScrollPinned.set(distanceFromBottom < 48);
  }

  async sendMessage(): Promise<void> {
    const model = this.selectedChatModel();
    const prompt = this.composerText().trim();

    if (!model || !prompt) {
      return;
    }

    this.chatError.set('');
    const assistantMessageId = this.createMessageId();
    const userMessage: ConversationMessage = { id: this.createMessageId(), role: 'user', content: prompt };
    const generationConversation = [...this.conversation(), userMessage];
    this.conversation.set([
      ...generationConversation,
      { id: assistantMessageId, role: 'assistant', content: '', streaming: true },
    ]);
    this.composerText.set('');
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
          content: message.content,
        })),
      ];
    }

    const transcript = conversation
      .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
      .join('\n\n');

    return `${this.systemPrompt}\n\n${transcript}\n\nAssistant:`;
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
