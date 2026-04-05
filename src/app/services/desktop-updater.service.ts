import { Injectable, computed, inject, signal } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApplicationService } from './application.service';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { CustomDialogService } from './custom-dialog.service';
import { environment } from '../../environments/environment';
import { UpdateAvailableDialogComponent, UpdateAvailableDialogData, UpdateInstallOutcome } from '../components/update-available-dialog/update-available-dialog.component';

export interface DesktopUpdateInfo {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  rawJson: Record<string, unknown>;
}

export interface DesktopUpdateContext {
  platform: 'linux' | 'windows' | 'macos' | 'unknown';
  linuxInstallKind: 'appimage' | 'system' | null;
}

export interface LinuxManualUpdateInfo {
  downloadUrl: string;
  packageFileName: string;
  downloadCommand: string;
  installCommand: string;
}

interface TauriUpdateHandle {
  downloadAndInstall: (
    onEvent?: (progress: { event: 'Started' | 'Progress' | 'Finished'; data?: { contentLength?: number; chunkLength?: number } }) => void,
    options?: { headers?: HeadersInit; timeout?: number }
  ) => Promise<void>;
}

@Injectable({
  providedIn: 'root',
})
export class DesktopUpdaterService {
  private readonly DISMISSED_VERSION_KEY = 'nostria-dismissed-desktop-update-version';
  private readonly STARTUP_DELAY_MS = 15000;

  private readonly app = inject(ApplicationService);
  private readonly customDialog = inject(CustomDialogService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly logger = inject(LoggerService);
  private readonly snackBar = inject(MatSnackBar);

  private initialized = false;
  private promptOpenForVersion: string | null = null;
  private pendingUpdate: TauriUpdateHandle | null = null;
  private cachedUpdateContext: DesktopUpdateContext | null = null;

  readonly currentVersion = signal<string | null>(null);
  readonly checking = signal(false);
  readonly installing = signal(false);
  readonly availableUpdate = signal<DesktopUpdateInfo | null>(null);
  readonly lastCheckedAt = signal<number | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly isDesktop = computed(() => this.app.isBrowser() && isTauri());
  readonly hasUpdate = computed(() => this.availableUpdate() !== null);

  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    if (!this.isDesktop()) {
      return;
    }

    void this.loadCurrentVersion();

    if (!environment.production) {
      return;
    }

    void this.loadUpdateContext();

    window.setTimeout(() => {
      void this.checkForUpdates({ interactive: false, source: 'startup' });
    }, this.STARTUP_DELAY_MS);
  }

  async checkForUpdates(options: { interactive: boolean; source?: 'startup' | 'manual' } = { interactive: false }): Promise<DesktopUpdateInfo | null> {
    if (!this.isDesktop()) {
      if (options.interactive) {
        this.snackBar.open($localize`:@@desktopUpdater.desktopOnly:Automatic updates are only available in the desktop app.`, 'Close', {
          duration: 3500,
        });
      }
      return null;
    }

    if (this.checking()) {
      return this.availableUpdate();
    }

    this.checking.set(true);
    this.lastError.set(null);

    try {
      const updaterModule = await import('@tauri-apps/plugin-updater');
      const currentVersion = await this.loadCurrentVersion();
      await this.loadUpdateContext();
      const update = await updaterModule.check();

      this.lastCheckedAt.set(Date.now());

      if (!update) {
        this.pendingUpdate = null;
        this.availableUpdate.set(null);

        if (options.interactive) {
          this.snackBar.open($localize`:@@desktopUpdater.noUpdates:Nostria is already up to date.`, 'Close', {
            duration: 3000,
          });
        }

        return null;
      }

      const updateInfo: DesktopUpdateInfo = {
        currentVersion,
        version: update.version,
        date: update.date,
        body: update.body,
        rawJson: update.rawJson,
      };

      this.pendingUpdate = update;
      this.availableUpdate.set(updateInfo);

      const dismissedVersion = this.localStorage.getItem(this.DISMISSED_VERSION_KEY);
      const shouldPrompt = options.interactive || dismissedVersion !== updateInfo.version;

      if (shouldPrompt) {
        this.openUpdateDialog(updateInfo, options.interactive);
      }

      return updateInfo;
    } catch (error) {
      this.lastCheckedAt.set(Date.now());
      this.lastError.set($localize`:@@desktopUpdater.unavailable:Updates are not configured for this build yet.`);
      this.logger.warn('[DesktopUpdater] Failed to check for updates', error);

      if (options.interactive) {
        this.snackBar.open(this.lastError() ?? $localize`:@@desktopUpdater.unavailableFallback:Unable to check for updates right now.`, 'Close', {
          duration: 4500,
        });
      }

      return null;
    } finally {
      this.checking.set(false);
    }
  }

  dismissAvailableUpdate(version: string): void {
    if (this.availableUpdate()?.version === version) {
      this.localStorage.setItem(this.DISMISSED_VERSION_KEY, version);
    }
  }

  private async loadCurrentVersion(): Promise<string> {
    const existing = this.currentVersion();
    if (existing) {
      return existing;
    }

    try {
      const version = await getVersion();
      this.currentVersion.set(version);
      return version;
    } catch (error) {
      this.logger.warn('[DesktopUpdater] Failed to read app version from Tauri, falling back to manifest version', error);
      const fallbackVersion = this.app.version;
      this.currentVersion.set(fallbackVersion);
      return fallbackVersion;
    }
  }

  private openUpdateDialog(updateInfo: DesktopUpdateInfo, interactive: boolean): void {
    if (this.promptOpenForVersion === updateInfo.version) {
      return;
    }

    this.promptOpenForVersion = updateInfo.version;

    const updateContext = this.cachedUpdateContext;
    const linuxManualUpdate = updateContext?.platform === 'linux' && updateContext.linuxInstallKind === 'system'
      ? this.buildLinuxManualUpdateInfo(updateInfo.version)
      : null;

    const dialogRef = this.customDialog.open<UpdateAvailableDialogComponent, UpdateInstallOutcome>(UpdateAvailableDialogComponent, {
      title: $localize`:@@desktopUpdater.dialog.title:Update available`,
      headerIcon: 'system_update',
      width: '560px',
      maxWidth: '92vw',
      disableClose: this.installing(),
      data: {
        update: updateInfo,
        interactive,
        installMode: linuxManualUpdate ? 'manual-linux-package' : 'automatic',
        linuxManualUpdate,
        installUpdate: (onProgress) => this.installUpdate(updateInfo.version, onProgress),
        openLinuxDownload: linuxManualUpdate ? () => this.openLinuxManualDownload(linuxManualUpdate.downloadUrl) : undefined,
      } satisfies UpdateAvailableDialogData,
    });

    dialogRef.afterClosed$.subscribe(({ result }) => {
      this.promptOpenForVersion = null;

      if (result === 'later') {
        this.dismissAvailableUpdate(updateInfo.version);
      }

      if (result === 'installed') {
        this.localStorage.removeItem(this.DISMISSED_VERSION_KEY);
        this.availableUpdate.set(null);
        this.pendingUpdate = null;
        this.snackBar.open($localize`:@@desktopUpdater.installed:Update installed. Restart Nostria to finish applying the update if it does not relaunch automatically.`, 'Close', {
          duration: 6000,
        });
      }
    });
  }

  private async loadUpdateContext(): Promise<DesktopUpdateContext> {
    if (this.cachedUpdateContext) {
      return this.cachedUpdateContext;
    }

    const fallbackContext: DesktopUpdateContext = {
      platform: 'unknown',
      linuxInstallKind: null,
    };

    if (!this.isDesktop()) {
      this.cachedUpdateContext = fallbackContext;
      return fallbackContext;
    }

    try {
      const context = await invoke<DesktopUpdateContext>('desktop_update_context');
      this.cachedUpdateContext = context;
      return context;
    } catch (error) {
      this.logger.warn('[DesktopUpdater] Failed to detect desktop update context', error);
      this.cachedUpdateContext = fallbackContext;
      return fallbackContext;
    }
  }

  private buildLinuxManualUpdateInfo(version: string): LinuxManualUpdateInfo {
    const releaseTag = `v${version}`;
    const packageFileName = `Nostria_${version}_amd64.deb`;
    const downloadUrl = `https://github.com/nostria-app/nostria/releases/download/${releaseTag}/${packageFileName}`;

    return {
      downloadUrl,
      packageFileName,
      downloadCommand: `wget ${downloadUrl}`,
      installCommand: `sudo apt install /path/to/${packageFileName}`,
    };
  }

  private async openLinuxManualDownload(downloadUrl: string): Promise<void> {
    const openerModule = await import('@tauri-apps/plugin-opener');
    await openerModule.openUrl(downloadUrl);
  }

  private async installUpdate(version: string, onProgress: (message: string) => void): Promise<UpdateInstallOutcome> {
    const available = this.availableUpdate();
    if (!available || available.version !== version || !this.pendingUpdate) {
      throw new Error('No pending desktop update is available for installation.');
    }

    this.installing.set(true);
    this.lastError.set(null);

    let downloaded = 0;
    let totalBytes = 0;

    try {
      await this.pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            downloaded = 0;
            totalBytes = event.data?.contentLength ?? 0;
            onProgress($localize`:@@desktopUpdater.progress.started:Downloading update…`);
            break;
          case 'Progress': {
            downloaded += event.data?.chunkLength ?? 0;
            if (totalBytes > 0) {
              const percent = Math.min(100, Math.round((downloaded / totalBytes) * 100));
              onProgress($localize`:@@desktopUpdater.progress.percent:Downloading update… ${percent}:percent:%`);
            } else {
              onProgress($localize`:@@desktopUpdater.progress.downloading:Downloading update…`);
            }
            break;
          }
          case 'Finished':
            onProgress($localize`:@@desktopUpdater.progress.installing:Installing update…`);
            break;
        }
      });

      return 'installed';
    } catch (error) {
      this.logger.error('[DesktopUpdater] Failed to install update', error);
      throw error;
    } finally {
      this.installing.set(false);
    }
  }
}