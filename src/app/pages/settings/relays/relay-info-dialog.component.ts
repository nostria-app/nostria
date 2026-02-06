import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';
import { AccountStateService } from '../../../services/account-state.service';
import { EventRepublishService } from '../../../services/event-republish.service';

export interface RelayDialogData {
  relayUrl: string;
  adding: boolean;
  showMigration?: boolean; // Only show for account relays, default true
}

interface RelayInfo {
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  software?: string;
  version?: string;
  banner?: string;
  icon?: string;
  posting_policy?: string;
  privacy_policy?: string;
  payments_url?: string;
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
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatIconModule,
    MatTooltipModule,
    RouterModule,
  ],
  template: `
    @if (adding()) {
      <h2 mat-dialog-title>Adding Relay</h2>
    } @else {
      <h2 mat-dialog-title>Relay Details</h2>
    }

    <mat-dialog-content>
      @if (loading()) {
        <div class="loading-container">
          <mat-spinner [diameter]="40"></mat-spinner>
          <p>Loading relay information...</p>
        </div>
      } @else if (error()) {
        <div class="error-container">
          <p>Unable to fetch relay information: {{ error() }}</p>
        </div>
      } @else if (relayInfo()) {
        @if (relayInfo()?.banner) {
          <div class="banner-container">
            <img [src]="relayInfo()?.banner" alt="Relay Banner" class="relay-banner" />
          </div>
        }

        <!-- <div class="banner-container">
            <img src="https://image.nostr.build/nostr.build_74ee63e85287e5b3351d757724e57d53d17b9f029bfad7d77dcb913b325727bb.png" alt="Relay Banner" class="relay-banner">
        </div> -->

        <div class="relay-header">
          @if (iconUrl()) {
            <img
              [src]="iconUrl()"
              alt="Relay Icon"
              class="relay-icon"
              (error)="handleIconError()"
            />
          }
          <h3>{{ relayInfo()?.name || relayUrl() }}</h3>
        </div>

        <div class="relay-info">
          <div class="info-row"><strong>URL:</strong> {{ relayUrl() }}</div>
          @if (relayInfo()?.description) {
            <div class="info-row"><strong>Description:</strong> {{ relayInfo()?.description }}</div>
          }
          @if (relayInfo()?.contact) {
            <div class="info-row">
              <strong>Contact:</strong>&nbsp;<a
                [href]="relayInfo()?.contact"
                target="_blank"
                rel="noopener noreferrer"
                >{{ relayInfo()?.contact }}</a
              >
            </div>
          }
          @if (relayInfo()?.posting_policy) {
            <div class="info-row">
              <strong>Posting Policy:</strong>&nbsp;<a
                [href]="relayInfo()?.posting_policy"
                target="_blank"
                rel="noopener noreferrer"
                >{{ relayInfo()?.posting_policy }}</a
              >
            </div>
          }
          @if (relayInfo()?.privacy_policy) {
            <div class="info-row">
              <strong>Privacy Policy:</strong>&nbsp;<a
                [href]="relayInfo()?.privacy_policy"
                target="_blank"
                rel="noopener noreferrer"
                >{{ relayInfo()?.privacy_policy }}</a
              >
            </div>
          }
          <br />
          @if (relayInfo()?.software) {
            <div class="info-row"><strong>Software:</strong> {{ relayInfo()?.software }}</div>
          }
          @if (relayInfo()?.version) {
            <div class="info-row">
              <strong>Software Version:</strong> {{ relayInfo()?.version }}
            </div>
          }
          @if (relayInfo()?.supported_nips && (relayInfo()?.supported_nips)!.length > 0) {
            <div class="info-row">
              <strong>Supported NIPs:</strong>
              {{ relayInfo()?.supported_nips!.join(', ') }}
            </div>
          }
          <br />
          <div class="info-row">
            <strong>Requires Payment:</strong>
            {{ relayInfo()?.limitation?.payment_required ? 'Yes' : 'No' }}
          </div>
          @if (relayInfo()?.payments_url) {
            <div class="info-row">
              <strong>Payment:</strong>&nbsp;<a
                [href]="relayInfo()?.payments_url"
                target="_blank"
                rel="noopener noreferrer"
                >{{ relayInfo()?.payments_url }}</a
              >
            </div>
          }
          <div class="info-row">
            <strong>Restricted Writes:</strong>
            {{ relayInfo()?.limitation?.restricted_writes ? 'Yes' : 'No' }}
          </div>
          <div class="info-row">
            <strong>Authentication Required:</strong>
            {{ relayInfo()?.limitation?.auth_required ? 'Yes' : 'No' }}
          </div>
        </div>

        @if (hasRestrictions()) {
          <div class="restriction-warning">
            <mat-icon class="warning-icon">warning</mat-icon>
            <div class="warning-content">
              <strong>This relay has access restrictions</strong>
              <p>
                @if (relayInfo()?.limitation?.payment_required) {
                  This relay requires payment to publish events.
                } @else if (relayInfo()?.limitation?.restricted_writes) {
                  This relay restricts who can write events.
                }
              </p>
              @if (relayInfo()?.payments_url) {
                <a [href]="relayInfo()?.payments_url" target="_blank" rel="noopener noreferrer" class="signup-link">
                  Sign up or pay for access →
                </a>
              }
              @if (adding()) {
                <p class="warning-note">
                  You can still add this relay, but publishing events may fail until you have access.
                </p>
              }
            </div>
          </div>
        }

        @if (!adding() && showMigration()) {
          <div class="migration-container">
            <h3>Data Migration</h3>
            <p>Sync your important data to ensure it's accessible on this relay.</p>
            
            <div class="migration-actions">
              <button 
                mat-stroked-button 
                (click)="migrateImportantEvents()" 
                [disabled]="isMigrating()"
              >
                @if (isMigrating()) {
                  <ng-container>
                    <mat-spinner [diameter]="18"></mat-spinner>
                    Migrating...
                  </ng-container>
                } @else {
                  <ng-container>
                    <mat-icon>sync</mat-icon>
                    Migrate Important Events
                  </ng-container>
                }
              </button>
              
              <button 
                mat-stroked-button 
                [disabled]="true"
                matTooltip="Coming soon - will migrate all your notes and content"
              >
                <mat-icon>cloud_upload</mat-icon>
                Migrate All Events
              </button>
            </div>
            
            @if (migrationResult()) {
              <div class="migration-result" [class.success]="migrationResult()!.failed === 0">
                <mat-icon>{{ migrationResult()!.failed === 0 ? 'check_circle' : 'warning' }}</mat-icon>
                <span>
                  {{ migrationResult()!.success }} events synced
                  @if (migrationResult()!.failed > 0) {
                    , {{ migrationResult()!.failed }} failed
                  }
                </span>
              </div>
            }
          </div>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (adding()) {
        <button mat-button mat-dialog-close>Cancel</button>
        <button mat-flat-button color="primary" [disabled]="loading()" (click)="confirmAdd()">
          Add Relay
        </button>
      } @else {
        <button mat-button mat-dialog-close>Close</button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .loading-container,
    .error-container {
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
      border-top: 1px solid rgba(0, 0, 0, 0.12);
    }

    .premium-feature {
      padding: 12px;
      background-color: rgba(0, 0, 0, 0.04);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .banner-container {
      margin: -24px -24px 16px -24px;
      overflow: hidden;
      max-height: 200px;
    }

    .relay-banner {
      width: 100%;
      height: auto;
      object-fit: cover;
    }

    .relay-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .relay-icon {
      width: 32px;
      height: 32px;
      border-radius: 4px;
      box-shadow: var(--mat-sys-level1);
    }

    .restriction-warning {
      display: flex;
      gap: 12px;
      padding: 16px;
      margin: 16px 0;
      background-color: var(--mat-sys-error-container);
      border-radius: 8px;
      border-left: 4px solid var(--mat-sys-error);
    }

    .warning-icon {
      color: var(--mat-sys-error);
      flex-shrink: 0;
    }

    .warning-content {
      flex: 1;
    }

    .warning-content strong {
      color: var(--mat-sys-on-error-container);
      display: block;
      margin-bottom: 8px;
    }

    .warning-content p {
      margin: 0 0 8px 0;
      color: var(--mat-sys-on-error-container);
      font-size: 0.875rem;
    }

    .warning-content a {
      color: var(--mat-sys-primary);
    }

    .warning-content .signup-link {
      display: inline-block;
      padding: 8px 16px;
      margin: 8px 0;
      background-color: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      border-radius: 4px;
      text-decoration: none;
    }

    .warning-content .signup-link:hover {
      opacity: 0.9;
    }

    .warning-note {
      font-style: italic;
      opacity: 0.8;
    }

    .migration-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 16px;
    }

    .migration-actions button {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: center;
    }

    .migration-actions mat-spinner {
      margin-right: 4px;
    }

    .migration-result {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
      padding: 12px;
      border-radius: 8px;
      background-color: var(--mat-sys-surface-container);
    }

    .migration-result.success {
      background-color: var(--mat-success-color);
      color: white;
    }

    .migration-result mat-icon {
      flex-shrink: 0;
    }
  `,
})
export class RelayInfoDialogComponent {
  private logger = inject(LoggerService);
  private dialogRef = inject(MatDialogRef<RelayInfoDialogComponent>);
  private eventRepublish = inject(EventRepublishService);
  layout = inject(LayoutService);
  accountState = inject(AccountStateService);

  private data = inject<RelayDialogData>(MAT_DIALOG_DATA);
  relayUrl = signal(this.data.relayUrl);
  adding = signal(this.data.adding);
  showMigration = signal(this.data.showMigration !== false); // Default to true

  relayInfo = signal<RelayInfo | null>(null);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);
  migrateData = signal<boolean>(false);

  // Migration state
  isMigrating = signal(false);
  migrationResult = signal<{ success: number; failed: number; notFound: number } | null>(null);
  iconUrl = signal<string | null>(null);
  faviconUrl = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.relayUrl()) {
        this.fetchRelayInfo(this.relayUrl());
      }
    });

    effect(() => {
      // Set icon URL when relayInfo changes
      const info = this.relayInfo();
      if (info) {
        if (info.icon) {
          this.iconUrl.set(info.icon);
        } else {
          // Try to load favicon
          this.tryLoadFavicon();
        }
      }
    });
  }

  async fetchRelayInfo(url: string): Promise<void> {
    if (!url) return;

    this.loading.set(true);
    this.error.set(null);

    try {
      const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');

      this.logger.info('Fetching relay info', { url: httpUrl });

      const response = await fetch(httpUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/nostr+json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const data = await response.json();
      this.relayInfo.set(data);
      this.logger.info('Relay info fetched', { info: data });
    } catch (err) {
      this.logger.error('Error fetching relay info', err);
      this.error.set(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      this.loading.set(false);
    }
  }

  async tryLoadFavicon(): Promise<void> {
    try {
      const baseUrl = this.relayUrl().replace('wss://', 'https://');
      const faviconUrl = `${new URL(baseUrl).origin}/favicon.ico`;

      this.faviconUrl.set(faviconUrl);
      this.iconUrl.set(faviconUrl);

      this.logger.info('Trying to load favicon', { url: faviconUrl });
    } catch (err) {
      this.logger.error('Error creating favicon URL', err);
    }
  }

  handleIconError(): void {
    // If icon fails to load, clear it
    this.iconUrl.set(null);
    this.logger.warn('Failed to load relay icon');
  }

  /**
   * Check if the relay has restrictions that would prevent writing events
   */
  hasRestrictions(): boolean {
    const info = this.relayInfo();
    if (!info?.limitation) return false;
    return !!(info.limitation.payment_required || info.limitation.restricted_writes);
  }

  /**
   * Migrate important events to all account relays
   */
  async migrateImportantEvents(): Promise<void> {
    this.isMigrating.set(true);
    this.migrationResult.set(null);

    try {
      const result = await this.eventRepublish.republishImportantEvents();
      this.migrationResult.set({
        success: result.success,
        failed: result.failed,
        notFound: result.notFound,
      });
      this.logger.info('Migration completed', result);
    } catch (error) {
      this.logger.error('Migration failed', error);
      this.migrationResult.set({
        success: 0,
        failed: 1,
        notFound: 0,
      });
    } finally {
      this.isMigrating.set(false);
    }
  }

  confirmAdd(): void {
    this.dialogRef.close({
      confirmed: true,
      migrateData: this.migrateData(),
    });
  }
}
