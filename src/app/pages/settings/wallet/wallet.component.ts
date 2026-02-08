import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SettingsService } from '../../../services/settings.service';
import { LoggerService } from '../../../services/logger.service';
import { PanelActionsService } from '../../../services/panel-actions.service';
import { RightPanelService } from '../../../services/right-panel.service';

interface ZapAmount {
  value: number;
  enabled: boolean;
  isCustom?: boolean;
}

@Component({
  selector: 'app-wallet-settings',
  imports: [
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    FormsModule,
  ],
  templateUrl: './wallet.component.html',
  styleUrls: ['./wallet.component.scss'],
  host: { class: 'panel-with-sticky-header' },
})
export class WalletSettingsComponent implements OnInit, OnDestroy {
  private settingsService = inject(SettingsService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private panelActions = inject(PanelActionsService);
  private rightPanel = inject(RightPanelService);
  private router = inject(Router);

  // Predefined default amounts for quick zap menu (legacy)
  private defaultAmounts = [21, 69, 100, 210, 420, 500, 1000, 2100, 5000, 10000, 21000, 42000, 100000];

  zapAmounts = signal<ZapAmount[]>([]);
  newCustomAmount = '';

  // Quick Zap Button settings
  quickZapEnabled = signal(false);
  quickZapAmount = signal(21);

  // Hide wallet amounts setting
  hideWalletAmounts = signal(false);

  constructor() {
    this.loadSettings();
  }

  ngOnInit(): void {
    // Only set breadcrumbs if not in right panel
    if (!this.rightPanel.hasContent()) {
      this.panelActions.setBreadcrumbs([
        { label: $localize`:@@settings.title:Settings`, action: () => this.router.navigate(['/settings']) },
        { label: $localize`:@@settings.wallet.title:Wallet` }
      ]);
    }
  }

  ngOnDestroy(): void {
    if (!this.rightPanel.hasContent()) {
      this.panelActions.clearBreadcrumbs();
    }
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

  private loadSettings(): void {
    const currentSettings = this.settingsService.settings();

    // Load quick zap button settings
    this.quickZapEnabled.set(currentSettings.quickZapEnabled ?? false);
    this.quickZapAmount.set(currentSettings.quickZapAmount ?? 21);

    // Load hide wallet amounts setting
    this.hideWalletAmounts.set(currentSettings.hideWalletAmounts ?? false);

    // Load zap amounts for legacy menu
    const enabledAmounts = currentSettings.zapQuickAmounts || [];

    // Create array combining all default amounts and custom amounts
    const allAmounts = new Set([...this.defaultAmounts, ...enabledAmounts]);

    const amounts: ZapAmount[] = Array.from(allAmounts)
      .sort((a, b) => a - b)
      .map(value => ({
        value,
        enabled: enabledAmounts.includes(value),
        isCustom: !this.defaultAmounts.includes(value),
      }));

    this.zapAmounts.set(amounts);
  }

  async toggleQuickZap(): Promise<void> {
    const newValue = !this.quickZapEnabled();
    this.quickZapEnabled.set(newValue);

    try {
      await this.settingsService.updateSettings({
        quickZapEnabled: newValue,
      });
      this.snackBar.open(
        newValue ? 'Quick Zap enabled' : 'Quick Zap disabled',
        'Dismiss',
        { duration: 2000 }
      );
    } catch (error) {
      this.logger.error('Failed to save quick zap setting:', error);
      this.quickZapEnabled.set(!newValue); // Revert
      this.snackBar.open('Failed to save settings', 'Dismiss', { duration: 3000 });
    }
  }

  async updateQuickZapAmount(): Promise<void> {
    const amount = this.quickZapAmount();
    if (amount <= 0) {
      this.snackBar.open('Please enter a valid positive number', 'Dismiss', { duration: 3000 });
      return;
    }

    try {
      await this.settingsService.updateSettings({
        quickZapAmount: amount,
      });
      this.snackBar.open(`Quick zap amount set to ${this.formatAmount(amount)} sats`, 'Dismiss', {
        duration: 2000,
      });
    } catch (error) {
      this.logger.error('Failed to save quick zap amount:', error);
      this.snackBar.open('Failed to save settings', 'Dismiss', { duration: 3000 });
    }
  }

  async toggleHideWalletAmounts(): Promise<void> {
    const newValue = !this.hideWalletAmounts();
    this.hideWalletAmounts.set(newValue);

    try {
      await this.settingsService.updateSettings({
        hideWalletAmounts: newValue,
      });
      this.snackBar.open(
        newValue ? 'Wallet amounts hidden' : 'Wallet amounts visible',
        'Dismiss',
        { duration: 2000 }
      );
    } catch (error) {
      this.logger.error('Failed to save hide wallet amounts setting:', error);
      this.hideWalletAmounts.set(!newValue); // Revert
      this.snackBar.open('Failed to save settings', 'Dismiss', { duration: 3000 });
    }
  }

  async toggleAmount(amount: ZapAmount): Promise<void> {
    // Update the local state
    amount.enabled = !amount.enabled;

    // Save to settings
    await this.saveZapAmounts();
  }

  async addCustomAmount(): Promise<void> {
    const value = parseInt(this.newCustomAmount, 10);

    if (isNaN(value) || value <= 0) {
      this.snackBar.open('Please enter a valid positive number', 'Dismiss', {
        duration: 3000,
      });
      return;
    }

    const currentAmounts = this.zapAmounts();

    // Check if amount already exists
    if (currentAmounts.some(a => a.value === value)) {
      this.snackBar.open('This amount already exists', 'Dismiss', {
        duration: 3000,
      });
      return;
    }

    // Add the new custom amount
    const updatedAmounts = [...currentAmounts, {
      value,
      enabled: true,
      isCustom: true,
    }].sort((a, b) => a.value - b.value);

    this.zapAmounts.set(updatedAmounts);
    this.newCustomAmount = '';

    await this.saveZapAmounts();

    this.snackBar.open('Custom amount added', 'Dismiss', {
      duration: 2000,
    });
  }

  async removeCustomAmount(amount: ZapAmount): Promise<void> {
    if (!amount.isCustom) {
      return;
    }

    const updatedAmounts = this.zapAmounts().filter(a => a.value !== amount.value);
    this.zapAmounts.set(updatedAmounts);

    await this.saveZapAmounts();

    this.snackBar.open('Custom amount removed', 'Dismiss', {
      duration: 2000,
    });
  }

  private async saveZapAmounts(): Promise<void> {
    const enabledAmounts = this.zapAmounts()
      .filter(a => a.enabled)
      .map(a => a.value);

    try {
      await this.settingsService.updateSettings({
        zapQuickAmounts: enabledAmounts,
      });
    } catch (error) {
      this.logger.error('Failed to save zap amounts:', error);
      this.snackBar.open('Failed to save settings', 'Dismiss', {
        duration: 3000,
      });
    }
  }

  formatAmount(value: number): string {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
  }
}
