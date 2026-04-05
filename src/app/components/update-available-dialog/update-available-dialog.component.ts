import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { ClipboardService } from '../../services/clipboard.service';
import { DesktopUpdateInfo, LinuxManualUpdateInfo } from '../../services/desktop-updater.service';

export type UpdateInstallOutcome = 'installed' | 'later' | 'manual';

export type UpdateInstallMode = 'automatic' | 'manual-linux-package';

export interface UpdateAvailableDialogData {
  update: DesktopUpdateInfo;
  interactive: boolean;
  installMode: UpdateInstallMode;
  linuxManualUpdate?: LinuxManualUpdateInfo;
  installUpdate: (onProgress: (message: string) => void) => Promise<UpdateInstallOutcome>;
  openLinuxDownload?: () => Promise<void>;
}

@Component({
  selector: 'app-update-available-dialog',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './update-available-dialog.component.html',
  styleUrl: './update-available-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdateAvailableDialogComponent {
  dialogRef = inject(CustomDialogRef<UpdateAvailableDialogComponent, UpdateInstallOutcome>);
  private readonly clipboard = inject(ClipboardService);

  data!: UpdateAvailableDialogData;

  installing = signal(false);
  progressMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

  get linuxManualUpdate(): LinuxManualUpdateInfo | undefined {
    return this.data.linuxManualUpdate;
  }

  async install(): Promise<void> {
    if (this.installing()) {
      return;
    }

    this.installing.set(true);
    this.errorMessage.set(null);
    this.progressMessage.set($localize`:@@desktopUpdater.dialog.preparing:Preparing update…`);

    try {
      const result = await this.data.installUpdate((message) => {
        this.progressMessage.set(message);
      });
      this.dialogRef.close(result);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : $localize`:@@desktopUpdater.dialog.failed:Unable to install the update right now.`;
      this.errorMessage.set(message);
      this.progressMessage.set(null);
    } finally {
      this.installing.set(false);
    }
  }

  async copyLinuxInstallCommand(): Promise<void> {
    const installCommand = this.linuxManualUpdate?.installCommand;
    if (!installCommand) {
      return;
    }

    await this.clipboard.copyText(
      installCommand,
      $localize`:@@desktopUpdater.dialog.linux.commandCopied:Install command copied to clipboard.`
    );
  }

  async openLinuxDownload(): Promise<void> {
    if (!this.data.openLinuxDownload) {
      return;
    }

    try {
      await this.data.openLinuxDownload();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : $localize`:@@desktopUpdater.dialog.linux.downloadFailed:Unable to open the package download right now.`;
      this.errorMessage.set(message);
    }
  }

  closeLater(): void {
    if (this.installing()) {
      return;
    }

    this.dialogRef.close('later');
  }
}