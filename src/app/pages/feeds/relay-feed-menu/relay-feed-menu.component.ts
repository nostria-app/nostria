import {
  Component,
  inject,
  signal,
  output,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { LoggerService } from '../../../services/logger.service';
import { RelaysService, Nip11RelayInfo } from '../../../services/relays/relays';
import { AccountStateService } from '../../../services/account-state.service';
import { RelayFeedsService, RelaySet } from '../../../services/relay-feeds.service';

export interface RelayInfo {
  domain: string;
  name?: string;
  icon?: string;
}

@Component({
  selector: 'app-relay-feed-menu',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
  ],
  template: `
    <button
      mat-icon-button
      [matMenuTriggerFor]="relayMenu"
      matTooltip="Public relay feeds"
      class="relay-menu-trigger"
    >
      <mat-icon>dns</mat-icon>
    </button>

    <mat-menu #relayMenu="matMenu" class="relay-feed-menu">
      <div class="menu-header" role="presentation">
        <mat-icon>dns</mat-icon>
        <span>Public Relay Feeds</span>
        <button mat-icon-button (click)="onResetRelays(); $event.stopPropagation()" matTooltip="Reset to defaults" class="reset-btn">
          <mat-icon>restore</mat-icon>
        </button>
      </div>

      <mat-divider></mat-divider>

      <div class="relay-list">
        @for (relay of savedRelays(); track relay) {
        <button
          mat-menu-item
          (click)="onSelectRelay(relay)"
          [class.active]="relay === selectedRelay() && !selectedSet()"
        >
          <div class="relay-item">
            @if (getRelayIcon(relay); as icon) {
            <img [src]="icon" alt="" class="relay-item-icon" (error)="onIconError($event)" />
            } @else {
            <mat-icon class="relay-item-icon-fallback">dns</mat-icon>
            }
            <div class="relay-item-info">
              <span class="relay-item-name">{{ getRelayName(relay) }}</span>
              <span class="relay-item-url">{{ relay }}</span>
            </div>
            @if (relay === selectedRelay() && !selectedSet()) {
            <mat-icon class="active-check">check</mat-icon>
            }
            <button
              mat-icon-button
              class="remove-btn"
              (click)="onRemoveRelay(relay, $event)"
              matTooltip="Remove"
            >
              <mat-icon>close</mat-icon>
            </button>
          </div>
        </button>
        }
      </div>

      @if (relaySets().length > 0) {
        <mat-divider></mat-divider>
        <div class="menu-section-label" role="presentation">Relay Sets</div>
        <div class="relay-list">
          @for (set of relaySets(); track set.identifier) {
          <button
            mat-menu-item
            (click)="onSelectRelaySet(set)"
            [class.active]="set.identifier === selectedSet()"
          >
            <div class="relay-item">
              <mat-icon class="relay-item-icon-fallback">folder</mat-icon>
              <div class="relay-item-info">
                <span class="relay-item-name">{{ set.name }}</span>
                <span class="relay-item-url">{{ set.relays.length }} relays</span>
              </div>
              @if (set.identifier === selectedSet()) {
              <mat-icon class="active-check">check</mat-icon>
              }
            </div>
          </button>
          }
        </div>
      }

      <mat-divider></mat-divider>

      <div class="add-relay-section" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
        <mat-form-field appearance="outline" class="add-relay-field">
          <mat-label>Add relay</mat-label>
          <input
            matInput
            [(ngModel)]="newRelayInput"
            placeholder="relay.example.com"
            (keydown.enter)="onAddRelay(); $event.stopPropagation()"
          />
        </mat-form-field>
        <button mat-icon-button (click)="onAddRelay()" [disabled]="!newRelayInput">
          <mat-icon>add</mat-icon>
        </button>
      </div>
    </mat-menu>
  `,
  styles: [
    `
      .relay-menu-trigger {
        margin-left: 8px;
      }

      ::ng-deep .relay-feed-menu {
        min-width: 320px;
        max-height: 500px;
      }

      .menu-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        cursor: default;

        mat-icon:first-child {
          color: var(--mat-sys-primary);
        }

        span {
          color: var(--mat-sys-on-surface);
          flex: 1;
        }

        .reset-btn {
          width: 32px;
          height: 32px;
          margin: -8px -8px -8px 0;

          mat-icon {
            color: var(--mat-sys-on-surface-variant);
            font-size: 20px;
            width: 20px;
            height: 20px;
          }
        }
      }

      .menu-section-label {
        padding: 8px 16px;
        font-size: 12px;
        font-weight: 500;
        color: var(--mat-sys-on-surface-variant);
        cursor: default;
      }

      .relay-list {
        max-height: 300px;
        overflow-y: auto;
      }

      .relay-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
      }

      .relay-item-icon {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        object-fit: cover;
        flex-shrink: 0;
      }

      .relay-item-icon-fallback {
        width: 24px;
        height: 24px;
        color: var(--mat-sys-on-surface-variant);
        flex-shrink: 0;
      }

      .relay-item-info {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
      }

      .relay-item-name {
        font-size: 14px;
        color: var(--mat-sys-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .relay-item-url {
        font-size: 11px;
        color: var(--mat-sys-on-surface-variant);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .active-check {
        color: var(--mat-sys-primary);
        flex-shrink: 0;
      }

      .remove-btn {
        opacity: 0;
        transition: opacity 0.2s;
        flex-shrink: 0;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      button.mat-mdc-menu-item:hover .remove-btn {
        opacity: 1;
      }

      button.active {
        background-color: var(--mat-sys-surface-container-high);
      }

      .add-relay-section {
        display: flex;
        align-items: center;
        padding: 8px 16px;
        gap: 8px;
      }

      .add-relay-field {
        flex: 1;

        ::ng-deep .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelayFeedMenuComponent {
  private logger = inject(LoggerService);
  private relaysService = inject(RelaysService);
  private accountState = inject(AccountStateService);
  private relayFeedsService = inject(RelayFeedsService);

  // Outputs
  relaySelected = output<string>();

  // State
  savedRelays = signal<string[]>([]);
  relaySets = signal<RelaySet[]>([]);
  selectedRelay = signal<string>('');
  selectedSet = signal<string>('');
  // Using a plain Map instead of a signal to prevent cache updates from
  // triggering change detection and stealing focus from the input field
  private relayInfoCache = new Map<string, Nip11RelayInfo>();
  private lastLoadedPubkey = '';
  private initialRelaysFetched = false;
  newRelayInput = '';

  constructor() {
    // Load saved relays when account changes - only if pubkey actually changed
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey && pubkey !== this.lastLoadedPubkey) {
        this.lastLoadedPubkey = pubkey;
        this.loadSavedRelays(pubkey);
        this.loadRelaySets(pubkey);
      }
    });

    // Fetch info for relays only once on initialization
    effect(() => {
      const relays = this.savedRelays();
      if (!this.initialRelaysFetched && relays.length > 0) {
        this.initialRelaysFetched = true;
        relays.forEach(relay => {
          if (!this.relayInfoCache.has(relay)) {
            this.fetchRelayInfo(relay);
          }
        });
      }
    });
  }

  private async loadSavedRelays(pubkey: string): Promise<void> {
    try {
      // Load from kind 10012 event via RelayFeedsService
      const relays = await this.relayFeedsService.getRelayFeeds(pubkey);
      this.savedRelays.set(relays);
    } catch (error) {
      this.logger.error('Error loading saved relays:', error);
      // Fallback to defaults via service
      const defaults = this.relayFeedsService.getDefaultRelays();
      this.savedRelays.set(defaults);
    }
  }

  private async loadRelaySets(pubkey: string): Promise<void> {
    try {
      const sets = await this.relayFeedsService.getRelaySets(pubkey);
      this.relaySets.set(sets);
    } catch (error) {
      this.logger.error('Error loading relay sets:', error);
      this.relaySets.set([]);
    }
  }

  private async saveSavedRelays(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      // Save to kind 10012 event via RelayFeedsService
      await this.relayFeedsService.saveRelayFeeds(this.savedRelays());
    } catch (error) {
      this.logger.error('Error saving relays:', error);
    }
  }

  private async fetchRelayInfo(domain: string): Promise<void> {
    if (this.relayInfoCache.has(domain)) return;

    try {
      const url = domain.startsWith('wss://') ? domain : `wss://${domain}`;
      const info = await this.relaysService.fetchNip11Info(url);
      if (info) {
        this.relayInfoCache.set(domain, info);
      }
    } catch {
      this.logger.debug(`Failed to fetch info for ${domain}`);
    }
  }

  getRelayName(domain: string): string {
    const info = this.relayInfoCache.get(domain);
    return info?.name || domain;
  }

  getRelayIcon(domain: string): string | null {
    const info = this.relayInfoCache.get(domain);
    // If we have info, try icon first, then banner
    if (info?.icon) return info.icon;
    if (info?.banner) return info.banner;
    // Only return favicon if we have info (meaning we fetched it but it has no icon/banner)
    // If no info, return null to show the fallback icon while we fetch
    if (info) {
      return `https://${domain}/favicon.ico`;
    }
    return null;
  }

  onIconError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.style.display = 'none';
    }
  }

  onSelectRelay(domain: string): void {
    this.selectedRelay.set(domain);
    this.selectedSet.set('');
    this.relaySelected.emit(domain);
  }

  onSelectRelaySet(set: RelaySet): void {
    this.selectedRelay.set('');
    this.selectedSet.set(set.identifier);
    // Emit all relay URLs from the set joined with commas
    const relayUrls = set.relays.join(',');
    this.relaySelected.emit(relayUrls);
  }

  onRemoveRelay(domain: string, event: Event): void {
    event.stopPropagation();
    this.savedRelays.update(relays => relays.filter(r => r !== domain));
    this.saveSavedRelays();

    // If removed relay was selected, clear selection
    if (this.selectedRelay() === domain) {
      this.selectedRelay.set('');
      this.selectedSet.set('');
      this.relaySelected.emit('');
    }
  }

  onAddRelay(): void {
    if (!this.newRelayInput) return;

    const domain = this.newRelayInput.replace(/^wss?:\/\//, '').replace(/\/$/, '');

    if (!this.savedRelays().includes(domain)) {
      this.savedRelays.update(relays => [...relays, domain]);
      this.saveSavedRelays();
      this.fetchRelayInfo(domain);
    }

    this.newRelayInput = '';
  }

  setSelectedRelay(domain: string): void {
    this.selectedRelay.set(domain);
    this.selectedSet.set('');
    // Refresh saved relays from storage in case they changed (e.g., relay added from column)
    // Only update if the arrays kind 10012 event in case they changed
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.loadSavedRelays(pubkey);
    }
    if (domain && !this.relayInfoCache.has(domain)) {
      this.fetchRelayInfo(domain);
    }
  }

  async onResetRelays(): Promise<void> {
    const defaults = this.relayFeedsService.getDefaultRelays();
    this.savedRelays.set(defaults);
    await this.saveSavedRelays();

    // Clear selection if it's not in the default list
    if (this.selectedRelay() && !defaults.includes(this.selectedRelay())) {
      this.relaySelected.emit('');
    }
  }
}
