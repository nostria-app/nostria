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
      return res;
    });
  }

  async generateText(text: string, params?: unknown) {
    return this.postMessage('generate', { text, params });
  }

  async translateText(text: string, params?: unknown) {
    return this.postMessage('translate', { text, params });
  }

  private postMessage(type: string, payload: unknown, progressCallback?: (data: unknown) => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substring(7);
      this.callbacks[id] = { resolve, reject, progress: progressCallback };
      this.worker?.postMessage({ type, payload, id });
    });
  }
}
