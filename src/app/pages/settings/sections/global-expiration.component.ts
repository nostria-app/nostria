import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';

@Component({
  selector: 'app-setting-global-expiration',
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (accountState.account()) {
    <div class="setting-section">
      <h2 i18n="@@settings.event-expiration.title">Global Event Expiration</h2>

      <div class="setting-item">
        <span i18n="@@settings.event-expiration.toggle">Enable Global Expiration</span>
        <mat-slide-toggle [checked]="globalEventExpiration() !== null" (change)="toggleGlobalEventExpiration()">
        </mat-slide-toggle>
      </div>
      <p class="setting-description" i18n="@@settings.event-expiration.description">
        When enabled, all events you create will include an expiration tag (NIP-40).
        Relays may delete expired events and clients should ignore them.
        This is useful for testing or when you don't want content to persist.
      </p>

      @if (globalEventExpiration() !== null) {
      <mat-form-field appearance="outline" class="full-width">
        <mat-label i18n="@@settings.event-expiration.duration">Expiration Duration</mat-label>
        <mat-select [ngModel]="globalEventExpiration()" (selectionChange)="setGlobalEventExpiration($event.value)">
          <mat-option [value]="1" i18n="@@settings.event-expiration.1hour">1 hour</mat-option>
          <mat-option [value]="6" i18n="@@settings.event-expiration.6hours">6 hours</mat-option>
          <mat-option [value]="12" i18n="@@settings.event-expiration.12hours">12 hours</mat-option>
          <mat-option [value]="24" i18n="@@settings.event-expiration.24hours">24 hours</mat-option>
          <mat-option [value]="48" i18n="@@settings.event-expiration.48hours">48 hours</mat-option>
          <mat-option [value]="72" i18n="@@settings.event-expiration.72hours">72 hours</mat-option>
          <mat-option [value]="168" i18n="@@settings.event-expiration.1week">1 week</mat-option>
          <mat-option [value]="720" i18n="@@settings.event-expiration.30days">30 days</mat-option>
        </mat-select>
      </mat-form-field>
      <p class="setting-warning" i18n="@@settings.event-expiration.warning">
        ⚠️ Warning: Expiration is not guaranteed. Events may be stored by third parties before expiring.
        Do not use this as a security feature for sensitive content.
      </p>
      }
    </div>
    }
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }

    .setting-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding: 12px 0;
    }

    .setting-description {
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 16px 0;
    }

    .setting-warning {
      font-size: 0.875rem;
      color: var(--mat-sys-error);
      margin: 0;
    }

    .full-width {
      width: 100%;
    }
  `],
})
export class SettingGlobalExpirationComponent {
  readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);

  globalEventExpiration = signal<number | null>(this.getInitialGlobalExpiration());

  private getInitialGlobalExpiration(): number | null {
    const pubkey = this.accountState.account()?.pubkey;
    if (!pubkey) return null;
    return this.accountLocalState.getGlobalEventExpiration(pubkey);
  }

  toggleGlobalEventExpiration(): void {
    const pubkey = this.accountState.account()?.pubkey;
    if (!pubkey) return;

    const currentValue = this.globalEventExpiration();
    if (currentValue === null) {
      this.globalEventExpiration.set(24);
      this.accountLocalState.setGlobalEventExpiration(pubkey, 24);
    } else {
      this.globalEventExpiration.set(null);
      this.accountLocalState.setGlobalEventExpiration(pubkey, null);
    }
  }

  setGlobalEventExpiration(hours: number | null): void {
    const pubkey = this.accountState.account()?.pubkey;
    if (!pubkey) return;

    this.globalEventExpiration.set(hours);
    this.accountLocalState.setGlobalEventExpiration(pubkey, hours);
  }
}
