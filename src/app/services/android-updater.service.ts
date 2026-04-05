import { computed, inject, Injectable, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { ApplicationService } from './application.service';
import { LoggerService } from './logger.service';

interface LatestJsonResponse {
  version?: unknown;
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubLatestReleaseResponse {
  tag_name?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

interface AndroidReleaseInfo {
  version: string;
  downloadUrl: string;
  releaseUrl?: string;
  source: 'latest-json' | 'github-api';
}

@Injectable({
  providedIn: 'root',
})
export class AndroidUpdaterService {
  private readonly latestJsonUrl = 'https://github.com/nostria-app/nostria/releases/latest/download/latest.json';
  private readonly githubLatestReleaseUrl = 'https://api.github.com/repos/nostria-app/nostria/releases/latest';

  private readonly app = inject(ApplicationService);
  private readonly logger = inject(LoggerService);
  private readonly snackBar = inject(MatSnackBar);

  readonly currentVersion = signal<string | null>(null);
  readonly latestVersion = signal<string | null>(null);
  readonly downloadUrl = signal<string | null>(null);
  readonly releaseUrl = signal<string | null>(null);
  readonly checking = signal(false);
  readonly lastCheckedAt = signal<number | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly isAndroidInstalled = computed(() =>
    this.app.isBrowser() && isTauri() && /Android/i.test(navigator.userAgent)
  );
  readonly hasUpdate = computed(() => {
    const currentVersion = this.currentVersion();
    const latestVersion = this.latestVersion();

    if (!currentVersion || !latestVersion) {
      return false;
    }

    return this.compareVersions(currentVersion, latestVersion) < 0;
  });

  async checkForUpdates(options: { interactive: boolean } = { interactive: false }): Promise<boolean> {
    if (!this.isAndroidInstalled()) {
      if (options.interactive) {
        this.snackBar.open(
          $localize`:@@androidUpdater.androidOnly:APK updates are only available in the installed Android app.`,
          'Close',
          { duration: 3500 }
        );
      }

      return false;
    }

    if (this.checking()) {
      return this.hasUpdate();
    }

    this.checking.set(true);
    this.lastError.set(null);

    try {
      const currentVersion = await this.loadCurrentVersion();
      const releaseInfo = await this.fetchLatestReleaseInfo();

      this.applyReleaseInfo(releaseInfo);
      this.lastCheckedAt.set(Date.now());

      const updateAvailable = this.compareVersions(currentVersion, releaseInfo.version) < 0;

      if (options.interactive) {
        this.snackBar.open(
          updateAvailable
            ? $localize`:@@androidUpdater.updateAvailable:Android update available: ${releaseInfo.version}:version`
            : $localize`:@@androidUpdater.noUpdates:Nostria is already up to date.`,
          'Close',
          { duration: updateAvailable ? 4500 : 3000 }
        );
      }

      return updateAvailable;
    } catch (error) {
      const message = $localize`:@@androidUpdater.checkFailed:Unable to check for Android updates right now.`;
      this.lastCheckedAt.set(Date.now());
      this.lastError.set(message);
      this.logger.warn('[AndroidUpdater] Failed to check for updates', error);

      if (options.interactive) {
        this.snackBar.open(message, 'Close', { duration: 4500 });
      }

      return false;
    } finally {
      this.checking.set(false);
    }
  }

  async openLatestApkDownload(): Promise<void> {
    try {
      const releaseInfo = this.latestVersion() && this.downloadUrl()
        ? {
          version: this.latestVersion()!,
          downloadUrl: this.downloadUrl()!,
          releaseUrl: this.releaseUrl() ?? undefined,
          source: 'latest-json' as const,
        }
        : await this.fetchLatestReleaseInfo();

      this.applyReleaseInfo(releaseInfo);
      await this.openUrl(releaseInfo.downloadUrl);
    } catch (error) {
      const message = $localize`:@@androidUpdater.downloadFailed:Unable to open the Android APK download right now.`;
      this.lastError.set(message);
      this.logger.warn('[AndroidUpdater] Failed to open APK download', error);
      this.snackBar.open(message, 'Close', { duration: 4500 });
    }
  }

  private async loadCurrentVersion(): Promise<string> {
    const existingVersion = this.currentVersion();
    if (existingVersion) {
      return existingVersion;
    }

    try {
      const version = this.normalizeVersion(await getVersion());
      if (!version) {
        throw new Error('Tauri returned an invalid Android app version.');
      }

      this.currentVersion.set(version);
      return version;
    } catch (error) {
      this.logger.warn('[AndroidUpdater] Failed to read Tauri version, falling back to app version', error);
      const fallbackVersion = this.normalizeVersion(this.app.version());

      if (!fallbackVersion) {
        throw new Error('Current Android app version is unavailable.');
      }

      this.currentVersion.set(fallbackVersion);
      return fallbackVersion;
    }
  }

  private async fetchLatestReleaseInfo(): Promise<AndroidReleaseInfo> {
    try {
      return await this.fetchLatestJsonReleaseInfo();
    } catch (error) {
      this.logger.warn('[AndroidUpdater] latest.json lookup failed, falling back to GitHub API', error);
      return this.fetchGitHubReleaseInfo();
    }
  }

  private async fetchLatestJsonReleaseInfo(): Promise<AndroidReleaseInfo> {
    const response = await fetch(this.latestJsonUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`latest.json request failed: ${response.status}`);
    }

    const data = await response.json() as LatestJsonResponse;
    const version = this.normalizeVersion(typeof data.version === 'string' ? data.version : null);

    if (!version) {
      throw new Error('latest.json does not contain a valid version field.');
    }

    return {
      version,
      downloadUrl: this.buildApkDownloadUrl(version),
      releaseUrl: this.buildReleaseUrl(version),
      source: 'latest-json',
    };
  }

  private async fetchGitHubReleaseInfo(): Promise<AndroidReleaseInfo> {
    const response = await fetch(this.githubLatestReleaseUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub latest release request failed: ${response.status}`);
    }

    const data = await response.json() as GitHubLatestReleaseResponse;
    const version = this.normalizeVersion(typeof data.tag_name === 'string' ? data.tag_name : null);

    if (!version) {
      throw new Error('GitHub latest release response does not contain a valid tag_name.');
    }

    const assets = Array.isArray(data.assets) ? data.assets as GitHubReleaseAsset[] : [];
    const apkAsset = assets.find((asset) => {
      const name = typeof asset.name === 'string' ? asset.name : '';
      return name.toLowerCase().endsWith('.apk');
    });

    const apkUrl = typeof apkAsset?.browser_download_url === 'string'
      ? apkAsset.browser_download_url
      : this.buildApkDownloadUrl(version);

    return {
      version,
      downloadUrl: apkUrl,
      releaseUrl: typeof data.html_url === 'string' ? data.html_url : this.buildReleaseUrl(version),
      source: 'github-api',
    };
  }

  private applyReleaseInfo(releaseInfo: AndroidReleaseInfo): void {
    this.latestVersion.set(releaseInfo.version);
    this.downloadUrl.set(releaseInfo.downloadUrl);
    this.releaseUrl.set(releaseInfo.releaseUrl ?? null);
  }

  private normalizeVersion(version: string | null): string | null {
    if (!version) {
      return null;
    }

    const normalized = version.trim().replace(/^v/i, '');
    return /^\d+(?:\.\d+)*$/.test(normalized) ? normalized : null;
  }

  private compareVersions(left: string, right: string): number {
    const leftParts = left.split('.').map((part) => Number.parseInt(part, 10));
    const rightParts = right.split('.').map((part) => Number.parseInt(part, 10));
    const maxLength = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < maxLength; index += 1) {
      const leftPart = leftParts[index] ?? 0;
      const rightPart = rightParts[index] ?? 0;

      if (leftPart !== rightPart) {
        return leftPart < rightPart ? -1 : 1;
      }
    }

    return 0;
  }

  private buildApkDownloadUrl(version: string): string {
    return `https://github.com/nostria-app/nostria/releases/download/v${version}/Nostria_${version}.apk`;
  }

  private buildReleaseUrl(version: string): string {
    return `https://github.com/nostria-app/nostria/releases/tag/v${version}`;
  }

  private async openUrl(url: string): Promise<void> {
    if (isTauri()) {
      const openerModule = await import('@tauri-apps/plugin-opener');
      await openerModule.openUrl(url);
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }
}