import { Component, inject, signal, OnInit } from '@angular/core';
import { DatabaseService } from '../../services/database.service';
import { LoggerService } from '../../services/logger.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-storage-debug',
  imports: [CommonModule, MatCardModule, MatButtonModule, MatExpansionModule],
  template: `
    <div class="debug-container">
      <mat-card>
        <mat-card-header>
          <mat-card-title>Storage Debug Information</mat-card-title>
          <mat-card-subtitle>Diagnostic information for storage issues</mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          <div class="status-section">
            <h3>Current Status</h3>
            <p>
              <strong>Initialized:</strong>
              {{ database.initialized() ? 'Yes' : 'No' }}
            </p>
            <p>
              <strong>Last Error:</strong>
              {{ database.lastError() || 'None' }}
            </p>
            <p>
              <strong>Storage Health:</strong>
              {{ storageHealth() || 'Not checked' }}
            </p>
          </div>

          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>Diagnostic Information</mat-panel-title>
            </mat-expansion-panel-header>

            @if (diagnosticInfo()) {
              <pre>{{ diagnosticInfo() | json }}</pre>
            } @else {
              <p>No diagnostic information available</p>
            }
          </mat-expansion-panel>

          <div class="actions-section">
            <button mat-raised-button (click)="runDiagnostics()">
              Run Diagnostics
            </button>

            <button mat-raised-button (click)="checkHealth()">
              Check Storage Health
            </button>

            <button mat-raised-button color="warn" (click)="clearStorage()">
              Clear Storage & Restart
            </button>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .debug-container {
        padding: 16px;
        max-width: 800px;
        margin: 0 auto;
      }

      .status-section {
        margin-bottom: 16px;
      }

      .actions-section {
        margin-top: 16px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      mat-expansion-panel {
        margin: 8px 0;
      }

      pre {
        font-size: 12px;
        padding: 8px;
        border-radius: 4px;
        overflow-x: auto;
        max-height: 300px;
        overflow-y: auto;
      }

      h3 {
        margin-top: 0;
      }
    `,
  ],
})
export class StorageDebugComponent implements OnInit {
  database = inject(DatabaseService);
  logger = inject(LoggerService);

  diagnosticInfo = signal<unknown>(null);
  storageHealth = signal<string>('');

  async ngOnInit() {
    await this.runDiagnostics();
  }

  async runDiagnostics() {
    try {
      const storageEstimate = await this.database.getStorageEstimate();
      const eventsCount = await this.database.countEvents();
      const info = {
        initialized: this.database.initialized(),
        lastError: this.database.lastError(),
        storageEstimate,
        eventsCount,
      };
      this.diagnosticInfo.set(info);
      this.logger.info('Diagnostic information collected', info);
    } catch (error) {
      this.logger.error('Failed to collect diagnostic information', error);
      this.diagnosticInfo.set({ error: 'Failed to collect diagnostics' });
    }
  }

  async checkHealth() {
    try {
      const isHealthy = this.database.initialized();
      this.storageHealth.set(isHealthy ? 'Healthy' : 'Unhealthy');
    } catch (error) {
      this.storageHealth.set('Error checking health');
      this.logger.error('Health check failed', error);
    }
  }

  async clearStorage() {
    if (confirm('This will clear all stored data and restart the app. Continue?')) {
      try {
        await this.database.wipe();
        window.location.reload();
      } catch (error) {
        this.logger.error('Failed to clear storage', error);
        alert('Failed to clear storage. Check console for details.');
      }
    }
  }
}
