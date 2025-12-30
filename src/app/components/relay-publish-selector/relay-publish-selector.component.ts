import { Component, inject, signal, output, computed, OnInit, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountRelayService } from '../../services/relays/account-relay';
import { DatabaseService } from '../../services/database.service';
import { AccountStateService } from '../../services/account-state.service';

const RELAY_SET_KIND = 30002;
const MUSIC_RELAY_SET_D_TAG = 'music';

export interface RelayPublishConfig {
  accountRelays: string[];
  musicRelays: string[];
  customRelays: string[];
  includeMusicRelays: boolean;
}

@Component({
  selector: 'app-relay-publish-selector',
  imports: [
    FormsModule,
    MatChipsModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <mat-expansion-panel class="relay-selector-panel">
      <mat-expansion-panel-header>
        <mat-panel-title>
          <mat-icon>wifi</mat-icon>
          Publish to Relays
        </mat-panel-title>
        <mat-panel-description>
          {{ selectedRelaysCount() }} relay{{ selectedRelaysCount() === 1 ? '' : 's' }} selected
        </mat-panel-description>
      </mat-expansion-panel-header>

      <div class="relay-selector-content">
        <!-- Account Relays Section -->
        <div class="relay-section">
          <div class="section-header">
            <span class="section-title">Your Account Relays</span>
            <span class="relay-count">{{ accountRelays().length }}</span>
          </div>
          <div class="relay-chips">
            @for (relay of accountRelays(); track relay) {
              <div class="relay-chip account-relay">
                <mat-icon>check_circle</mat-icon>
                <span class="relay-url">{{ formatRelayUrl(relay) }}</span>
              </div>
            }
            @if (accountRelays().length === 0) {
              <span class="no-relays">No account relays configured</span>
            }
          </div>
        </div>

        <!-- Music Relays Section -->
        @if (musicRelays().length > 0) {
          <div class="relay-section">
            <div class="section-header">
              <mat-checkbox
                [checked]="includeMusicRelays()"
                (change)="includeMusicRelays.set($event.checked); emitChange()">
                Include Music Relays
              </mat-checkbox>
              <span class="relay-count">{{ musicRelays().length }}</span>
            </div>
            @if (includeMusicRelays()) {
              <div class="relay-chips">
                @for (relay of musicRelays(); track relay) {
                  <div class="relay-chip music-relay">
                    <mat-icon>music_note</mat-icon>
                    <span class="relay-url">{{ formatRelayUrl(relay) }}</span>
                  </div>
                }
              </div>
            }
          </div>
        } @else {
          <div class="relay-section music-hint">
            <mat-icon>info</mat-icon>
            <span>Configure music relays in Music Settings for wider distribution</span>
          </div>
        }

        <!-- Custom Relays Section -->
        <div class="relay-section">
          <div class="section-header">
            <span class="section-title">Custom Relays</span>
            @if (customRelays().length > 0) {
              <span class="relay-count">{{ customRelays().length }}</span>
            }
          </div>
          <div class="custom-relay-input">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Add custom relay</mat-label>
              <input
                matInput
                [(ngModel)]="newRelayUrl"
                placeholder="wss://relay.example.com"
                (keydown.enter)="addCustomRelay()" />
              <button mat-icon-button matSuffix (click)="addCustomRelay()" [disabled]="!newRelayUrl">
                <mat-icon>add</mat-icon>
              </button>
            </mat-form-field>
          </div>
          @if (customRelays().length > 0) {
            <div class="relay-chips">
              @for (relay of customRelays(); track relay) {
                <div class="relay-chip custom-relay">
                  <span class="relay-url">{{ formatRelayUrl(relay) }}</span>
                  <button mat-icon-button class="remove-btn" (click)="removeCustomRelay(relay)">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              }
            </div>
          }
        </div>

        <!-- Summary -->
        <div class="relay-summary">
          <mat-icon>summarize</mat-icon>
          <span>Will publish to <strong>{{ selectedRelaysCount() }}</strong> unique relay{{ selectedRelaysCount() === 1 ? '' : 's' }}</span>
        </div>
      </div>
    </mat-expansion-panel>
  `,
  styles: `
    .relay-selector-panel {
      margin-bottom: 16px;

      mat-panel-title {
        display: flex;
        align-items: center;
        gap: 8px;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }
    }

    .relay-selector-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-top: 8px;
    }

    .relay-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .relay-section.music-hint {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      padding: 12px;
      background: var(--mat-sys-surface-container);
      border-radius: 8px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-title {
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .relay-count {
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
    }

    .relay-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .relay-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 0.875rem;
      background: var(--mat-sys-surface-container);

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      .relay-url {
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &.account-relay {
        background: var(--mat-sys-primary-container);
        color: var(--mat-sys-on-primary-container);
      }

      &.music-relay {
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
      }

      &.custom-relay {
        background: var(--mat-sys-tertiary-container);
        color: var(--mat-sys-on-tertiary-container);
        padding-right: 4px;
      }

      .remove-btn {
        width: 24px;
        height: 24px;
        line-height: 24px;

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }
      }
    }

    .no-relays {
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }

    .custom-relay-input {
      mat-form-field {
        width: 100%;
      }
    }

    .full-width {
      width: 100%;
    }

    .relay-summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      background: var(--mat-sys-surface-container-high);
      border-radius: 8px;
      font-size: 0.875rem;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--mat-sys-primary);
      }
    }
  `,
})
export class RelayPublishSelectorComponent implements OnInit {
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private accountState = inject(AccountStateService);

  // Output the selected relays configuration
  relaysChanged = output<RelayPublishConfig>();

  // State
  accountRelays = signal<string[]>([]);
  musicRelays = signal<string[]>([]);
  customRelays = signal<string[]>([]);
  includeMusicRelays = signal(true);
  isLoading = signal(false);

  newRelayUrl = '';

  // Computed: all selected relays (unique)
  selectedRelays = computed(() => {
    const relays = new Set<string>();

    // Always include account relays
    for (const relay of this.accountRelays()) {
      relays.add(relay);
    }

    // Include music relays if enabled
    if (this.includeMusicRelays()) {
      for (const relay of this.musicRelays()) {
        relays.add(relay);
      }
    }

    // Include custom relays
    for (const relay of this.customRelays()) {
      relays.add(relay);
    }

    return Array.from(relays);
  });

  selectedRelaysCount = computed(() => this.selectedRelays().length);

  constructor() {
    // Emit initial state when relays are loaded
    effect(() => {
      // Access signals to trigger on change
      this.accountRelays();
      this.musicRelays();
      this.customRelays();
      this.includeMusicRelays();
      // Don't emit during loading
      if (!this.isLoading()) {
        this.emitChange();
      }
    });
  }

  ngOnInit(): void {
    this.loadRelays();
  }

  private async loadRelays(): Promise<void> {
    this.isLoading.set(true);

    // Load account relays
    const accountRelayUrls = this.accountRelay.getRelayUrls();
    this.accountRelays.set(accountRelayUrls);

    // Load music relays from database
    await this.loadMusicRelays();

    this.isLoading.set(false);
    this.emitChange();
  }

  private async loadMusicRelays(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        pubkey,
        RELAY_SET_KIND,
        MUSIC_RELAY_SET_D_TAG
      );

      if (cachedEvent) {
        const relays = cachedEvent.tags
          .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
          .map((tag: string[]) => tag[1]);
        this.musicRelays.set(relays);
      }
    } catch (error) {
      console.error('Error loading music relays:', error);
    }
  }

  formatRelayUrl(url: string): string {
    // Remove wss:// or ws:// prefix and trailing slash for display
    return url
      .replace(/^wss?:\/\//, '')
      .replace(/\/$/, '');
  }

  addCustomRelay(): void {
    let url = this.newRelayUrl.trim();
    if (!url) return;

    // Add wss:// if missing
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      url = 'wss://' + url;
    }

    // Ensure trailing slash
    if (!url.endsWith('/')) {
      url = url + '/';
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return;
    }

    // Check if already exists
    if (this.customRelays().includes(url) ||
      this.accountRelays().includes(url) ||
      this.musicRelays().includes(url)) {
      this.newRelayUrl = '';
      return;
    }

    this.customRelays.update(relays => [...relays, url]);
    this.newRelayUrl = '';
    this.emitChange();
  }

  removeCustomRelay(relay: string): void {
    this.customRelays.update(relays => relays.filter(r => r !== relay));
    this.emitChange();
  }

  emitChange(): void {
    this.relaysChanged.emit({
      accountRelays: this.accountRelays(),
      musicRelays: this.musicRelays(),
      customRelays: this.customRelays(),
      includeMusicRelays: this.includeMusicRelays(),
    });
  }

  // Get all selected relay URLs for publishing
  getSelectedRelayUrls(): string[] {
    return this.selectedRelays();
  }
}
