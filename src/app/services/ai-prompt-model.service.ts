import { computed, inject, signal, Service } from '@angular/core';

import { AiCloudAccessMode, AiCloudProvider, AiModelLoadOptions, AiService } from './ai.service';
import { LocalStorageService } from './local-storage.service';

export interface AiPromptModelInfo {
  id: string;
  task: 'text-generation' | 'image-text-to-text';
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

type AiModeModelSelections = Partial<Record<'text', string>>;

@Service()
export class AiPromptModelService {
  private static readonly MODE_MODEL_SELECTIONS_STORAGE_KEY = 'nostria-ai-mode-model-selections';

  private readonly aiService = inject(AiService);
  private readonly localStorage = inject(LocalStorageService);

  readonly webGpuAvailable = this.aiService.isWebGpuAvailable();

  readonly localChatModels = signal<AiPromptModelInfo[]>([
    {
      id: 'onnx-community/gemma-4-E2B-it-ONNX',
      task: 'text-generation',
      name: 'Gemma 4 E2B',
      description: 'Instruction-tuned Gemma 4 chat model for local browser inference.',
      size: '~3.4 GB download',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q4f16',
      source: 'local',
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
      id: 'onnx-community/Bonsai-1.7B-ONNX',
      task: 'text-generation',
      name: 'Bonsai 1.7B',
      description: 'Fast Bonsai chat model for local browser inference.',
      size: '~300 MB download',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q1',
      source: 'local',
      loadOptions: { device: 'webgpu', dtype: 'q1' },
      chatMode: 'messages',
      chatDisabledReason: this.webGpuAvailable ? undefined : 'Requires WebGPU support in the browser.',
      preferredParams: {
        max_new_tokens: 512,
        do_sample: false,
      },
    },
    {
      id: 'onnx-community/Bonsai-4B-ONNX',
      task: 'text-generation',
      name: 'Bonsai 4B',
      description: 'Larger Bonsai chat model for local browser inference.',
      size: '~650 MB download',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q1',
      source: 'local',
      loadOptions: { device: 'webgpu', dtype: 'q1' },
      chatMode: 'messages',
      chatDisabledReason: this.webGpuAvailable ? undefined : 'Requires WebGPU support in the browser.',
      preferredParams: {
        max_new_tokens: 512,
        do_sample: false,
      },
    },
    {
      id: 'onnx-community/Bonsai-8B-ONNX',
      task: 'text-generation',
      name: 'Bonsai 8B',
      description: 'High-capacity Bonsai chat model for local browser inference on stronger WebGPU devices.',
      size: '~1.3 GB download',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q1',
      source: 'local',
      loadOptions: { device: 'webgpu', dtype: 'q1' },
      chatMode: 'messages',
      chatDisabledReason: this.webGpuAvailable ? undefined : 'Requires WebGPU support in the browser.',
      preferredParams: {
        max_new_tokens: 512,
        do_sample: false,
      },
    },
    {
      id: 'onnx-community/Qwen3.5-0.8B-ONNX',
      task: 'image-text-to-text',
      name: 'Qwen 3.5 0.8B Vision',
      description: 'Multimodal Qwen 3.5 model for local browser image-aware chat and visual analysis.',
      size: '~650 MB download',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q4f16 · vision',
      source: 'local',
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
      size: '~480 MB download',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q4f16',
      source: 'local',
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
      size: '~565 MB download',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WebGPU · q4f16',
      source: 'local',
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
      size: '~230 MB download',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false,
      runtime: 'WASM/CPU',
      source: 'local',
      chatMode: 'prompt',
      preferredParams: {
        max_new_tokens: 120,
        do_sample: true,
        temperature: 0.8,
        return_full_text: false,
      },
    },
  ]);

  readonly cloudChatModels = computed<AiPromptModelInfo[]>(() => {
    const models: AiPromptModelInfo[] = [];

    if (this.aiService.hasCloudChatAccessMode('xai', 'api-key')) {
      models.push(this.createCloudModel('xai', 'api-key', 'cloud-chat:xai:api-key', 'Chat with xAI using your own API key.'));
    }

    if (this.aiService.hasCloudChatAccessMode('xai', 'hosted')) {
      models.push(this.createCloudModel('xai', 'hosted', 'cloud-chat:xai:hosted', 'Chat with Nostria hosted Grok using your subscription and credits.'));
    }

    if (this.aiService.hasCloudChatAccessMode('openai', 'api-key')) {
      models.push(this.createCloudModel('openai', 'api-key', 'cloud-chat:openai', 'Chat with OpenAI using your own API key.'));
    }

    if (this.aiService.hasCloudChatAccessMode('nostria', 'api-key')) {
      models.push(this.createCloudModel('nostria', 'api-key', 'cloud-chat:nostria', 'Chat with Nostria AI using your own API key.'));
    }

    return models;
  });

  readonly promptModels = computed(() => [
    ...this.localChatModels(),
    ...this.cloudChatModels(),
  ]);

  readonly selectedModelId = signal(this.getInitialSelectedModelId());
  readonly selectedModel = computed(() => {
    const selectedId = this.selectedModelId();
    return this.promptModels().find(model => model.id === selectedId)
      ?? this.getFallbackTextModel()
      ?? null;
  });

  constructor() {
    if (typeof Worker !== 'undefined') {
      void this.initializeModelStatus();
    }
  }

  selectModel(modelId: string): void {
    const resolved = this.resolveModelId(modelId);
    if (!resolved) {
      return;
    }

    this.selectedModelId.set(resolved);
    this.storeLastTextModelSelection(resolved);
  }

  updateModelStatus(id: string, updates: Partial<AiPromptModelInfo>): void {
    this.localChatModels.update(models => models.map(model => model.id === id ? { ...model, ...updates } : model));
  }

  markModelUnavailable(id: string, reason: string): void {
    this.updateModelStatus(id, {
      chatDisabledReason: reason,
      loaded: false,
      cached: true,
      loading: false,
      progress: 0,
    });
  }

  async unloadOtherLocalModels(activeModelId: string): Promise<void> {
    const loadedModels = this.localChatModels()
      .filter(model => model.id !== activeModelId && (model.loaded || this.aiService.isModelLoaded(model.id)));

    if (loadedModels.length === 0) {
      return;
    }

    await this.aiService.resetLocalModelRuntime();
    this.localChatModels.update(models => models.map(model => ({
      ...model,
      loaded: false,
      cached: model.cached || loadedModels.some(loadedModel => loadedModel.id === model.id),
      loading: false,
      progress: 0,
    })));
  }

  modelMenuMeta(model: AiPromptModelInfo): string {
    if (model.source === 'cloud') {
      return model.cloudModel ? `Hosted API · ${model.cloudModel}` : 'Hosted API';
    }

    const details = [model.size];
    details.push(model.task === 'image-text-to-text' ? 'Image chat' : 'Text chat');
    if (model.chatDisabledReason) {
      details.push(model.chatDisabledReason);
    }

    return details.join(' · ');
  }

  statusLabel(model: AiPromptModelInfo): string {
    if (model.source === 'cloud') {
      if (model.provider === 'openai') {
        return 'Key';
      }

      if (model.provider === 'xai') {
        return model.cloudAccessMode === 'hosted' ? 'Hosted' : 'Key';
      }

      return 'Hosted';
    }

    if (model.chatDisabledReason) {
      return 'Unavailable';
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

  private createCloudModel(
    provider: AiCloudProvider,
    cloudAccessMode: AiCloudAccessMode,
    id: string,
    description: string,
  ): AiPromptModelInfo {
    return {
      id,
      task: 'text-generation',
      name: this.aiService.getCloudModelDisplayName(provider, cloudAccessMode),
      description,
      size: 'Hosted API',
      loading: false,
      progress: 100,
      loaded: true,
      cached: false,
      runtime: this.aiService.getCloudAccessLabel(provider, cloudAccessMode),
      source: 'cloud',
      provider,
      cloudAccessMode,
      cloudModel: this.aiService.getChatModel(provider, cloudAccessMode),
      chatMode: 'messages',
    };
  }

  private async initializeModelStatus(): Promise<void> {
    for (const model of this.localChatModels()) {
      try {
        const status = await this.aiService.checkModel(model.task, model.id, model.loadOptions);
        this.updateModelStatus(model.id, { loaded: status.loaded, cached: status.cached });
      } catch {
        // Status checks are best-effort; model loading reports detailed errors later.
      }
    }
  }

  private getInitialSelectedModelId(): string {
    return this.getPreferredTextModel()?.id
      ?? (this.webGpuAvailable ? 'onnx-community/gemma-4-E2B-it-ONNX' : 'Xenova/distilgpt2');
  }

  private getPreferredTextModel(): AiPromptModelInfo | undefined {
    const selectedId = this.readLastModelSelections().text;
    if (!selectedId) {
      return undefined;
    }

    return this.promptModels().find(model => model.id === selectedId);
  }

  private getFallbackTextModel(): AiPromptModelInfo | undefined {
    return this.localChatModels().find(model => model.id === 'Xenova/distilgpt2')
      ?? this.localChatModels()[0]
      ?? this.cloudChatModels()[0];
  }

  private resolveModelId(modelId: string): string | null {
    if (this.promptModels().some(model => model.id === modelId)) {
      return modelId;
    }

    if (modelId === 'cloud-chat:xai') {
      return this.cloudChatModels().find(candidate => candidate.provider === 'xai')?.id ?? null;
    }

    return null;
  }

  private readLastModelSelections(): AiModeModelSelections {
    return this.localStorage.getObject<AiModeModelSelections>(AiPromptModelService.MODE_MODEL_SELECTIONS_STORAGE_KEY) ?? {};
  }

  private storeLastTextModelSelection(modelId: string): void {
    const selections = this.readLastModelSelections();
    if (selections.text === modelId) {
      return;
    }

    this.localStorage.setObject<AiModeModelSelections>(AiPromptModelService.MODE_MODEL_SELECTIONS_STORAGE_KEY, {
      ...selections,
      text: modelId,
    });
  }
}
