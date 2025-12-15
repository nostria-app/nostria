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

  async getLogs(): Promise<ShareDebugLog[]> {
    this.loadLogs(); // Refresh from localStorage
    
    // Also try to read from IndexedDB (service worker logs)
    try {
      const idbLogs = await this.readLogsFromIDB();
      // Merge and dedupe logs
      const allLogs = [...this.logs, ...idbLogs];
      allLogs.sort((a, b) => b.timestamp - a.timestamp);
      
      // Dedupe by timestamp + message
      const seen = new Set<string>();
      const deduped = allLogs.filter(log => {
        const key = `${log.timestamp}-${log.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      
      return deduped.slice(0, MAX_LOGS);
    } catch {
      return [...this.logs];
    }
  }

  private readLogsFromIDB(): Promise<ShareDebugLog[]> {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open('share-debug-db', 1);
        request.onerror = () => resolve([]);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('logs')) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction('logs', 'readonly');
          const store = tx.objectStore('logs');
          const getAllRequest = store.getAll();
          getAllRequest.onsuccess = () => {
            db.close();
            resolve(getAllRequest.result || []);
          };
          getAllRequest.onerror = () => {
            db.close();
            resolve([]);
          };
        };
        request.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('logs')) {
            db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          }
        };
      } catch {
        resolve([]);
      }
    });
  }

  async clearLogs(): Promise<void> {
    this.logs = [];
    localStorage.removeItem(STORAGE_KEY);
    
    // Also clear IndexedDB
    try {
      const request = indexedDB.open('share-debug-db', 1);
      request.onsuccess = () => {
        const db = request.result;
        if (db.objectStoreNames.contains('logs')) {
          const tx = db.transaction('logs', 'readwrite');
          tx.objectStore('logs').clear();
        }
        db.close();
      };
    } catch {
      // Ignore
    }
  }
}
