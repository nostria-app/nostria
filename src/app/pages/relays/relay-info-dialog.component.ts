import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { LoggerService } from '../../services/logger.service';
import { LayoutService } from '../../services/layout.service';

export interface RelayDialogData {
    relayUrl: string;
}

interface RelayInfo {
    name?: string;
    description?: string;
    pubkey?: string;
    contact?: string;
    software?: string;
    version?: string;
    supported_nips?: number[];
    limitation?: {
        auth_required?: boolean;
        max_message_length?: number;
        payment_required?: boolean;
        restricted_writes?: boolean;
        [key: string]: any;
    };
    [key: string]: any;
}

@Component({
    selector: 'app-relay-info-dialog',
    standalone: true,
    imports: [
        CommonModule,
        MatDialogModule,
        MatButtonModule,
        MatProgressSpinnerModule,
        MatSlideToggleModule
    ],
    template: `
    <h2 mat-dialog-title>Relay Information: {{relayUrl()}}</h2>
    
    <mat-dialog-content>
      @if (loading()) {
        <div class="loading-container">
          <mat-spinner [diameter]="40"></mat-spinner>
          <p>Loading relay information...</p>
        </div>
      } @else if (error()) {
        <div class="error-container">
          <p>Unable to fetch relay information: {{error()}}</p>
        </div>
      } @else if (relayInfo()) {
        <div class="relay-info">
          <div class="info-row">
            <strong>Name:</strong> {{relayInfo()?.name || 'Not provided'}}
          </div>
          @if (relayInfo()?.description) {
            <div class="info-row">
              <strong>Description:</strong> {{relayInfo()?.description}}
            </div>
          }
          @if (relayInfo()?.contact) {
            <div class="info-row">
              <strong>Contact:</strong> {{relayInfo()?.contact}}
            </div>
          }
          @if (relayInfo()?.software) {
            <div class="info-row">
              <strong>Software:</strong> {{relayInfo()?.software}}
            </div>
          }
          @if (relayInfo()?.version) {
            <div class="info-row">
              <strong>Software Version:</strong> {{relayInfo()?.version}}
            </div>
          }
          @if (relayInfo()?.supported_nips && relayInfo()?.supported_nips!.length > 0) {
            <div class="info-row">
              <strong>Supported NIPs:</strong> {{relayInfo()?.supported_nips!.join(', ')}}
            </div>
          }
          <div class="info-row">
            <strong>Requires Payment:</strong> {{relayInfo()?.limitation?.payment_required ? 'Yes' : 'No'}}
          </div>
          <div class="info-row">
            <strong>Restricted Writes:</strong> {{relayInfo()?.limitation?.restricted_writes ? 'Yes' : 'No'}}
          </div>
          <div class="info-row">
            <strong>Authentication Required:</strong> {{relayInfo()?.limitation?.auth_required ? 'Yes' : 'No'}}
          </div>
        </div>

        <div class="migration-container">
          <h3>Data Migration</h3>
          @if (layout.premium()) {
            <p>Would you like to migrate your existing data to this relay?</p>
            <mat-slide-toggle [checked]="migrateData()" (change)="migrateData.set($event.checked)">
              Migrate data to this relay
            </mat-slide-toggle>
          } @else {
            <div class="premium-feature">
              <p>Data migration is a premium feature</p>
              <button mat-stroked-button color="accent">Upgrade to Premium</button>
            </div>
          }
        </div>
      }
    </mat-dialog-content>
    
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [disabled]="loading()" (click)="confirmAdd()">
        Add Relay
      </button>
    </mat-dialog-actions>
  `,
    styles: `
    .loading-container, .error-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .relay-info {
      margin-bottom: 24px;
    }
    
    .info-row {
      padding: 2px 0;
    }
    
    .migration-container {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid rgba(0,0,0,0.12);
    }
    
    .premium-feature {
      padding: 12px;
      background-color: rgba(0,0,0,0.04);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
  `
})
export class RelayInfoDialogComponent {
    private logger = inject(LoggerService);
    private dialogRef = inject(MatDialogRef<RelayInfoDialogComponent>);
    layout = inject(LayoutService);

    // relayUrl = input<string>('');
    // isPremiumUser = input<boolean>(false);

    private data = inject<RelayDialogData>(MAT_DIALOG_DATA);
    relayUrl = signal(this.data.relayUrl);

    relayInfo = signal<RelayInfo | null>(null);
    loading = signal<boolean>(true);
    error = signal<string | null>(null);
    migrateData = signal<boolean>(false);

    constructor() {
        effect(() => {
            if (this.relayUrl()) {
                this.fetchRelayInfo(this.relayUrl());
            }
        });
    }

    async fetchRelayInfo(url: string): Promise<void> {
        if (!url) return;

        this.loading.set(true);
        this.error.set(null);

        try {
            const httpUrl = url.replace('wss://', 'https://');

            this.logger.info('Fetching relay info', { url: httpUrl });

            const response = await fetch(httpUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/nostr+json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }

            const data = await response.json();
            this.relayInfo.set(data);
            console.log('Relay info:', data);
            this.logger.info('Relay info fetched', { info: data });
        } catch (err) {
            this.logger.error('Error fetching relay info', err);
            this.error.set(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            this.loading.set(false);
        }
    }

    confirmAdd(): void {
        this.dialogRef.close({
            confirmed: true,
            migrateData: this.migrateData(),
        });
    }
}
