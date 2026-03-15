import { Component, ChangeDetectionStrategy, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { LoggerService } from '../../../services/logger.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DiscoveryRelayService } from '../../../services/relays/discovery-relay';
import { NostrService } from '../../../services/nostr.service';
import { EventRepublishService } from '../../../services/event-republish.service';
import { RelaysService, Nip11RelayInfo } from '../../../services/relays/relays';
import { RightPanelService } from '../../../services/right-panel.service';
import { Relay } from '../../../services/relays/relay';
import { kinds } from 'nostr-tools';

type RelayMode = 'readwrite' | 'read' | 'write';

@Component({
  selector: 'app-relay-detail',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font">Relay Details</h2>
      <span class="panel-header-spacer"></span>
    </div>

    <div class="relay-detail-content">
      <div class="relay-header-section">
        @if (iconUrl()) {
          <img [src]="iconUrl()" alt="Relay Icon" class="relay-icon" (error)="handleIconError()" />
        }
        <div class="relay-header-text">
          <h3 class="relay-name">{{ displayName() }}</h3>
          <span class="relay-url-display">{{ relayUrl() }}</span>
        </div>
      </div>

      <mat-divider></mat-divider>

      <!-- Read/Write Mode -->
      <div class="setting-row">
        <div class="setting-label">
          <mat-icon>swap_vert</mat-icon>
          <div>
            <span class="setting-title">Relay Mode</span>
            <span class="setting-description">Controls how this relay is used</span>
          </div>
        </div>
        <button mat-stroked-button [matMenuTriggerFor]="modeMenu" class="mode-button">
          <mat-icon>{{ modeIcon() }}</mat-icon>
          {{ modeLabel() }}
          <mat-icon>arrow_drop_down</mat-icon>
        </button>
        <mat-menu #modeMenu="matMenu">
          <button mat-menu-item (click)="setMode('readwrite')">
            <mat-icon>swap_vert</mat-icon>
            <span>Read & Write</span>
          </button>
          <button mat-menu-item (click)="setMode('read')">
            <mat-icon>download</mat-icon>
            <span>Read Only</span>
          </button>
          <button mat-menu-item (click)="setMode('write')">
            <mat-icon>upload</mat-icon>
            <span>Write Only</span>
          </button>
        </mat-menu>
      </div>

      <mat-divider></mat-divider>

      <!-- NIP-11 Relay Information -->
      <mat-accordion>
        <mat-expansion-panel (opened)="loadNip11()">
          <mat-expansion-panel-header>
            <mat-panel-title>
              <mat-icon class="section-icon">info</mat-icon>
              Relay Information (NIP-11)
            </mat-panel-title>
          </mat-expansion-panel-header>

          @if (nip11Loading()) {
            <div class="loading-container">
              <mat-spinner [diameter]="32"></mat-spinner>
              <span>Loading relay information...</span>
            </div>
          } @else if (nip11Error()) {
            <div class="error-container">
              <mat-icon>error_outline</mat-icon>
              <span>{{ nip11Error() }}</span>
            </div>
          } @else if (nip11Info()) {
            <div class="nip11-details">
              @if (nip11Info()!.description) {
                <div class="detail-row">
                  <span class="detail-label">Description</span>
                  <span class="detail-value">{{ nip11Info()!.description }}</span>
                </div>
              }
              @if (nip11Info()!.contact) {
                <div class="detail-row">
                  <span class="detail-label">Contact</span>
                  <a [href]="nip11Info()!.contact" target="_blank" rel="noopener noreferrer" class="detail-value link">
                    {{ nip11Info()!.contact }}
                  </a>
                </div>
              }
              @if (nip11Info()!.software) {
                <div class="detail-row">
                  <span class="detail-label">Software</span>
                  <span class="detail-value">
                    {{ nip11Info()!.software }}
                    @if (nip11Info()!.version) {
                      v{{ nip11Info()!.version }}
                    }
                  </span>
                </div>
              }
              @if (nip11Info()!.supported_nips && nip11Info()!.supported_nips!.length > 0) {
                <div class="detail-row">
                  <span class="detail-label">Supported NIPs</span>
                  <div class="nips-list">
                    @for (nip of nip11Info()!.supported_nips; track nip) {
                      <span class="nip-chip">{{ nip }}</span>
                    }
                  </div>
                </div>
              }
              @if (nip11Info()!.posting_policy) {
                <div class="detail-row">
                  <span class="detail-label">Posting Policy</span>
                  <a [href]="nip11Info()!.posting_policy" target="_blank" rel="noopener noreferrer" class="detail-value link">
                    {{ nip11Info()!.posting_policy }}
                  </a>
                </div>
              }
              @if (nip11Info()!.privacy_policy) {
                <div class="detail-row">
                  <span class="detail-label">Privacy Policy</span>
                  <a [href]="nip11Info()!.privacy_policy" target="_blank" rel="noopener noreferrer" class="detail-value link">
                    {{ nip11Info()!.privacy_policy }}
                  </a>
                </div>
              }

              <mat-divider></mat-divider>

              <div class="detail-row">
                <span class="detail-label">Requires Payment</span>
                <span class="detail-value">{{ nip11Info()!.limitation?.payment_required ? 'Yes' : 'No' }}</span>
              </div>
              @if (nip11Info()!.payments_url) {
                <div class="detail-row">
                  <span class="detail-label">Payment URL</span>
                  <a [href]="nip11Info()!.payments_url" target="_blank" rel="noopener noreferrer" class="detail-value link">
                    {{ nip11Info()!.payments_url }}
                  </a>
                </div>
              }
              <div class="detail-row">
                <span class="detail-label">Restricted Writes</span>
                <span class="detail-value">{{ nip11Info()!.limitation?.restricted_writes ? 'Yes' : 'No' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Auth Required</span>
                <span class="detail-value">{{ nip11Info()!.limitation?.auth_required ? 'Yes' : 'No' }}</span>
              </div>
              @if (nip11Info()!.limitation?.max_message_length) {
                <div class="detail-row">
                  <span class="detail-label">Max Message Length</span>
                  <span class="detail-value">{{ nip11Info()!.limitation!.max_message_length }}</span>
                </div>
              }
              @if (nip11Info()!.limitation?.max_content_length) {
                <div class="detail-row">
                  <span class="detail-label">Max Content Length</span>
                  <span class="detail-value">{{ nip11Info()!.limitation!.max_content_length }}</span>
                </div>
              }
              @if (nip11Info()!.limitation?.max_subscriptions) {
                <div class="detail-row">
                  <span class="detail-label">Max Subscriptions</span>
                  <span class="detail-value">{{ nip11Info()!.limitation!.max_subscriptions }}</span>
                </div>
              }

              @if (nip11Info()!.relay_countries && nip11Info()!.relay_countries!.length > 0) {
                <div class="detail-row">
                  <span class="detail-label">Countries</span>
                  <span class="detail-value">{{ nip11Info()!.relay_countries!.join(', ') }}</span>
                </div>
              }
              @if (nip11Info()!.language_tags && nip11Info()!.language_tags!.length > 0) {
                <div class="detail-row">
                  <span class="detail-label">Languages</span>
                  <span class="detail-value">{{ nip11Info()!.language_tags!.join(', ') }}</span>
                </div>
              }
            </div>
          }
        </mat-expansion-panel>
      </mat-accordion>

      <mat-divider></mat-divider>

      <!-- Data Migration -->
      <div class="migration-section">
        <h3 class="section-heading">
          <mat-icon class="section-icon">sync</mat-icon>
          Data Migration
        </h3>
        <p class="section-description">Sync your important data to ensure it's accessible on this relay.</p>

        <div class="migration-actions">
          <button mat-stroked-button (click)="migrateImportantEvents()" [disabled]="isMigrating()">
            @if (isMigrating()) {
              <mat-spinner [diameter]="18"></mat-spinner>
            } @else {
              <mat-icon>sync</mat-icon>
            }
            <span>{{ isMigrating() ? 'Migrating...' : 'Migrate Important Events' }}</span>
          </button>

          <button mat-stroked-button [disabled]="true" matTooltip="Coming soon - will migrate all your notes and content">
            <mat-icon>cloud_upload</mat-icon>
            <span>Migrate All Events</span>
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

      <mat-divider></mat-divider>

      <!-- Remove Relay -->
      <div class="danger-section">
        <button mat-stroked-button class="remove-button" (click)="removeRelay()">
          <mat-icon>delete</mat-icon>
          <span>Remove Relay</span>
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .relay-detail-content {
      padding: 16px;
    }

    .relay-header-section {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .relay-icon {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      box-shadow: var(--mat-sys-level1);
    }

    .relay-header-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .relay-name {
      margin: 0;
      font-size: 18px;
    }

    .relay-url-display {
      color: var(--mat-sys-on-surface-variant);
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      gap: 12px;
    }

    .setting-label {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .setting-label mat-icon {
      color: var(--mat-sys-on-surface-variant);
    }

    .setting-title {
      display: block;
      font-size: 14px;
    }

    .setting-description {
      display: block;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .mode-button {
      min-width: 140px;
    }

    .section-icon {
      margin-right: 8px;
      font-size: 20px;
      width: 20px;
      height: 20px;
      vertical-align: middle;
      color: var(--mat-sys-on-surface-variant);
    }

    .section-heading {
      display: flex;
      align-items: center;
      margin: 0 0 4px;
      font-size: 16px;
    }

    .section-description {
      color: var(--mat-sys-on-surface-variant);
      font-size: 13px;
      margin: 0 0 12px;
    }

    .loading-container {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 0;
      color: var(--mat-sys-on-surface-variant);
    }

    .error-container {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 0;
      color: var(--mat-sys-error);
    }

    .nip11-details {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .detail-row {
      display: flex;
      flex-direction: column;
      padding: 6px 0;
    }

    .detail-label {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .detail-value {
      font-size: 14px;
    }

    .detail-value.link {
      color: var(--mat-sys-primary);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }

    .nips-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
    }

    .nip-chip {
      display: inline-flex;
      padding: 2px 8px;
      border-radius: var(--mat-sys-corner-full);
      font-size: 12px;
      background-color: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
    }

    .migration-section {
      padding: 16px 0;
    }

    .migration-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .migration-actions button {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: center;
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

    .danger-section {
      padding: 16px 0;
    }

    .remove-button {
      color: var(--mat-sys-error);
      border-color: var(--mat-sys-error);

      mat-icon {
        color: var(--mat-sys-error);
      }
    }
  `,
  host: { class: 'panel-with-sticky-header' },
})
export class RelayDetailComponent {
  relayUrl = input.required<string>();
  onRelayRemoved = input<() => void>();
  onRelayModeChanged = input<() => void>();

  private logger = inject(LoggerService);
  private accountRelay = inject(AccountRelayService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private nostr = inject(NostrService);
  private eventRepublish = inject(EventRepublishService);
  private relaysService = inject(RelaysService);
  private rightPanel = inject(RightPanelService);

  nip11Info = signal<Nip11RelayInfo | null>(null);
  nip11Loading = signal(false);
  nip11Error = signal<string | null>(null);
  nip11Loaded = signal(false);

  iconUrl = signal<string | null>(null);

  isMigrating = signal(false);
  migrationResult = signal<{ success: number; failed: number; notFound: number } | null>(null);

  relay = computed(() => {
    const url = this.relayUrl();
    return this.accountRelay.relaysSignal().find(r => r.url === url);
  });

  currentMode = computed<RelayMode>(() => {
    const r = this.relay();
    if (!r) return 'readwrite';
    if (r.read && r.write) return 'readwrite';
    if (r.read) return 'read';
    return 'write';
  });

  modeLabel = computed(() => {
    switch (this.currentMode()) {
      case 'readwrite': return 'Read & Write';
      case 'read': return 'Read Only';
      case 'write': return 'Write Only';
    }
  });

  modeIcon = computed(() => {
    switch (this.currentMode()) {
      case 'readwrite': return 'swap_vert';
      case 'read': return 'download';
      case 'write': return 'upload';
    }
  });

  displayName = computed(() => {
    const info = this.nip11Info();
    if (info?.name) return info.name;
    return this.formatRelayUrl(this.relayUrl());
  });

  constructor() {
    effect(() => {
      const info = this.nip11Info();
      if (info) {
        if (info.icon) {
          this.iconUrl.set(info.icon);
        } else {
          this.tryLoadFavicon();
        }
      }
    });
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

  formatRelayUrl(url: string): string {
    return url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
  }

  async loadNip11(): Promise<void> {
    if (this.nip11Loaded()) return;
    this.nip11Loaded.set(true);
    this.nip11Loading.set(true);
    this.nip11Error.set(null);

    try {
      const info = await this.relaysService.fetchNip11Info(this.relayUrl());
      this.nip11Info.set(info);
    } catch (err) {
      this.nip11Error.set(err instanceof Error ? err.message : 'Failed to load relay info');
    } finally {
      this.nip11Loading.set(false);
    }
  }

  async setMode(mode: RelayMode): Promise<void> {
    const read = mode === 'readwrite' || mode === 'read';
    const write = mode === 'readwrite' || mode === 'write';
    this.accountRelay.setRelayMarker(this.relayUrl(), read, write);
    await this.publish();
    this.onRelayModeChanged()?.();
  }

  async removeRelay(): Promise<void> {
    this.accountRelay.removeRelay(this.relayUrl());
    await this.publish();
    this.onRelayRemoved()?.();
    this.rightPanel.goBack();
  }

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
    } catch (error) {
      this.logger.error('Migration failed', error);
      this.migrationResult.set({ success: 0, failed: 1, notFound: 0 });
    } finally {
      this.isMigrating.set(false);
    }
  }

  handleIconError(): void {
    this.iconUrl.set(null);
  }

  private tryLoadFavicon(): void {
    try {
      const baseUrl = this.relayUrl().replace('wss://', 'https://');
      const faviconUrl = `${new URL(baseUrl).origin}/favicon.ico`;
      this.iconUrl.set(faviconUrl);
    } catch {
      // ignore
    }
  }

  private async publish(): Promise<void> {
    const relays = this.accountRelay.relaysSignal();
    const tags: string[][] = relays.map(relay => {
      if (relay.read && relay.write) {
        return ['r', relay.url];
      } else if (relay.write) {
        return ['r', relay.url, 'write'];
      } else {
        return ['r', relay.url, 'read'];
      }
    });

    const relayListEvent = this.nostr.createEvent(kinds.RelayList, '', tags);
    const signedEvent = await this.nostr.signEvent(relayListEvent);
    await this.accountRelay.publish(signedEvent);
    await this.discoveryRelay.publish(signedEvent);
  }
}
