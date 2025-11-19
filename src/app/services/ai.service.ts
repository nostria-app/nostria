import { Injectable, signal } from '@angular/core';

interface WorkerCallback {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  progress?: (data: unknown) => void;
}

@Injectable({
  providedIn: 'root'
})
export class AiService {
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
    return this.postMessage('generate', { text, params });
  }

  async summarizeText(text: string, params?: unknown) {
    return this.postMessage('summarize', { text, params });
  }

  async analyzeSentiment(text: string, params?: unknown) {
    return this.postMessage('sentiment', { text, params });
  }

  async translateText(text: string, model: string, params?: unknown) {
    return this.postMessage('translate', { text, model, params });
  }

  async transcribeAudio(audio: Float32Array, params?: unknown) {
    return this.postMessage('transcribe', { audio, params });
  }

  async synthesizeSpeech(text: string, params?: unknown) {
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
