import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { InAppPurchaseService } from '../../../services/in-app-purchase.service';
import { AppContext, PlatformService } from '../../../services/platform.service';
import { RightPanelService } from '../../../services/right-panel.service';

@Component({
  selector: 'app-debug-settings',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSnackBarModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './debug.component.html',
  styleUrl: './debug.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
})
export class DebugSettingsComponent {
  readonly platform = inject(PlatformService);
  readonly iap = inject(InAppPurchaseService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly rightPanel = inject(RightPanelService);
  readonly purchasingDonation = signal(false);

  readonly activeStorePlatform = computed<'play-store' | 'app-store' | null>(() => {
    const paymentPlatform = this.platform.paymentPlatform();
    if (paymentPlatform === 'play-store' || paymentPlatform === 'app-store') {
      return paymentPlatform;
    }
    return null;
  });

  readonly isActiveStoreAvailable = computed(() => {
    const store = this.activeStorePlatform();
    if (store === 'play-store') {
      return this.iap.playStoreAvailable();
    }
    if (store === 'app-store') {
      return this.iap.appStoreAvailable();
    }
    return false;
  });

  readonly platformOptions: { value: AppContext | null; label: string; description: string }[] = [
    { value: null, label: 'Auto-detect', description: 'Use real platform detection' },
    { value: 'web', label: 'Web Browser', description: 'Standard browser — Bitcoin Lightning payments' },
    { value: 'pwa', label: 'PWA (Installed)', description: 'Installed web app — Bitcoin Lightning payments' },
    { value: 'native-android', label: 'Native Android', description: 'Android TWA — Google Play Store payments' },
    { value: 'native-ios', label: 'Native iOS', description: 'iOS native app — Apple App Store / StoreKit payments' },
  ];

  goBack(): void {
    this.rightPanel.goBack();
  }

  setSimulatedPlatform(value: AppContext | null): void {
    this.platform.simulatedAppContext.set(value);
  }

  setEnableNativeStorePaymentsForDebug(enabled: boolean): void {
    this.platform.enableNativeStorePaymentsForDebug.set(enabled);
  }

  async purchaseDonationProduct(): Promise<void> {
    const store = this.activeStorePlatform();
    if (!store) {
      this.snackBar.open('Select simulated Android/iOS and enable store payments first.', 'Close', {
        duration: 5000,
      });
      return;
    }

    if (!this.isActiveStoreAvailable()) {
      this.snackBar.open('Selected store billing is not available in this environment.', 'Close', {
        duration: 5000,
      });
      return;
    }

    this.purchasingDonation.set(true);
    try {
      const productId = this.iap.getDonationProductId();
      const result = store === 'play-store'
        ? await this.iap.purchaseWithPlayStore(productId)
        : await this.iap.purchaseWithAppStore(productId);

      if (result.success) {
        this.snackBar.open('Donation product purchase completed.', 'Close', {
          duration: 5000,
        });
        return;
      }

      if (result.error && result.error !== 'Purchase cancelled by user') {
        this.snackBar.open(`Donation purchase failed: ${result.error}`, 'Close', {
          duration: 7000,
        });
      }
    } finally {
      this.purchasingDonation.set(false);
    }
  }
}
