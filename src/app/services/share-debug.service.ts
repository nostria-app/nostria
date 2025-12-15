import { Injectable } from '@angular/core';

export interface ShareDebugLog {
  timestamp: number;
  source: 'service-worker' | 'share-target' | 'app';
  message: string;
  data?: unknown;
}

const STORAGE_KEY = 'nostria-share-debug-logs';
const MAX_LOGS = 50;

@Injectable({
  providedIn: 'root'
})
export class ShareDebugService {
  private logs: ShareDebugLog[] = [];

  constructor() {
    this.loadLogs();
    this.listenToServiceWorkerMessages();
  }

  private loadLogs(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch {
      this.logs = [];
    }
  }

  private saveLogs(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs));
    } catch {
      // Storage full or unavailable
    }
  }

  private listenToServiceWorkerMessages(): void {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SHARE_DEBUG_LOG') {
          const { timestamp, source, message, data } = event.data.payload;
          this.addLogEntry({
            timestamp,
            source,
            message,
            data
          });
        }
      });
    }
  }

  private addLogEntry(entry: ShareDebugLog): void {
    this.logs.unshift(entry);

    // Keep only the last MAX_LOGS entries
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(0, MAX_LOGS);
    }

    this.saveLogs();
  }

  log(source: ShareDebugLog['source'], message: string, data?: unknown): void {
    const entry: ShareDebugLog = {
      timestamp: Date.now(),
      source,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : undefined
    };

    this.addLogEntry(entry);
    console.log(`[ShareDebug][${source}] ${message}`, data || '');
  }

  getLogs(): ShareDebugLog[] {
    this.loadLogs(); // Refresh from storage
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
    localStorage.removeItem(STORAGE_KEY);
  }
}
