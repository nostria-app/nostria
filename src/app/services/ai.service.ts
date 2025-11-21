import { Injectable, signal, inject } from '@angular/core';
import { SettingsService } from './settings.service';

interface WorkerCallback {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  progress?: (data: unknown) => void;
}

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private settings = inject(SettingsService);
  private worker: Worker | null = null;
  private callbacks: Record<string, WorkerCallback> = {};

  // Signals for UI
  textModelLoaded = signal(false);
  translationModelLoaded = signal(false);
  summarizationModelLoaded = signal(false);
  sentimentModelLoaded = signal(false);
  transcriptionModelLoaded = signal(false);
  speechModelLoaded = signal(false);

  loadedModels = signal<Set<string>>(new Set());

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
  readonly textGenerationModelId = 'Xenova/LaMini-Flan-T5-783M';

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
    if (typeof Worker !== 'undefined') {
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
    } else {
      // Fallback or error
      console.error('Web Workers are not supported in this environment.');
    }
  }

  async loadModel(task: string, model: string, progressCallback?: (data: unknown) => void) {
    return this.postMessage('load', { task, model }, progressCallback).then((res) => {
      if (task === 'text-generation') this.textModelLoaded.set(true);
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

  async generateText(text: string, params?: unknown) {
    if (!this.settings.settings().aiEnabled) throw new Error('AI is disabled');
    return this.postMessage('generate', { text, params });
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

  async deleteModelFromCache(modelId: string) {
    if ('caches' in window) {
      try {
        const cache = await caches.open('transformers-cache');
        const keys = await cache.keys();
        const deletions = keys
          .filter(request => request.url.includes(modelId))
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
    if ('caches' in window) {
      try {
        await caches.delete('transformers-cache');
        this.loadedModels.set(new Set());
        return true;
      } catch (error) {
        console.error('Error clearing cache:', error);
        return false;
      }
    }
    return false;
  }

  private postMessage(type: string, payload: unknown, progressCallback?: (data: unknown) => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substring(7);
      this.callbacks[id] = { resolve, reject, progress: progressCallback };
      this.worker?.postMessage({ type, payload, id });
    });
  }
}
