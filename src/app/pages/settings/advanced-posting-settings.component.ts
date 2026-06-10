import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { RightPanelService } from '../../services/right-panel.service';
import { SettingPostToXComponent } from './sections/post-to-x.component';

@Component({
  selector: 'app-advanced-posting-settings',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
    SettingPostToXComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
  templateUrl: './advanced-posting-settings.component.html',
  styleUrl: './advanced-posting-settings.component.scss',
})
export class AdvancedPostingSettingsComponent {
  readonly accountState = inject(AccountStateService);
  readonly accountLocalState = inject(AccountLocalStateService);
  private readonly rightPanel = inject(RightPanelService);

  globalEventExpiration = signal<number | null>(this.getInitialGlobalExpiration());

  goBack(): void {
    this.rightPanel.goBack();
  }

  // Global event expiration methods
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
