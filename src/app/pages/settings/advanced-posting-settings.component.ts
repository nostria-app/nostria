import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { DatePipe, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { SettingsService } from '../../services/settings.service';
import { RightPanelService } from '../../services/right-panel.service';
import { XDualPostService } from '../../services/x-dual-post.service';

@Component({
  selector: 'app-advanced-posting-settings',
  imports: [
    DatePipe,
    NgOptimizedImage,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
  templateUrl: './advanced-posting-settings.component.html',
  styleUrl: './advanced-posting-settings.component.scss',
})
export class AdvancedPostingSettingsComponent implements OnInit {
  readonly accountState = inject(AccountStateService);
  readonly accountLocalState = inject(AccountLocalStateService);
  readonly settings = inject(SettingsService);
  readonly xDualPost = inject(XDualPostService);
  private readonly rightPanel = inject(RightPanelService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  xPremiumEligible = computed(() => {
    const subscription = this.accountState.subscription();
    const hasXPostingEntitlement = subscription?.entitlements?.features?.some(feature => feature.key === 'DUAL_POST_X_10') ?? false;
    const isNotExpired = !subscription?.expires || Date.now() < subscription.expires;
    return !!subscription && hasXPostingEntitlement && isNotExpired;
  });

  xProfileUrl = computed(() => {
    const username = this.xDualPost.status().username;
    return username ? `https://x.com/${username}` : null;
  });

  globalEventExpiration = signal<number | null>(this.getInitialGlobalExpiration());

  ngOnInit(): void {
    void this.xDualPost.refreshStatus();
    this.handleXAuthReturn();
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

  openPremiumTab(): void {
    void this.router.navigate(['/accounts'], { queryParams: { tab: 'premium' } });
  }

  togglePostToXByDefault(): void {
    const currentValue = this.settings.settings()?.postToXByDefault ?? false;
    this.settings.updateSettings({ postToXByDefault: !currentValue });
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

  async connectX(): Promise<void> {
    if (!this.xPremiumEligible()) {
      this.snackBar.open('Post to X is available for Premium+ accounts only.', 'Close', {
        duration: 5000,
      });
      return;
    }

    try {
      await this.xDualPost.connect();
    } catch (error) {
      this.snackBar.open(`Failed to connect X: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000,
      });
    }
  }

  async disconnectX(): Promise<void> {
    try {
      await this.xDualPost.disconnect();
      this.snackBar.open('Disconnected X account', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.snackBar.open(`Failed to disconnect X: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000,
      });
    }
  }

  async reconnectX(): Promise<void> {
    if (!this.xPremiumEligible()) {
      this.snackBar.open('Post to X is available for Premium+ accounts only.', 'Close', {
        duration: 5000,
      });
      return;
    }

    try {
      await this.xDualPost.reconnect();
    } catch (error) {
      this.snackBar.open(`Failed to reconnect X: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000,
      });
    }
  }

  getXUsageRemaining(): string {
    const status = this.xDualPost.status();

    if (status.limit24h === undefined || status.remaining24h === undefined) {
      return 'No daily cap configured';
    }

    return `${status.remaining24h} remaining of ${status.limit24h}`;
  }

  private handleXAuthReturn(): void {
    const status = this.route.snapshot.queryParamMap.get('xAuth');
    const message = this.route.snapshot.queryParamMap.get('xMessage');

    if (!status) {
      return;
    }

    if (status === 'success') {
      this.snackBar.open('X account connected', 'Close', {
        duration: 3000,
      });
    } else if (status === 'cancelled') {
      this.snackBar.open('X authorization was cancelled', 'Close', {
        duration: 3000,
      });
    } else {
      this.snackBar.open(message || 'X authorization failed', 'Close', {
        duration: 5000,
      });
    }

    void this.xDualPost.refreshStatus();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        xAuth: null,
        xMessage: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
