import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { DesktopUpdateInfo } from '../../services/desktop-updater.service';

export type UpdateInstallOutcome = 'installed' | 'later';

export interface UpdateAvailableDialogData {
  update: DesktopUpdateInfo;
  interactive: boolean;
  installUpdate: (onProgress: (message: string) => void) => Promise<UpdateInstallOutcome>;
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

  data!: UpdateAvailableDialogData;

  installing = signal(false);
  progressMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

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

  closeLater(): void {
    if (this.installing()) {
      return;
    }

    this.dialogRef.close('later');
  }
}