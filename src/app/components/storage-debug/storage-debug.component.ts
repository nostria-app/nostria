import { Component, inject, signal } from '@angular/core';
import { StorageService } from '../../services/storage.service';
import { LoggerService } from '../../services/logger.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-storage-debug',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatExpansionModule
  ],
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
            <p><strong>Initialized:</strong> {{ storage.initialized() ? 'Yes' : 'No' }}</p>
            <p><strong>Fallback Mode:</strong> {{ storage.useFallbackMode() ? 'Yes' : 'No' }}</p>
            <p><strong>Storage Health:</strong> {{ storageHealth() || 'Not checked' }}</p>
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

          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>Storage Info</mat-panel-title>
            </mat-expansion-panel-header>
            
            <pre>{{ storage.storageInfo() | json }}</pre>
          </mat-expansion-panel>

          <div class="actions-section">
            <button mat-raised-button color="primary" (click)="runDiagnostics()">
              Run Diagnostics
            </button>
            
            <button mat-raised-button color="accent" (click)="checkHealth()">
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
  styles: [`
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
  `]
})
export class StorageDebugComponent {
  storage = inject(StorageService);
  logger = inject(LoggerService);

  diagnosticInfo = signal<any>(null);
  storageHealth = signal<string>('');

  async ngOnInit() {
    await this.runDiagnostics();
  }

  async runDiagnostics() {
    try {
      const info = await this.storage.getDiagnosticInfo();
      this.diagnosticInfo.set(info);
      this.logger.info('Diagnostic information collected', info);
    } catch (error) {
      this.logger.error('Failed to collect diagnostic information', error);
      this.diagnosticInfo.set({ error: 'Failed to collect diagnostics' });
    }
  }

  async checkHealth() {
    try {
      const isHealthy = await this.storage.checkStorageHealth();
      this.storageHealth.set(isHealthy ? 'Healthy' : 'Unhealthy');
    } catch (error) {
      this.storageHealth.set('Error checking health');
      this.logger.error('Health check failed', error);
    }
  }

  async clearStorage() {
    if (confirm('This will clear all stored data and restart the app. Continue?')) {
      try {
        await this.storage.wipe();
        window.location.reload();
      } catch (error) {
        this.logger.error('Failed to clear storage', error);
        alert('Failed to clear storage. Check console for details.');
      }
    }
  }
}
