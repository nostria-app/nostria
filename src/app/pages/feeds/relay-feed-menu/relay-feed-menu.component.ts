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
import { AccountLocalStateService } from '../../../services/account-local-state.service';

const DEFAULT_RELAYS: string[] = [
  'trending.relays.land',
  'nostrelites.org',
  'wot.nostr.net',
  'wotr.relatr.xyz',
  'primus.nostr1.com',
  'nostr.land',
  'nos.lol',
  'nostr.wine',
  'news.utxo.one',
  '140.f7z.io',
  'pyramid.fiatjaf.com',
  'relay.damus.io',
  'relay.primal.net',
  'nostr21.com',
];

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
      </div>

      <mat-divider></mat-divider>

      <div class="relay-list">
        @for (relay of savedRelays(); track relay) {
        <button
          mat-menu-item
          (click)="onSelectRelay(relay)"
          [class.active]="relay === selectedRelay()"
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
            @if (relay === selectedRelay()) {
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

      <mat-divider></mat-divider>

      <div class="add-relay-section" role="presentation">
        <mat-form-field appearance="outline" class="add-relay-field">
          <mat-label>Add relay</mat-label>
          <input
            matInput
            [(ngModel)]="newRelayInput"
            placeholder="relay.example.com"
            (keydown.enter)="onAddRelay()"
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

        mat-icon {
          color: var(--mat-sys-primary);
        }

        span {
          color: var(--mat-sys-on-surface);
        }
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
  private accountLocalState = inject(AccountLocalStateService);

  // Outputs
  relaySelected = output<string>();

  // State
  savedRelays = signal<string[]>([]);
  selectedRelay = signal<string>('');
  relayInfoCache = signal<Map<string, Nip11RelayInfo>>(new Map());
  newRelayInput = '';

  constructor() {
    // Load saved relays when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.loadSavedRelays(pubkey);
      }
    });

    // Fetch info for any relays missing from cache
    effect(() => {
      const relays = this.savedRelays();
      const cache = this.relayInfoCache();
      relays.forEach(relay => {
        if (!cache.has(relay)) {
          this.fetchRelayInfo(relay);
        }
      });
    });
  }

  private loadSavedRelays(pubkey: string): void {
    try {
      const stored = this.accountLocalState.getPublicRelayFeeds(pubkey);
      if (stored && stored.length > 0) {
        this.savedRelays.set(stored);
      } else {
        this.savedRelays.set([...DEFAULT_RELAYS]);
        this.saveSavedRelays();
      }
    } catch (error) {
      this.logger.error('Error loading saved relays:', error);
      this.savedRelays.set([...DEFAULT_RELAYS]);
    }
  }

  private saveSavedRelays(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      this.accountLocalState.setPublicRelayFeeds(pubkey, this.savedRelays());
    } catch (error) {
      this.logger.error('Error saving relays:', error);
    }
  }

  private async fetchRelayInfo(domain: string): Promise<void> {
    if (this.relayInfoCache().has(domain)) return;

    try {
      const url = domain.startsWith('wss://') ? domain : `wss://${domain}`;
      const info = await this.relaysService.fetchNip11Info(url);
      if (info) {
        this.relayInfoCache.update(cache => {
          const newCache = new Map(cache);
          newCache.set(domain, info);
          return newCache;
        });
      }
    } catch {
      this.logger.debug(`Failed to fetch info for ${domain}`);
    }
  }

  getRelayName(domain: string): string {
    const info = this.relayInfoCache().get(domain);
    return info?.name || domain;
  }

  getRelayIcon(domain: string): string | null {
    const info = this.relayInfoCache().get(domain);
    // Try icon first, then banner, then favicon
    if (info?.icon) return info.icon;
    if (info?.banner) return info.banner;
    return `https://${domain}/favicon.ico`;
  }

  onIconError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.style.display = 'none';
    }
  }

  onSelectRelay(domain: string): void {
    this.selectedRelay.set(domain);
    this.relaySelected.emit(domain);
  }

  onRemoveRelay(domain: string, event: Event): void {
    event.stopPropagation();
    this.savedRelays.update(relays => relays.filter(r => r !== domain));
    this.saveSavedRelays();

    // If removed relay was selected, clear selection
    if (this.selectedRelay() === domain) {
      this.selectedRelay.set('');
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
    // Refresh saved relays from storage in case they changed (e.g., relay added from column)
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const stored = this.accountLocalState.getPublicRelayFeeds(pubkey);
      if (stored && stored.length > 0) {
        this.savedRelays.set(stored);
      }
    }
    if (domain && !this.relayInfoCache().has(domain)) {
      this.fetchRelayInfo(domain);
    }
  }
}
