import { Injectable, computed, effect, signal, inject } from '@angular/core';

import { AccountStateService } from './account-state.service';
import { GrokApiService, GrokHostedPayment, GrokPublicConfig, GrokStatus } from './grok-api.service';
import { LocalStorageService } from './local-storage.service';
import { SettingsService } from './settings.service';

export interface AiModelLoadOptions {
  device?: 'webgpu' | 'wasm';
  dtype?: string | Record<string, string>;
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiMultimodalTextPart {
  type: 'text';
  text: string;
}

export interface AiMultimodalImagePart {
  type: 'image';
  image: Blob;
}

export type AiMultimodalChatPart = AiMultimodalTextPart | AiMultimodalImagePart;

export interface AiMultimodalChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: AiMultimodalChatPart[];
}

export interface AiGenerationProgress {
  status: 'stream';
  text: string;
}

export interface AiImageGenerationProgress {
  status: 'image-progress';
  progress: number;
}

export interface AiVideoGenerationProgress {
  status: 'pending' | 'done' | 'failed' | 'expired';
  progress?: number;
}

export type AiCloudProvider = 'openai' | 'xai';
export type AiCloudAccessMode = 'api-key' | 'hosted';
export type AiImageProvider = AiCloudProvider | 'local';
export type AiGeneratedMediaProvider = AiImageProvider;

export interface AiImageGenerationOptions {
  inputImages?: string[];
  referenceImages?: string[];
}

export interface AiGeneratedImageSettings {
  provider: AiImageProvider;
  model: string;
  openaiImageSize?: string;
  openaiImageQuality?: string;
  openaiImageCount?: number;
  xaiImageAspectRatio?: string;
  xaiImageResolution?: string;
  xaiImageCount?: number;
}

export interface AiVideoGenerationOptions {
  mode?: 'generate' | 'extend-video';
  inputImage?: string;
  referenceImages?: string[];
  inputVideo?: string;
  aspectRatio?: string;
}

export interface AiGeneratedAudio {
  id: string;
  provider: AiGeneratedMediaProvider;
  providerLabel: string;
  model: string;
  prompt: string;
  src: string;
  cacheKey?: string;
  mimeType?: string;
  voiceId?: string;
  language?: string;
}

export interface AiCloudSettings {
  openaiApiKey?: string;
  xaiApiKey?: string;
  preferredImageProvider: AiCloudProvider;
  openaiChatModel: string;
  xaiChatModel: string;
  openaiImageModel: string;
  openaiImageSize: string;
  openaiImageQuality: string;
  openaiImageCount: number;
  xaiImageModel: string;
  xaiImageAspectRatio: string;
  xaiImageResolution: string;
  xaiImageCount: number;
  xaiVideoModel: string;
  xaiVideoDuration: number;
  xaiVideoAspectRatio: string;
  xaiVideoResolution: string;
  xaiVoiceId: string;
  xaiVoiceLanguage: string;
  xaiVoiceCodec: 'mp3' | 'wav';
}

export interface AiGeneratedImage {
  id: string;
  provider: AiImageProvider;
  providerLabel: string;
  model: string;
  prompt: string;
  revisedPrompt?: string;
  src: string;
  originalUrl?: string;
  cacheKey?: string;
  mimeType?: string;
  imageSettings?: AiGeneratedImageSettings;
}

export interface AiGeneratedVideo {
  id: string;
  provider: AiGeneratedMediaProvider;
  providerLabel: string;
  model: string;
  prompt: string;
  src: string;
  originalUrl?: string;
  costInUsdTicks?: number;
  cacheKey?: string;
  mimeType?: string;
  duration?: number;
}

export interface AiManageableModel {
  id: string;
  task: string;
  name: string;
  description: string;
  runtime: string;
  sizeHint: string;
  cacheKeys?: string[];
}

export interface AiManagedModelStatus extends AiManageableModel {
  loaded: boolean;
  cached: boolean;
  bytes: number;
}

export interface AiStandardPromptSelection {
  title: string;
  prompt: string;
}

export interface AiModelStorageReport {
  models: AiManagedModelStatus[];
  totalBytes: number;
  storageUsageBytes?: number;
  storageQuotaBytes?: number;
}

interface AiCloudChatCompletionPayload {
  choices?: {
    message?: {
      content?: string | { type?: string; text?: string }[];
    };
  }[];
  error?: {
    message?: string;
  } | string;
  message?: string;
}

interface AiImageApiPayload {
  data?: {
    b64_json?: string;
    revised_prompt?: string;
    url?: string;
  }[];
  error?: {
    message?: string;
  } | string;
  message?: string;
}

interface AiVideoGenerationStartPayload {
  request_id?: string;
  usage?: {
    cost_in_usd_ticks?: number;
  };
  error?: {
    message?: string;
  } | string;
  message?: string;
}

interface AiVideoGenerationStatusPayload {
  status?: 'pending' | 'done' | 'failed' | 'expired';
  progress?: number;
  model?: string;
  usage?: {
    cost_in_usd_ticks?: number;
  };
  video?: {
    url?: string;
    duration?: number;
    respect_moderation?: boolean;
  };
  error?: {
    message?: string;
  } | string;
  message?: string;
}

interface AiLocalImageWorkerPayload {
  images?: {
    blob?: Blob;
    mimeType?: string;
  }[];
}

interface AiLocalUpscaledImageWorkerPayload {
  image?: {
    blob?: Blob;
    mimeType?: string;
  };
}

interface WorkerCallback {
  type: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  progress?: (data: unknown) => void;
}

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private static readonly CLOUD_SETTINGS_STORAGE_KEY = 'nostria-ai-cloud-settings';
  private static readonly TRANSFORMERS_CACHE_NAME = 'transformers-cache';

  private readonly defaultCloudSettings: AiCloudSettings = {
    preferredImageProvider: 'xai',
    openaiChatModel: 'gpt-4.1-mini',
    xaiChatModel: 'grok-4-1-fast-reasoning',
    openaiImageModel: 'gpt-image-2',
    openaiImageSize: 'auto',
    openaiImageQuality: 'auto',
    openaiImageCount: 1,
    xaiImageModel: 'grok-imagine-image',
    xaiImageAspectRatio: '1:1',
    xaiImageResolution: '1k',
    xaiImageCount: 1,
    xaiVideoModel: 'grok-imagine-video',
    xaiVideoDuration: 10,
    xaiVideoAspectRatio: '16:9',
    xaiVideoResolution: '720p',
    xaiVoiceId: 'eve',
    xaiVoiceLanguage: 'en',
    xaiVoiceCodec: 'mp3',
  };

  private settings = inject(SettingsService);
  private localStorage = inject(LocalStorageService);
  private accountState = inject(AccountStateService);
  private grokApi = inject(GrokApiService);
  private worker: Worker | null = null;
  private callbacks: Record<string, WorkerCallback> = {};
  private readonly activeAbortControllers = new Set<AbortController>();

  // Signals for UI
  textModelLoaded = signal(false);
  translationModelLoaded = signal(false);
  summarizationModelLoaded = signal(false);
  sentimentModelLoaded = signal(false);
  transcriptionModelLoaded = signal(false);
  speechModelLoaded = signal(false);

  processingState = signal<{ isProcessing: boolean, task: string | null }>({ isProcessing: false, task: null });
  private _processingCount = 0;
  queuedStandardPrompt = signal<AiStandardPromptSelection | null>(null);

  loadedModels = signal<Set<string>>(new Set());
  cloudSettings = signal<AiCloudSettings>({ ...this.defaultCloudSettings });
  grokConfig = signal<GrokPublicConfig | null>(null);
  grokStatus = signal<GrokStatus | null>(null);
  grokConfigLoading = signal(false);
  grokStatusLoading = signal(false);
  grokError = signal('');
  readonly hasHostedGrokAccess = computed(() => {
    const config = this.grokConfig();
    return !!config?.enabled && !!this.accountState.hasActiveSubscription();
  });

  availableTranslationModels = [
    'Xenova/opus-mt-es-fr', 'Xenova/opus-mt-es-it', 'Xenova/opus-mt-es-ru', 'Xenova/opus-mt-fr-es',
    'Xenova/opus-mt-fr-ro', 'Xenova/opus-mt-fr-ru', 'Xenova/opus-mt-hu-en', 'Xenova/opus-mt-af-en',
    'Xenova/opus-mt-de-es', 'Xenova/opus-mt-de-fr', 'Xenova/opus-mt-en-af', 'Xenova/opus-mt-en-hi',
    'Xenova/opus-mt-en-hu', 'Xenova/opus-mt-en-id', 'Xenova/opus-mt-en-jap', 'Xenova/opus-mt-en-cs',
    'Xenova/opus-mt-fr-de', 'Xenova/opus-mt-da-de', 'Xenova/opus-mt-no-de', 'Xenova/opus-mt-ROMANCE-en',
    'Xenova/opus-mt-gmw-gmw', 'Xenova/opus-mt-fi-de', 'Xenova/opus-mt-hi-en', 'Xenova/opus-mt-en-nl',
    'Xenova/opus-mt-et-en', 'Xenova/opus-mt-en-ar', 'Xenova/opus-mt-th-en', 'Xenova/opus-mt-vi-en',
    'Xenova/opus-mt-en-da', 'Xenova/opus-mt-nl-fr', 'Xenova/opus-mt-en-fi', 'Xenova/opus-mt-en-vi',
    'Xenova/opus-mt-it-es', 'Xenova/opus-mt-jap-en', 'Xenova/opus-mt-ro-fr', 'Xenova/opus-mt-ru-es',
    'Xenova/opus-mt-ru-fr', 'Xenova/opus-mt-ru-uk', 'Xenova/opus-mt-uk-en', 'Xenova/opus-mt-uk-ru',
    'Xenova/opus-mt-xh-en', 'Xenova/opus-mt-en-ro', 'Xenova/opus-mt-en-sv', 'Xenova/opus-mt-en-uk',
    'Xenova/opus-mt-en-xh', 'Xenova/opus-mt-es-de', 'Xenova/opus-mt-en-mul', 'Xenova/opus-mt-en-zh',
    'Xenova/opus-mt-fr-en', 'Xenova/opus-mt-es-en', 'Xenova/opus-mt-zh-en', 'Xenova/opus-mt-de-en',
    'Xenova/opus-mt-ru-en', 'Xenova/opus-mt-ar-en', 'Xenova/opus-mt-ko-en', 'Xenova/opus-mt-en-de',
    'Xenova/opus-mt-mul-en', 'Xenova/opus-mt-nl-en', 'Xenova/opus-mt-it-en', 'Xenova/opus-mt-pl-en',
    'Xenova/opus-mt-en-fr', 'Xenova/opus-mt-en-es', 'Xenova/opus-mt-cs-en', 'Xenova/opus-mt-en-it',
    'Xenova/opus-mt-fi-en', 'Xenova/opus-mt-en-ru', 'Xenova/opus-mt-en-ROMANCE', 'Xenova/opus-mt-tc-big-tr-en',
    'Xenova/opus-mt-sv-en', 'Xenova/opus-mt-gem-gem', 'Xenova/opus-mt-it-fr', 'Xenova/opus-mt-da-en',
    'Xenova/opus-mt-tr-en', 'Xenova/opus-mt-id-en', 'Xenova/opus-mt-bat-en', 'Xenova/opus-mt-ja-en'
  ];

  // Default models
  readonly speechModelId = 'Xenova/speecht5_tts';
  readonly transcriptionModelId = 'Xenova/whisper-tiny';
  readonly summarizationModelId = 'Xenova/distilbart-cnn-6-6';
  readonly sentimentModelId = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
  readonly textGenerationModelId = 'Xenova/distilgpt2';

  readonly manageableModels: AiManageableModel[] = [
    {
      id: 'onnx-community/gemma-4-E2B-it-ONNX',
      task: 'text-generation',
      name: 'Gemma 4 E2B',
      description: 'Instruction-tuned Gemma 4 chat model for local browser inference.',
      runtime: 'WebGPU · q4f16',
      sizeHint: '~2B parameters',
    },
    {
      id: 'onnx-community/Qwen3.5-0.8B-ONNX',
      task: 'image-text-to-text',
      name: 'Qwen 3.5 0.8B Vision',
      description: 'Multimodal Qwen 3.5 model for local image-aware chat in the browser.',
      runtime: 'WebGPU · q4f16 · vision',
      sizeHint: '~0.8B parameters',
    },
    {
      id: 'onnx-community/Qwen3.5-0.8B-Text-ONNX',
      task: 'text-generation',
      name: 'Qwen 3.5 0.8B',
      description: 'Verified Qwen 3.5 text-only chat model for local browser inference.',
      runtime: 'WebGPU · q4f16',
      sizeHint: '~0.8B parameters',
    },
    {
      id: 'onnx-community/Qwen3-0.6B-ONNX',
      task: 'text-generation',
      name: 'Qwen 3 0.6B',
      description: 'Compact Qwen 3 chat model for fast local browser inference.',
      runtime: 'WebGPU · q4f16',
      sizeHint: '~0.6B parameters',
    },
    {
      id: 'Xenova/distilgpt2',
      task: 'text-generation',
      name: 'DistilGPT2',
      description: 'Small fallback chat model for lighter devices and browsers without WebGPU.',
      runtime: 'WASM/CPU',
      sizeHint: '~85MB',
    },
    {
      id: 'onnx-community/Janus-Pro-1B-ONNX',
      task: 'image-generation',
      name: 'Janus Pro 1B',
      description: 'Local browser image generation with DeepSeek Janus Pro via Transformers.js.',
      runtime: 'WebGPU · multimodal',
      sizeHint: '~1B parameters',
    },
    {
      id: 'Xenova/swin2SR-classical-sr-x2-64',
      task: 'image-upscaling',
      name: 'Swin2SR x2',
      description: 'Local image upscaling model for attached artwork, screenshots, and photos.',
      runtime: 'WASM/CPU · q8',
      sizeHint: 'x2 super-resolution',
    },
    {
      id: 'Xenova/distilbart-cnn-6-6',
      task: 'summarization',
      name: 'DistilBART CNN',
      description: 'Summarization model used for local content shortening.',
      runtime: 'WASM/CPU',
      sizeHint: '~283MB',
    },
    {
      id: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
      task: 'sentiment-analysis',
      name: 'DistilBERT Sentiment',
      description: 'Sentiment analysis model used for local text evaluation.',
      runtime: 'WASM/CPU',
      sizeHint: '~65MB',
    },
    {
      id: 'Xenova/whisper-tiny.en',
      task: 'automatic-speech-recognition',
      name: 'Whisper Tiny',
      description: 'Speech-to-text model used for local transcription.',
      runtime: 'WASM/CPU',
      sizeHint: '~40MB',
    },
    {
      id: 'Xenova/speecht5_tts',
      task: 'text-to-speech',
      name: 'SpeechT5',
      description: 'Text-to-speech voice synthesis model.',
      runtime: 'WASM/CPU',
      sizeHint: '~180MB',
      cacheKeys: ['Xenova/speecht5_tts', 'Xenova/speecht5_hifigan'],
    },
  ];

  getTaskName(task: string | null): string {
    if (!task) return '';
    switch (task) {
      case 'text-generation': return 'Generating text...';
      case 'image-text-to-text': return 'Analyzing image...';
      case 'summarization': return 'Summarizing...';
      case 'sentiment-analysis': return 'Analyzing sentiment...';
      case 'translation': return 'Translating...';
      case 'automatic-speech-recognition': return 'Transcribing...';
      case 'text-to-speech': return 'Synthesizing speech...';
      case 'image-generation': return 'Generating image...';
      case 'image-upscaling': return 'Upscaling image...';
      case 'load': return 'Loading model...';
      case 'synthesize': return 'Synthesizing speech...'; // The postMessage type is 'synthesize'
      case 'upscale-image': return 'Upscaling image...';
      case 'generate': return 'Generating text...';
      case 'generate-multimodal': return 'Analyzing image...';
      case 'summarize': return 'Summarizing...';
      case 'sentiment': return 'Analyzing sentiment...';
      case 'translate': return 'Translating...';
      case 'transcribe': return 'Transcribing...';
      default: return 'Processing...';
    }
  }

  getTranslationModel(source: string, target: string): string | undefined {
    // Direct match
    let match = this.availableTranslationModels.find(m => m === `Xenova/opus-mt-${source}-${target}`);
    if (match) return match;

    // Try to find a model that supports the pair (some models are multilingual or grouped)
    // For now, simple matching.
    // Note: 'jap' in list vs 'ja' code. 'zh' vs 'zh-cn'.

    // Map common codes if needed
    const mapCode = (c: string) => {
      if (c === 'ja') return 'jap';
      return c;
    };

    const s = mapCode(source);
    const t = mapCode(target);

    match = this.availableTranslationModels.find(m => m === `Xenova/opus-mt-${s}-${t}`);
    if (match) return match;

    // Fallback to English as pivot if not found?
    // Or return undefined.

    // Check for 'mul' (multilingual)
    if (target === 'en') {
      match = this.availableTranslationModels.find(m => m === `Xenova/opus-mt-mul-en`);
      if (match) return match;
    }

    if (source === 'en') {
      match = this.availableTranslationModels.find(m => m === `Xenova/opus-mt-en-mul`);
      if (match) return match;
    }

    return undefined;
  }

  isModelLoaded(modelId: string) {
    return this.loadedModels().has(modelId);
  }

  constructor() {
    this.loadCloudSettings();
    void this.refreshGrokConfig();

    effect(() => {
      const pubkey = this.accountState.pubkey();
      const hasActiveSubscription = this.accountState.hasActiveSubscription();
      if (!pubkey || !hasActiveSubscription) {
        this.grokStatus.set(null);
        return;
      }

      void this.refreshGrokStatus();
    });

    this.initializeWorker();
  }

  stopActiveGeneration(): void {
    const abortError = this.createAbortError();

    for (const controller of this.activeAbortControllers) {
      controller.abort(abortError);
    }
    this.activeAbortControllers.clear();

    const pendingIds = Object.entries(this.callbacks)
      .filter(([, callback]) => callback.type !== 'check')
      .map(([id]) => id);

    for (const id of pendingIds) {
      this.callbacks[id]?.reject(abortError);
      delete this.callbacks[id];
    }

    this._processingCount = 0;
    this.processingState.set({ isProcessing: false, task: null });

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.initializeWorker();
  }

  isAbortError(error: unknown): boolean {
    if (error instanceof DOMException) {
      return error.name === 'AbortError';
    }

    if (!(error instanceof Error)) {
      return false;
    }

    return error.name === 'AbortError' || error.message === 'Generation stopped.';
  }

  private initializeWorker(): void {
    if (typeof Worker === 'undefined') {
      console.error('Web Workers are not supported in this environment.');
      return;
    }

    this.worker = new Worker(new URL('../workers/ai.worker', import.meta.url));
    this.worker.onmessage = ({ data }) => {
      const { type, id, payload } = data;
      if (type === 'progress') {
        if (this.callbacks[id]?.progress) {
          this.callbacks[id].progress!(payload);
        }
      } else if (type === 'error') {
        if (this.callbacks[id]) {
          this.callbacks[id].reject(payload);
          delete this.callbacks[id];
        }
      } else {
        if (this.callbacks[id]) {
          this.callbacks[id].resolve(payload);
          delete this.callbacks[id];
        }
      }
    };
  }

  private createAbortError(): Error {
    if (typeof DOMException !== 'undefined') {
      return new DOMException('Generation stopped.', 'AbortError');
    }

    const error = new Error('Generation stopped.');
    error.name = 'AbortError';
    return error;
  }

  private createAbortController(): AbortController {
    const controller = new AbortController();
    this.activeAbortControllers.add(controller);
    return controller;
  }

  private clearAbortController(controller: AbortController): void {
    this.activeAbortControllers.delete(controller);
  }

  async loadModel(task: string, model: string, progressCallback?: (data: unknown) => void, options?: AiModelLoadOptions) {
    return this.postMessage('load', { task, model, options }, progressCallback).then((res) => {
      if (task === 'text-generation') this.textModelLoaded.set(true);
      if (task === 'image-text-to-text') this.textModelLoaded.set(true);
      if (task === 'translation') this.translationModelLoaded.set(true);
      if (task === 'summarization') this.summarizationModelLoaded.set(true);
      if (task === 'sentiment-analysis') this.sentimentModelLoaded.set(true);
      if (task === 'automatic-speech-recognition') this.transcriptionModelLoaded.set(true);
      if (task === 'text-to-speech') this.speechModelLoaded.set(true);

      this.loadedModels.update(models => {
        const newModels = new Set(models);
        newModels.add(model);
        return newModels;
      });

      return res;
    });
  }

  async generateText(
    input: string | AiChatMessage[],
    params?: unknown,
    model = this.textGenerationModelId,
    progressCallback?: (data: AiGenerationProgress) => void,
  ) {
    if (!this.settings.settings().aiEnabled) throw new Error('AI is disabled');
    return this.postMessage('generate', { input, params, model }, progressCallback as ((data: unknown) => void) | undefined);
  }

  async generateMultimodalText(
    input: AiMultimodalChatMessage[],
    params?: unknown,
    model = 'onnx-community/Qwen3.5-0.8B-ONNX',
    progressCallback?: (data: AiGenerationProgress) => void,
  ): Promise<string> {
    if (!this.settings.settings().aiEnabled) throw new Error('AI is disabled');
    return this.postMessage(
      'generate-multimodal',
      { input, params, model },
      progressCallback as ((data: unknown) => void) | undefined,
    ) as Promise<string>;
  }

  async summarizeText(text: string, params?: unknown) {
    if (!this.settings.settings().aiEnabled || !this.settings.settings().aiSummarizationEnabled) throw new Error('AI Summarization is disabled');
    return this.postMessage('summarize', { text, params });
  }

  async analyzeSentiment(text: string, params?: unknown) {
    if (!this.settings.settings().aiEnabled || !this.settings.settings().aiSentimentEnabled) throw new Error('AI Sentiment Analysis is disabled');
    return this.postMessage('sentiment', { text, params });
  }

  async translateText(text: string, model: string, params?: unknown) {
    if (!this.settings.settings().aiEnabled || !this.settings.settings().aiTranslationEnabled) throw new Error('AI Translation is disabled');
    return this.postMessage('translate', { text, model, params });
  }

  async transcribeAudio(audio: Float32Array, params?: unknown) {
    if (!this.settings.settings().aiEnabled || !this.settings.settings().aiTranscriptionEnabled) throw new Error('AI Transcription is disabled');
    return this.postMessage('transcribe', { audio, params });
  }

  async synthesizeSpeech(text: string, params?: unknown) {
    if (!this.settings.settings().aiEnabled || !this.settings.settings().aiSpeechEnabled) throw new Error('AI Speech Synthesis is disabled');
    return this.postMessage('synthesize', { text, params });
  }

  async checkModel(task: string, model: string): Promise<{ loaded: boolean, cached: boolean }> {
    return this.postMessage('check', { task, model }) as Promise<{ loaded: boolean, cached: boolean }>;
  }

  queueStandardPrompt(selection: AiStandardPromptSelection): void {
    const title = selection.title.trim();
    const prompt = selection.prompt.trim();
    if (!title || !prompt) {
      return;
    }

    this.queuedStandardPrompt.set({ title, prompt });
  }

  clearQueuedStandardPrompt(): void {
    this.queuedStandardPrompt.set(null);
  }

  getProviderLabel(provider: AiImageProvider): string {
    if (provider === 'local') {
      return 'Local browser AI';
    }

    return provider === 'openai' ? 'OpenAI' : 'xAI / Grok';
  }

  getCloudAccessLabel(provider: AiCloudProvider, accessMode: AiCloudAccessMode = 'api-key'): string {
    if (provider === 'openai') {
      return 'Your API key';
    }

    return accessMode === 'hosted' ? 'Nostria backend' : 'Your xAI key';
  }

  getCloudModelDisplayName(provider: AiCloudProvider, accessMode: AiCloudAccessMode = 'api-key'): string {
    if (provider === 'openai') {
      return 'OpenAI';
    }

    return accessMode === 'hosted' ? 'Nostria Grok' : 'xAI / Grok';
  }

  getImageModel(provider: AiCloudProvider): string {
    const cloudSettings = this.cloudSettings();
    if (provider === 'openai') {
      return cloudSettings.openaiImageModel;
    }

    return this.hasCloudApiKey('xai')
      ? cloudSettings.xaiImageModel
      : this.grokConfig()?.defaults.imageModel || cloudSettings.xaiImageModel;
  }

  getVideoModel(provider: AiCloudProvider): string {
    const cloudSettings = this.cloudSettings();
    return provider === 'xai' ? cloudSettings.xaiVideoModel : '';
  }

  getVoiceModel(provider: AiCloudProvider): string {
    if (provider !== 'xai') {
      return '';
    }

    return 'xAI Voice';
  }

  getChatModel(provider: AiCloudProvider, accessMode: AiCloudAccessMode = 'api-key'): string {
    const cloudSettings = this.cloudSettings();
    if (provider === 'openai') {
      return cloudSettings.openaiChatModel;
    }

    return accessMode === 'hosted'
      ? this.grokConfig()?.defaults.responseModel || cloudSettings.xaiChatModel
      : this.hasCloudApiKey('xai')
        ? cloudSettings.xaiChatModel
        : this.grokConfig()?.defaults.responseModel || cloudSettings.xaiChatModel;
  }

  hasCloudApiKey(provider: AiCloudProvider): boolean {
    const cloudSettings = this.cloudSettings();
    return provider === 'openai'
      ? typeof cloudSettings.openaiApiKey === 'string' && cloudSettings.openaiApiKey.length > 0
      : typeof cloudSettings.xaiApiKey === 'string' && cloudSettings.xaiApiKey.length > 0;
  }

  hasCloudChatAccess(provider: AiCloudProvider): boolean {
    return provider === 'openai'
      ? this.hasCloudApiKey('openai')
      : this.hasCloudApiKey('xai') || this.hasHostedGrokAccess();
  }

  hasCloudChatAccessMode(provider: AiCloudProvider, accessMode: AiCloudAccessMode = 'api-key'): boolean {
    if (provider === 'openai') {
      return accessMode === 'api-key' && this.hasCloudApiKey('openai');
    }

    return accessMode === 'hosted' ? this.hasHostedGrokAccess() : this.hasCloudApiKey('xai');
  }

  hasCloudImageAccess(provider: AiCloudProvider): boolean {
    return provider === 'openai'
      ? this.hasCloudApiKey('openai')
      : this.hasCloudApiKey('xai') || this.hasHostedGrokAccess();
  }

  hasCloudVideoAccess(provider: AiCloudProvider): boolean {
    return provider === 'xai' && this.hasCloudApiKey('xai');
  }

  hasCloudVoiceAccess(provider: AiCloudProvider): boolean {
    return provider === 'xai' && this.hasCloudApiKey('xai');
  }

  getConfiguredImageProviders(): AiCloudProvider[] {
    const providers: AiCloudProvider[] = ['xai', 'openai'];
    return providers.filter(provider => this.hasCloudImageAccess(provider));
  }

  getConfiguredVideoProviders(): AiCloudProvider[] {
    return this.hasCloudVideoAccess('xai') ? ['xai'] : [];
  }

  getConfiguredVoiceProviders(): AiCloudProvider[] {
    return this.hasCloudVoiceAccess('xai') ? ['xai'] : [];
  }

  getActiveImageProvider(preferredProvider?: AiCloudProvider | null): AiCloudProvider | null {
    if (preferredProvider && this.hasCloudImageAccess(preferredProvider)) {
      return preferredProvider;
    }

    const defaultProvider = this.cloudSettings().preferredImageProvider;
    if (this.hasCloudImageAccess(defaultProvider)) {
      return defaultProvider;
    }

    return this.getConfiguredImageProviders()[0] ?? null;
  }

  updateCloudSettings(updates: Partial<AiCloudSettings>): void {
    const nextSettings = this.normalizeCloudSettings({
      ...this.cloudSettings(),
      ...updates,
    });

    this.cloudSettings.set(nextSettings);
    this.localStorage.setObject(AiService.CLOUD_SETTINGS_STORAGE_KEY, nextSettings);
  }

  setCloudApiKey(provider: AiCloudProvider, apiKey: string): void {
    this.updateCloudSettings(provider === 'openai' ? { openaiApiKey: apiKey } : { xaiApiKey: apiKey });
  }

  clearCloudApiKey(provider: AiCloudProvider): void {
    this.updateCloudSettings(provider === 'openai' ? { openaiApiKey: '' } : { xaiApiKey: '' });
  }

  async generateImage(
    prompt: string,
    provider?: AiCloudProvider | null,
    options?: AiImageGenerationOptions,
  ): Promise<AiGeneratedImage[]> {
    const activeProvider = this.getActiveImageProvider(provider);
    if (!activeProvider) {
      throw new Error('Add an OpenAI API key or use a premium account with Nostria Grok credits first.');
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('Image prompt cannot be empty.');
    }

    return activeProvider === 'openai'
      ? this.generateOpenAiImage(trimmedPrompt)
      : this.generateXAiImage(trimmedPrompt, options);
  }

  async generateVideo(
    prompt: string,
    options?: AiVideoGenerationOptions,
    progressCallback?: (data: AiVideoGenerationProgress) => void,
  ): Promise<AiGeneratedVideo[]> {
    const apiKey = this.cloudSettings().xaiApiKey;
    if (!apiKey) {
      throw new Error('xAI API key is missing.');
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('Video prompt cannot be empty.');
    }

    return this.generateXAiVideo(trimmedPrompt, options, progressCallback);
  }

  async generateVoice(prompt: string, provider: AiCloudProvider | 'local' = 'xai', model = this.speechModelId): Promise<AiGeneratedAudio[]> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('Voice prompt cannot be empty.');
    }

    if (provider === 'local') {
      return this.generateLocalVoice(trimmedPrompt, model);
    }

    const apiKey = this.cloudSettings().xaiApiKey;
    if (!apiKey) {
      throw new Error('xAI API key is missing.');
    }

    return this.generateXAiVoice(trimmedPrompt);
  }

  private async generateLocalVoice(prompt: string, model: string): Promise<AiGeneratedAudio[]> {
    const payload = await this.synthesizeSpeech(prompt) as { blob?: Blob };
    if (!(payload?.blob instanceof Blob)) {
      throw new Error('The local speech model did not return audio content.');
    }

    const mimeType = payload.blob.type || 'audio/wav';
    return [{
      id: `local-audio-${Date.now()}`,
      provider: 'local',
      providerLabel: this.getProviderLabel('local'),
      model,
      prompt,
      src: URL.createObjectURL(payload.blob),
      mimeType,
      voiceId: 'SpeechT5',
      language: 'en',
    }];
  }

  async generateLocalImage(
    prompt: string,
    model: string,
    progressCallback?: (data: AiImageGenerationProgress) => void,
  ): Promise<AiGeneratedImage[]> {
    if (!this.settings.settings().aiEnabled) {
      throw new Error('AI is disabled');
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('Image prompt cannot be empty.');
    }

    const payload = await this.postMessage(
      'generate-image',
      { prompt: trimmedPrompt, model },
      progressCallback as ((data: unknown) => void) | undefined,
    ) as AiLocalImageWorkerPayload;

    return this.mapLocalGeneratedImages(payload, model, trimmedPrompt);
  }

  async upscaleLocalImage(image: Blob, model: string, prompt = 'Upscale this image.'): Promise<AiGeneratedImage[]> {
    if (!this.settings.settings().aiEnabled) {
      throw new Error('AI is disabled');
    }

    const payload = await this.postMessage('upscale-image', { image, model }) as AiLocalUpscaledImageWorkerPayload;
    return this.mapUpscaledImage(payload, model, prompt);
  }

  async generateCloudText(messages: AiChatMessage[], provider: AiCloudProvider, model?: string, accessMode: AiCloudAccessMode = 'api-key'): Promise<string> {
    const apiKey = provider === 'openai' ? this.cloudSettings().openaiApiKey : this.cloudSettings().xaiApiKey;
    if (provider === 'xai' && (accessMode === 'hosted' || (!apiKey && this.hasHostedGrokAccess()))) {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        throw new Error('Log in to use hosted Grok credits.');
      }

      const payload = await this.grokApi.createResponse(pubkey, {
        model: model?.trim() || this.getChatModel('xai', 'hosted'),
        messages,
      });
      const content = this.extractChatCompletionText(payload.data);
      if (!content) {
        throw new Error('The provider returned an empty reply.');
      }

      await this.refreshGrokStatus();
      return content;
    }

    if (!apiKey) {
      throw new Error(`${this.getCloudAccessLabel(provider, accessMode)} is not configured.`);
    }

    const resolvedModel = model?.trim() || this.getChatModel(provider, accessMode);
    if (!resolvedModel) {
      throw new Error(`${this.getProviderLabel(provider)} chat model is not configured.`);
    }

    const url = provider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.x.ai/v1/chat/completions';

    const payload = await this.fetchChatCompletion(url, apiKey, {
      model: resolvedModel,
      messages,
    });

    const content = this.extractChatCompletionText(payload);
    if (!content) {
      throw new Error('The provider returned an empty reply.');
    }

    return content;
  }

  async deleteModelFromCache(modelId: string) {
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await caches.open(AiService.TRANSFORMERS_CACHE_NAME);
        const cacheKeys = this.getCacheLookupKeys(modelId);
        const keys = await cache.keys();
        const deletions = keys
          .filter(request => cacheKeys.some(cacheKey => request.url.includes(cacheKey)))
          .map(request => cache.delete(request));

        await Promise.all(deletions);

        // Update local state
        this.loadedModels.update(models => {
          const newModels = new Set(models);
          newModels.delete(modelId);
          return newModels;
        });

        return true;
      } catch (error) {
        console.error('Error deleting model from cache:', error);
        return false;
      }
    }
    return false;
  }

  async clearAllCache() {
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        await caches.delete(AiService.TRANSFORMERS_CACHE_NAME);
        this.loadedModels.set(new Set());
        return true;
      } catch (error) {
        console.error('Error clearing cache:', error);
        return false;
      }
    }
    return false;
  }

  async getModelStorageReport(): Promise<AiModelStorageReport> {
    const models = await Promise.all(this.manageableModels.map(model => this.getManagedModelStatus(model)));
    const totalBytes = models.reduce((sum, model) => sum + model.bytes, 0);
    const estimate = await this.getStorageEstimate();

    return {
      models,
      totalBytes,
      storageUsageBytes: estimate?.usage,
      storageQuotaBytes: estimate?.quota,
    };
  }

  private async getManagedModelStatus(model: AiManageableModel): Promise<AiManagedModelStatus> {
    const status = await this.checkModel(model.task, model.id);
    const bytes = await this.getCachedModelBytes(model.id);

    return {
      ...model,
      loaded: status.loaded,
      cached: status.cached || bytes > 0,
      bytes,
    };
  }

  private async getCachedModelBytes(modelId: string): Promise<number> {
    if (typeof window === 'undefined' || typeof caches === 'undefined') {
      return 0;
    }

    try {
      const cache = await caches.open(AiService.TRANSFORMERS_CACHE_NAME);
      const cacheKeys = this.getCacheLookupKeys(modelId);
      const requests = await cache.keys();
      const matchingRequests = requests.filter(request => cacheKeys.some(cacheKey => request.url.includes(cacheKey)));

      let totalBytes = 0;
      for (const request of matchingRequests) {
        const response = await cache.match(request);
        if (!response) {
          continue;
        }

        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          const parsed = Number(contentLength);
          if (Number.isFinite(parsed) && parsed >= 0) {
            totalBytes += parsed;
            continue;
          }
        }

        const blob = await response.clone().blob();
        totalBytes += blob.size;
      }

      return totalBytes;
    } catch (error) {
      console.error('Error reading model cache size:', error);
      return 0;
    }
  }

  private async getStorageEstimate(): Promise<StorageEstimate | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return null;
    }

    try {
      return await navigator.storage.estimate();
    } catch (error) {
      console.error('Error estimating storage usage:', error);
      return null;
    }
  }

  private getCacheLookupKeys(modelId: string): string[] {
    const entry = this.manageableModels.find(model => model.id === modelId);
    return entry?.cacheKeys?.length ? entry.cacheKeys : [modelId];
  }

  private loadCloudSettings(): void {
    const stored = this.localStorage.getObject<Partial<AiCloudSettings>>(AiService.CLOUD_SETTINGS_STORAGE_KEY);
    if (!stored) {
      return;
    }

    this.cloudSettings.set(this.normalizeCloudSettings({
      ...this.defaultCloudSettings,
      ...stored,
    }));
  }

  private normalizeCloudSettings(settings: Partial<AiCloudSettings>): AiCloudSettings {
    return {
      preferredImageProvider: settings.preferredImageProvider === 'openai' ? 'openai' : 'xai',
      openaiChatModel: settings.openaiChatModel?.trim() || this.defaultCloudSettings.openaiChatModel,
      xaiChatModel: settings.xaiChatModel?.trim() || this.defaultCloudSettings.xaiChatModel,
      openaiImageModel: settings.openaiImageModel?.trim() || this.defaultCloudSettings.openaiImageModel,
      openaiImageSize: this.normalizeOpenAiImageSize(settings.openaiImageSize),
      openaiImageQuality: this.normalizeChoiceSetting(settings.openaiImageQuality, this.defaultCloudSettings.openaiImageQuality, ['auto', 'low', 'medium', 'high']),
      openaiImageCount: this.normalizeIntegerSetting(settings.openaiImageCount, this.defaultCloudSettings.openaiImageCount, 1, 10),
      xaiImageModel: settings.xaiImageModel?.trim() || this.defaultCloudSettings.xaiImageModel,
      xaiImageAspectRatio: settings.xaiImageAspectRatio?.trim() || this.defaultCloudSettings.xaiImageAspectRatio,
      xaiImageResolution: settings.xaiImageResolution?.trim() || this.defaultCloudSettings.xaiImageResolution,
      xaiImageCount: this.normalizeIntegerSetting(settings.xaiImageCount, this.defaultCloudSettings.xaiImageCount, 1, 10),
      xaiVideoModel: settings.xaiVideoModel?.trim() || this.defaultCloudSettings.xaiVideoModel,
      xaiVideoDuration: this.normalizeIntegerSetting(settings.xaiVideoDuration, this.defaultCloudSettings.xaiVideoDuration, 1, 15),
      xaiVideoAspectRatio: settings.xaiVideoAspectRatio?.trim() || this.defaultCloudSettings.xaiVideoAspectRatio,
      xaiVideoResolution: settings.xaiVideoResolution?.trim() || this.defaultCloudSettings.xaiVideoResolution,
      xaiVoiceId: settings.xaiVoiceId?.trim() || this.defaultCloudSettings.xaiVoiceId,
      xaiVoiceLanguage: settings.xaiVoiceLanguage?.trim() || this.defaultCloudSettings.xaiVoiceLanguage,
      xaiVoiceCodec: settings.xaiVoiceCodec === 'wav' ? 'wav' : 'mp3',
      openaiApiKey: this.normalizeApiKey(settings.openaiApiKey),
      xaiApiKey: this.normalizeApiKey(settings.xaiApiKey),
    };
  }

  private normalizeApiKey(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private normalizeIntegerSetting(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(Math.max(Math.round(parsed), min), max);
  }

  private normalizeChoiceSetting(value: unknown, fallback: string, choices: readonly string[]): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return choices.includes(trimmed) ? trimmed : fallback;
  }

  private normalizeOpenAiImageSize(value: unknown): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) {
      return this.defaultCloudSettings.openaiImageSize;
    }

    if (trimmed === 'auto') {
      return trimmed;
    }

    if (!/^\d+x\d+$/.test(trimmed)) {
      return this.defaultCloudSettings.openaiImageSize;
    }

    const [width, height] = trimmed.split('x').map(part => Number.parseInt(part, 10));
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return this.defaultCloudSettings.openaiImageSize;
    }

    const longEdge = Math.max(width, height);
    const shortEdge = Math.min(width, height);
    const pixels = width * height;
    if (longEdge > 3840 || width % 16 !== 0 || height % 16 !== 0 || longEdge / shortEdge > 3 || pixels < 655360 || pixels > 8294400) {
      return this.defaultCloudSettings.openaiImageSize;
    }

    return trimmed;
  }

  private async generateOpenAiImage(prompt: string): Promise<AiGeneratedImage[]> {
    const apiKey = this.cloudSettings().openaiApiKey;
    if (!apiKey) {
      throw new Error('OpenAI API key is missing.');
    }

    const cloudSettings = this.cloudSettings();
    const payload = await this.fetchImageGeneration('https://api.openai.com/v1/images/generations', apiKey, {
      model: cloudSettings.openaiImageModel,
      prompt,
      n: cloudSettings.openaiImageCount,
      size: cloudSettings.openaiImageSize,
      quality: cloudSettings.openaiImageQuality,
    });

    return this.mapGeneratedImages(payload, 'openai', prompt);
  }

  private async generateXAiImage(prompt: string, options?: AiImageGenerationOptions): Promise<AiGeneratedImage[]> {
    const apiKey = this.cloudSettings().xaiApiKey;
    if (!apiKey && this.hasHostedGrokAccess()) {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        throw new Error('Log in to use hosted Grok credits.');
      }

      const cloudSettings = this.cloudSettings();
      const referenceImages = (options?.referenceImages ?? []).filter(value => value.trim().length > 0).slice(0, 5);
      const inputImages = (options?.inputImages ?? []).filter(value => value.trim().length > 0);
      const baseRequestBody: Record<string, unknown> = {
        model: this.getImageModel('xai'),
        prompt,
        n: cloudSettings.xaiImageCount,
        aspect_ratio: cloudSettings.xaiImageAspectRatio,
        resolution: cloudSettings.xaiImageResolution,
      };

      if (referenceImages.length > 0) {
        baseRequestBody['reference_images'] = referenceImages.map(url => ({ url }));
      }

      const request = inputImages.length > 0
        ? this.buildXAiImageEditRequest(inputImages, baseRequestBody)
        : {
          url: 'https://api.x.ai/v1/images/generations',
          body: baseRequestBody,
        };
      const payload = await this.grokApi.createImages(pubkey, request.body);

      await this.refreshGrokStatus();
      return this.mapGeneratedImages(payload.data, 'xai', prompt);
    }

    if (!apiKey) {
      throw new Error('xAI API key is missing.');
    }

    const cloudSettings = this.cloudSettings();
    const referenceImages = (options?.referenceImages ?? []).filter(value => value.trim().length > 0).slice(0, 5);
    const inputImages = (options?.inputImages ?? []).filter(value => value.trim().length > 0);
    const baseRequestBody: Record<string, unknown> = {
      model: cloudSettings.xaiImageModel,
      prompt,
      n: cloudSettings.xaiImageCount,
      aspect_ratio: cloudSettings.xaiImageAspectRatio,
      resolution: cloudSettings.xaiImageResolution,
    };

    if (referenceImages.length > 0) {
      baseRequestBody['reference_images'] = referenceImages.map(url => ({ url }));
    }

    const request = inputImages.length > 0
      ? this.buildXAiImageEditRequest(inputImages, baseRequestBody)
      : {
        url: 'https://api.x.ai/v1/images/generations',
        body: baseRequestBody,
      };

    const payload = await this.fetchImageGeneration(request.url, apiKey, request.body);

    return this.mapGeneratedImages(payload, 'xai', prompt);
  }

  async refreshGrokConfig(): Promise<GrokPublicConfig | null> {
    this.grokConfigLoading.set(true);
    try {
      const config = await this.grokApi.getPublicConfig();
      this.grokConfig.set(config);
      this.grokError.set('');
      return config;
    } catch (error) {
      this.grokConfig.set(null);
      this.grokError.set(error instanceof Error ? error.message : 'Failed to load Grok configuration.');
      return null;
    } finally {
      this.grokConfigLoading.set(false);
    }
  }

  async refreshGrokStatus(): Promise<GrokStatus | null> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey || !this.accountState.hasActiveSubscription()) {
      this.grokStatus.set(null);
      return null;
    }

    this.grokStatusLoading.set(true);
    try {
      const status = await this.grokApi.getStatus(pubkey);
      this.grokStatus.set(status);
      this.grokError.set('');
      return status;
    } catch (error) {
      this.grokStatus.set(null);
      this.grokError.set(error instanceof Error ? error.message : 'Failed to load Grok status.');
      return null;
    } finally {
      this.grokStatusLoading.set(false);
    }
  }

  async createGrokTopUp(amountCents: number): Promise<GrokHostedPayment> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      throw new Error('Log in to create a Grok top-up invoice.');
    }

    return this.grokApi.createTopUp(pubkey, amountCents);
  }

  async getGrokPayment(paymentId: string): Promise<GrokHostedPayment> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      throw new Error('Log in to check a Grok payment.');
    }

    return this.grokApi.getPayment(pubkey, paymentId);
  }

  private buildXAiImageEditRequest(inputImages: string[], baseRequestBody: Record<string, unknown>): { url: string; body: Record<string, unknown> } {
    const trimmedImages = inputImages.slice(0, 5);
    if (trimmedImages.length === 1) {
      return {
        url: 'https://api.x.ai/v1/images/edits',
        body: {
          ...baseRequestBody,
          image: {
            url: trimmedImages[0],
            type: 'image_url',
          },
        },
      };
    }

    return {
      url: 'https://api.x.ai/v1/images/edits',
      body: {
        ...baseRequestBody,
        images: trimmedImages.map(url => ({ url, type: 'image_url' })),
      },
    };
  }

  private async generateXAiVideo(
    prompt: string,
    options?: AiVideoGenerationOptions,
    progressCallback?: (data: AiVideoGenerationProgress) => void,
  ): Promise<AiGeneratedVideo[]> {
    const apiKey = this.cloudSettings().xaiApiKey;
    if (!apiKey) {
      throw new Error('xAI API key is missing.');
    }

    const cloudSettings = this.cloudSettings();
    const requestBody = this.buildXAiVideoRequestBody(prompt, options, cloudSettings);
    const endpoint = options?.mode === 'extend-video'
      ? 'https://api.x.ai/v1/videos/extensions'
      : options?.inputVideo?.trim()
        ? 'https://api.x.ai/v1/videos/edits'
        : 'https://api.x.ai/v1/videos/generations';
    const controller = this.createAbortController();

    try {
      const startResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const startPayload = await this.parseVideoStartResponse(startResponse);
      if (!startResponse.ok) {
        throw new Error(this.extractVideoError(startPayload) || `Video generation failed with status ${startResponse.status}.`);
      }

      const requestId = startPayload.request_id?.trim();
      if (!requestId) {
        throw new Error('The xAI video API did not return a request id.');
      }

      const statusPayload = await this.pollXAiVideoGeneration(requestId, apiKey, controller.signal, progressCallback);
      const videoUrl = statusPayload.video?.url?.trim();
      if (!videoUrl) {
        throw new Error('The xAI video API completed without returning a video URL.');
      }

      return [{
        id: `xai-video-${Date.now()}`,
        provider: 'xai',
        providerLabel: this.getProviderLabel('xai'),
        model: statusPayload.model?.trim() || cloudSettings.xaiVideoModel,
        prompt,
        src: videoUrl,
        originalUrl: videoUrl,
        costInUsdTicks: this.extractVideoUsageCostInUsdTicks(statusPayload),
        duration: statusPayload.video?.duration,
        mimeType: 'video/mp4',
      }];
    } finally {
      this.clearAbortController(controller);
    }
  }

  private async generateXAiVoice(prompt: string): Promise<AiGeneratedAudio[]> {
    const apiKey = this.cloudSettings().xaiApiKey;
    if (!apiKey) {
      throw new Error('xAI API key is missing.');
    }

    const cloudSettings = this.cloudSettings();
    const controller = this.createAbortController();

    try {
      const response = await fetch('https://api.x.ai/v1/tts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: prompt,
          voice_id: cloudSettings.xaiVoiceId,
          language: cloudSettings.xaiVoiceLanguage,
          output_format: {
            codec: cloudSettings.xaiVoiceCodec,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Voice generation failed with status ${response.status}.`);
      }

      const blob = await response.blob();
      const src = URL.createObjectURL(blob);
      return [{
        id: `xai-audio-${Date.now()}`,
        provider: 'xai',
        providerLabel: this.getProviderLabel('xai'),
        model: this.getVoiceModel('xai'),
        prompt,
        src,
        mimeType: blob.type || (cloudSettings.xaiVoiceCodec === 'wav' ? 'audio/wav' : 'audio/mpeg'),
        voiceId: cloudSettings.xaiVoiceId,
        language: cloudSettings.xaiVoiceLanguage,
      }];
    } finally {
      this.clearAbortController(controller);
    }
  }

  private buildXAiVideoRequestBody(
    prompt: string,
    options: AiVideoGenerationOptions | undefined,
    cloudSettings: AiCloudSettings,
  ): Record<string, unknown> {
    const referenceImages = (options?.referenceImages ?? []).filter(value => value.trim().length > 0).slice(0, 5);

    const requestBody: Record<string, unknown> = {
      model: cloudSettings.xaiVideoModel,
      prompt,
      duration: cloudSettings.xaiVideoDuration,
    };

    if (options?.mode !== 'extend-video') {
      const aspectRatio = options?.aspectRatio?.trim() || cloudSettings.xaiVideoAspectRatio.trim();
      if (aspectRatio && aspectRatio !== 'auto') {
        requestBody['aspect_ratio'] = aspectRatio;
      }
      requestBody['resolution'] = cloudSettings.xaiVideoResolution;
    }

    if (options?.inputVideo?.trim()) {
      requestBody['video'] = { url: options.inputVideo.trim() };
      return requestBody;
    }

    if (referenceImages.length > 0) {
      requestBody['reference_images'] = referenceImages.map(url => ({ url }));
      return requestBody;
    }

    if (options?.inputImage?.trim()) {
      requestBody['image'] = { url: options.inputImage.trim() };
    }

    return requestBody;
  }

  private async fetchImageGeneration(url: string, apiKey: string, body: Record<string, unknown>): Promise<AiImageApiPayload> {
    const controller = this.createAbortController();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = await this.parseApiResponse(response);
      if (!response.ok) {
        throw new Error(this.extractApiError(payload) || `Image generation failed with status ${response.status}.`);
      }

      return payload;
    } finally {
      this.clearAbortController(controller);
    }
  }

  private async fetchChatCompletion(url: string, apiKey: string, body: Record<string, unknown>): Promise<AiCloudChatCompletionPayload> {
    const controller = this.createAbortController();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = await this.parseChatCompletionResponse(response);
      if (!response.ok) {
        throw new Error(this.extractChatCompletionError(payload) || `Chat completion failed with status ${response.status}.`);
      }

      return payload;
    } finally {
      this.clearAbortController(controller);
    }
  }

  private async pollXAiVideoGeneration(
    requestId: string,
    apiKey: string,
    signal: AbortSignal,
    progressCallback?: (data: AiVideoGenerationProgress) => void,
  ): Promise<AiVideoGenerationStatusPayload> {
    while (true) {
      const response = await fetch(`https://api.x.ai/v1/videos/${encodeURIComponent(requestId)}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal,
      });

      const payload = await this.parseVideoStatusResponse(response);
      if (!response.ok) {
        throw new Error(this.buildVideoErrorMessage(payload, `Video status check failed with status ${response.status}.`));
      }

      this.reportXAiVideoProgress(payload, progressCallback);

      switch (payload.status) {
        case 'done':
          return payload;
        case 'failed':
          throw new Error(this.buildVideoErrorMessage(payload, 'Video generation failed.'));
        case 'expired':
          throw new Error(this.buildVideoErrorMessage(payload, 'The video generation request expired before the result was ready.'));
        case 'pending':
        default:
          await this.waitForVideoPollInterval(signal, 2000);
          break;
      }
    }
  }

  private reportXAiVideoProgress(
    payload: AiVideoGenerationStatusPayload,
    progressCallback?: (data: AiVideoGenerationProgress) => void,
  ): void {
    if (!progressCallback || !payload.status) {
      return;
    }

    const progress = typeof payload.progress === 'number' && Number.isFinite(payload.progress)
      ? Math.max(0, Math.min(100, Math.round(payload.progress)))
      : payload.status === 'done'
        ? 100
        : undefined;

    progressCallback({
      status: payload.status,
      progress,
    });
  }

  private waitForVideoPollInterval(signal: AbortSignal, delayMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);

      const onAbort = () => {
        cleanup();
        reject(signal.reason ?? this.createAbortError());
      };

      const cleanup = () => {
        globalThis.clearTimeout(timeoutId);
        signal.removeEventListener('abort', onAbort);
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async parseVideoStartResponse(response: Response): Promise<AiVideoGenerationStartPayload> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as AiVideoGenerationStartPayload;
    } catch {
      return { message: text };
    }
  }

  private async parseVideoStatusResponse(response: Response): Promise<AiVideoGenerationStatusPayload> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as AiVideoGenerationStatusPayload;
    } catch {
      return { message: text };
    }
  }

  private extractVideoError(payload: AiVideoGenerationStartPayload | AiVideoGenerationStatusPayload): string | null {
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }

    if (typeof payload.error === 'object' && typeof payload.error?.message === 'string' && payload.error.message.trim()) {
      return payload.error.message.trim();
    }

    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }

    return null;
  }

  private extractVideoUsageCostInUsdTicks(payload: AiVideoGenerationStartPayload | AiVideoGenerationStatusPayload): number | undefined {
    const ticks = payload.usage?.cost_in_usd_ticks;
    return typeof ticks === 'number' && Number.isFinite(ticks) ? ticks : undefined;
  }

  private buildVideoErrorMessage(payload: AiVideoGenerationStartPayload | AiVideoGenerationStatusPayload, fallback: string): string {
    const message = this.extractVideoError(payload) || fallback;
    const costInUsdTicks = this.extractVideoUsageCostInUsdTicks(payload);
    if (costInUsdTicks === undefined) {
      return message;
    }

    return `${message} Reported usage cost: ${this.formatVideoUsageCost(costInUsdTicks)}.`;
  }

  private formatVideoUsageCost(costInUsdTicks: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(costInUsdTicks / 10_000_000_000);
  }

  private async parseChatCompletionResponse(response: Response): Promise<AiCloudChatCompletionPayload> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as AiCloudChatCompletionPayload;
    } catch {
      return { message: text };
    }
  }

  private extractChatCompletionError(payload: AiCloudChatCompletionPayload): string | null {
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }

    if (typeof payload.error === 'object' && typeof payload.error?.message === 'string' && payload.error.message.trim()) {
      return payload.error.message.trim();
    }

    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }

    return null;
  }

  private extractChatCompletionText(payload: AiCloudChatCompletionPayload): string {
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map(part => typeof part?.text === 'string' ? part.text : '')
        .join('')
        .trim();
    }

    return '';
  }

  private async parseApiResponse(response: Response): Promise<AiImageApiPayload> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as AiImageApiPayload;
    } catch {
      return { message: text };
    }
  }

  private extractApiError(payload: AiImageApiPayload): string | null {
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }

    if (typeof payload.error === 'object' && typeof payload.error?.message === 'string' && payload.error.message.trim()) {
      return payload.error.message.trim();
    }

    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }

    return null;
  }

  private mapGeneratedImages(payload: AiImageApiPayload, provider: AiCloudProvider, prompt: string): AiGeneratedImage[] {
    if (!Array.isArray(payload.data) || payload.data.length === 0) {
      throw new Error('The provider returned no images.');
    }

    const cloudSettings = this.cloudSettings();
    const imageSettings: AiGeneratedImageSettings = provider === 'xai'
      ? {
        provider,
        model: this.getImageModel(provider),
        xaiImageAspectRatio: cloudSettings.xaiImageAspectRatio,
        xaiImageResolution: cloudSettings.xaiImageResolution,
        xaiImageCount: cloudSettings.xaiImageCount,
      }
      : {
        provider,
        model: this.getImageModel(provider),
        openaiImageSize: cloudSettings.openaiImageSize,
        openaiImageQuality: cloudSettings.openaiImageQuality,
        openaiImageCount: cloudSettings.openaiImageCount,
      };

    return payload.data.map((entry, index) => {
      const src = entry.b64_json
        ? this.buildBase64DataUrl(entry.b64_json)
        : entry.url;

      if (!src) {
        throw new Error('The provider response did not include image content.');
      }

      return {
        id: `${provider}-${Date.now()}-${index}`,
        provider,
        providerLabel: this.getProviderLabel(provider),
        model: this.getImageModel(provider),
        prompt,
        revisedPrompt: entry.revised_prompt,
        src,
        originalUrl: entry.url,
        imageSettings,
      };
    });
  }

  private async mapLocalGeneratedImages(
    payload: AiLocalImageWorkerPayload,
    model: string,
    prompt: string,
  ): Promise<AiGeneratedImage[]> {
    if (!Array.isArray(payload.images) || payload.images.length === 0) {
      throw new Error('The local model returned no images.');
    }

    return Promise.all(payload.images.map(async (entry, index) => {
      if (!(entry.blob instanceof Blob)) {
        throw new Error('The local model did not return image content.');
      }

      const mimeType = entry.mimeType || entry.blob.type || 'image/png';
      return {
        id: `local-${Date.now()}-${index}`,
        provider: 'local' as const,
        providerLabel: this.getProviderLabel('local'),
        model,
        prompt,
        src: await this.blobToDataUrl(entry.blob),
        mimeType,
        imageSettings: {
          provider: 'local',
          model,
        },
      };
    }));
  }

  private async mapUpscaledImage(
    payload: AiLocalUpscaledImageWorkerPayload,
    model: string,
    prompt: string,
  ): Promise<AiGeneratedImage[]> {
    if (!(payload.image?.blob instanceof Blob)) {
      throw new Error('The upscaling model did not return image content.');
    }

    const mimeType = payload.image.mimeType || payload.image.blob.type || 'image/png';
    return [{
      id: `local-upscale-${Date.now()}`,
      provider: 'local',
      providerLabel: this.getProviderLabel('local'),
      model,
      prompt,
      src: await this.blobToDataUrl(payload.image.blob),
      mimeType,
    }];
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('Could not read image data.'));
      reader.readAsDataURL(blob);
    });
  }

  private buildBase64DataUrl(base64: string): string {
    const mimeType = this.inferMimeType(base64);
    return `data:${mimeType};base64,${base64}`;
  }

  private inferMimeType(base64: string): string {
    if (base64.startsWith('iVBORw0KGgo')) {
      return 'image/png';
    }

    if (base64.startsWith('/9j/')) {
      return 'image/jpeg';
    }

    if (base64.startsWith('UklGR')) {
      return 'image/webp';
    }

    if (base64.startsWith('R0lGOD')) {
      return 'image/gif';
    }

    return 'image/png';
  }

  private postMessage(type: string, payload: unknown, progressCallback?: (data: unknown) => void): Promise<unknown> {
    if (type !== 'check') {
      this._processingCount++;
      this.processingState.set({ isProcessing: true, task: type });
    }

    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substring(7);
      this.callbacks[id] = {
        type,
        resolve: (val) => {
          if (type !== 'check') {
            this._processingCount--;
            if (this._processingCount <= 0) {
              this._processingCount = 0;
              this.processingState.set({ isProcessing: false, task: null });
            }
          }
          resolve(val);
        },
        reject: (err) => {
          if (type !== 'check') {
            this._processingCount--;
            if (this._processingCount <= 0) {
              this._processingCount = 0;
              this.processingState.set({ isProcessing: false, task: null });
            }
          }
          reject(err);
        },
        progress: progressCallback
      };
      this.worker?.postMessage({ type, payload, id });
    });
  }
}
