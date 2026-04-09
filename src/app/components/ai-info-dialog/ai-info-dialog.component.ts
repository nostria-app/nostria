import { isPlatformBrowser } from '@angular/common';
import { Component, inject, ChangeDetectionStrategy, PLATFORM_ID, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';
import { CustomDialogComponent } from '../custom-dialog/custom-dialog.component';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { buildAiDeviceGuidance, type AiDeviceGuidance, type AiDeviceSnapshot } from '../../utils/ai-device-guidance';
import { getRuntimeResourceProfile } from '../../utils/runtime-resource-profile';

interface NavigatorConnectionLike {
  effectiveType?: string;
  saveData?: boolean;
}

interface NavigatorLike {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  gpu?: unknown;
  storage?: {
    estimate?: () => Promise<{ quota?: number; usage?: number }>;
  };
  connection?: NavigatorConnectionLike | null;
  mozConnection?: NavigatorConnectionLike | null;
  webkitConnection?: NavigatorConnectionLike | null;
}

export interface AiInfoDialogData {
  firstRun?: boolean;
  showSettingsAction?: boolean;
}

export type AiInfoDialogResult = boolean | 'settings';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-ai-info-dialog',
  imports: [CustomDialogComponent, MatButtonModule, MatCheckboxModule, MatIconModule, FormsModule],
  templateUrl: './ai-info-dialog.component.html',
  styleUrl: './ai-info-dialog.component.scss',
})
export class AiInfoDialogComponent {
  readonly dialogRef = inject(CustomDialogRef<AiInfoDialogComponent, AiInfoDialogResult>);
  private readonly settingsService = inject(SettingsService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  data?: AiInfoDialogData;

  disableAi = false;
  readonly deviceSnapshot = signal<AiDeviceSnapshot>(this.createSnapshot());
  readonly guidance = signal<AiDeviceGuidance>(buildAiDeviceGuidance(this.deviceSnapshot()));

  constructor() {
    this.disableAi = !this.settingsService.settings().aiEnabled;

    if (this.isBrowser) {
      void this.loadStorageEstimate();
    }
  }

  get dialogTitle(): string {
    return this.data?.firstRun ? 'AI on this device' : 'Local AI Models';
  }

  get primaryActionLabel(): string {
    return this.data?.firstRun ? 'Continue' : 'Close';
  }

  get showSettingsAction(): boolean {
    return this.data?.showSettingsAction === true;
  }

  cancel(): void {
    this.close();
  }

  close(): void {
    if (this.disableAi) {
      this.settingsService.updateSettings({ aiEnabled: false });
      this.dialogRef.close(false);
    } else {
      this.settingsService.updateSettings({ aiEnabled: true });
      this.dialogRef.close(true);
    }
  }

  openSettings(): void {
    if (this.disableAi) {
      this.settingsService.updateSettings({ aiEnabled: false });
    }

    this.dialogRef.close('settings');
  }

  formatMemoryLabel(): string {
    const memory = this.deviceSnapshot().deviceMemoryGb;
    return memory === null ? 'Not exposed by browser' : `About ${memory} GB`;
  }

  formatCpuLabel(): string {
    const threads = this.deviceSnapshot().hardwareConcurrency;
    return threads === null ? 'Not exposed by browser' : `${threads} logical threads`;
  }

  formatWebGpuLabel(): string {
    return this.deviceSnapshot().webGpuAvailable ? 'Available' : 'Unavailable';
  }

  formatStorageLabel(): string {
    const snapshot = this.deviceSnapshot();
    if (snapshot.storageQuotaBytes === null || snapshot.storageUsageBytes === null) {
      return 'Not exposed by browser';
    }

    const freeBytes = Math.max(0, snapshot.storageQuotaBytes - snapshot.storageUsageBytes);
    return `${this.formatBytes(freeBytes)} free`;
  }

  formatConnectionLabel(): string {
    const connectionType = this.deviceSnapshot().effectiveConnectionType;
    if (!connectionType) {
      return 'No network hint';
    }

    const saveData = this.deviceSnapshot().saveDataEnabled ? ' · Save-Data on' : '';
    return `${connectionType.toUpperCase()}${saveData}`;
  }

  private async loadStorageEstimate(): Promise<void> {
    const navigatorLike = this.getNavigatorLike();
    const estimate = await navigatorLike?.storage?.estimate?.();
    if (!estimate) {
      return;
    }

    this.updateSnapshot({
      storageQuotaBytes: typeof estimate.quota === 'number' ? estimate.quota : null,
      storageUsageBytes: typeof estimate.usage === 'number' ? estimate.usage : null,
    });
  }

  private createSnapshot(): AiDeviceSnapshot {
    if (!this.isBrowser) {
      return {
        deviceMemoryGb: null,
        hardwareConcurrency: null,
        webGpuAvailable: false,
        saveDataEnabled: false,
        effectiveConnectionType: null,
        likelyConstrained: false,
        storageQuotaBytes: null,
        storageUsageBytes: null,
      };
    }

    const navigatorLike = this.getNavigatorLike();
    const connection = navigatorLike?.connection ?? navigatorLike?.mozConnection ?? navigatorLike?.webkitConnection ?? null;
    const runtimeProfile = getRuntimeResourceProfile();

    return {
      deviceMemoryGb: typeof navigatorLike?.deviceMemory === 'number' && navigatorLike.deviceMemory > 0
        ? navigatorLike.deviceMemory
        : null,
      hardwareConcurrency: typeof navigatorLike?.hardwareConcurrency === 'number' && navigatorLike.hardwareConcurrency > 0
        ? navigatorLike.hardwareConcurrency
        : null,
      webGpuAvailable: !!navigatorLike?.gpu,
      saveDataEnabled: connection?.saveData === true,
      effectiveConnectionType: connection?.effectiveType?.toLowerCase() ?? null,
      likelyConstrained: runtimeProfile.likelyConstrained,
      storageQuotaBytes: null,
      storageUsageBytes: null,
    };
  }

  private updateSnapshot(patch: Partial<AiDeviceSnapshot>): void {
    this.deviceSnapshot.update(snapshot => {
      const next = { ...snapshot, ...patch };
      this.guidance.set(buildAiDeviceGuidance(next));
      return next;
    });
  }

  private getNavigatorLike(): NavigatorLike | undefined {
    if (typeof navigator === 'undefined') {
      return undefined;
    }

    return navigator as NavigatorLike;
  }

  private formatBytes(value: number): string {
    if (value >= 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    if (value >= 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(0)} MB`;
    }

    return `${value} B`;
  }
}
