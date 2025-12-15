import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { ShareDebugService, ShareDebugLog } from '../../services/share-debug.service';

@Component({
  selector: 'app-share-debug-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatCardModule],
  template: `
    <div class="debug-viewer">
      <div class="header">
        <h3>Share Target Debug Logs</h3>
        <div class="actions">
          <button mat-button (click)="refresh()">
            <mat-icon>refresh</mat-icon>
            Refresh
          </button>
          <button mat-button color="warn" (click)="clear()">
            <mat-icon>delete</mat-icon>
            Clear
          </button>
        </div>
      </div>

      @if (logs().length === 0) {
        <mat-card class="empty-state">
          <p>No share target logs yet.</p>
          <p>Try sharing an image to this app from your gallery.</p>
          <p class="hint">If logs appear from service-worker, the SW is intercepting requests.</p>
        </mat-card>
      } @else {
        <div class="logs-container">
          @for (log of logs(); track log.timestamp) {
            <mat-card class="log-entry" [class]="log.source">
              <div class="log-header">
                <span class="source">{{ log.source }}</span>
                <span class="time">{{ formatTime(log.timestamp) }}</span>
              </div>
              <div class="message">{{ log.message }}</div>
              @if (log.data) {
                <pre class="data">{{ formatData(log.data) }}</pre>
              }
            </mat-card>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .debug-viewer {
      padding: 16px;
      max-height: 80vh;
      overflow-y: auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .header h3 {
      margin: 0;
    }

    .actions {
      display: flex;
      gap: 8px;
    }

    .empty-state {
      padding: 24px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }

    .hint {
      font-size: 12px;
      margin-top: 16px;
      opacity: 0.7;
    }

    .logs-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .log-entry {
      padding: 12px;
      font-size: 13px;
    }

    .log-entry.service-worker {
      border-left: 4px solid #ff9800;
    }

    .log-entry.share-target {
      border-left: 4px solid #2196f3;
    }

    .log-entry.app {
      border-left: 4px solid #4caf50;
    }

    .log-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .source {
      font-family: monospace;
      padding: 2px 8px;
      border-radius: 4px;
      background: var(--mat-sys-surface-container-high);
      font-size: 11px;
      text-transform: uppercase;
    }

    .time {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
    }

    .message {
      margin-bottom: 8px;
    }

    .data {
      background: var(--mat-sys-surface-container);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 11px;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
    }
  `]
})
export class ShareDebugViewerComponent {
  private shareDebug = inject(ShareDebugService);

  logs = signal<ShareDebugLog[]>([]);

  constructor() {
    this.refresh();
  }

  async refresh(): Promise<void> {
    const logs = await this.shareDebug.getLogs();
    this.logs.set(logs);
  }

  async clear(): Promise<void> {
    await this.shareDebug.clearLogs();
    this.logs.set([]);
  }

  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  formatData(data: unknown): string {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }
}
