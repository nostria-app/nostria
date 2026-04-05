import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { LoggerService } from './logger.service';

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PlatformInfo {
  isWindows: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  canInstallPWA: boolean;
  isInstalled: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class InstallService {
  private readonly logger = inject(LoggerService);
  private readonly dialog = inject(MatDialog);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private deferredPrompt: InstallPromptEvent | null = null;

  canInstall = signal(false);
  isInstalled = signal(false);
  platformInfo = signal<PlatformInfo>({
    isWindows: false,
    isAndroid: false,
    isIOS: false,
    isMacOS: false,
    isLinux: false,
    canInstallPWA: false,
    isInstalled: false,
  });

  constructor() {
    if (this.isBrowser) {
      this.detectPlatformAndInstallation();
      this.setupInstallPrompt();

      // Make status available in console for debugging
      (window as { installStatus?: () => void }).installStatus = () => {
        const status = this.getInstallationStatus();
        console.log('=== PWA Installation Status ===');
        console.log('Is Installed:', status.isInstalled);
        console.log('Can Install:', status.canInstall);
        console.log('Should Show Option:', status.shouldShowOption);
        console.log('Platform Info:', status.platformInfo);
        console.log('Display Modes:', {
          standalone: window.matchMedia('(display-mode: standalone)').matches,
          iosStandalone: !!(window.navigator as { standalone?: boolean }).standalone,
        });
      };
    }
  }

  private detectPlatformAndInstallation(): void {
    const userAgent = navigator.userAgent.toLowerCase();
    const standalone = (window.navigator as { standalone?: boolean }).standalone;

    // Check if the app is running as installed PWA
    // Your manifest uses "display": "standalone", so check for that mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = !!standalone; // iOS Safari uses navigator.standalone

    const isInStandaloneMode = isStandalone || isIOSStandalone;

    const info: PlatformInfo = {
      isWindows: /windows/.test(userAgent),
      isAndroid: /android/.test(userAgent),
      isIOS: /iphone|ipad|ipod/.test(userAgent),
      isMacOS: /macintosh|mac os x/.test(userAgent) && !/iphone|ipad|ipod/.test(userAgent),
      isLinux: /linux/.test(userAgent) && !/android/.test(userAgent),
      canInstallPWA: true,
      isInstalled: isInStandaloneMode,
    };

    this.platformInfo.set(info);
    this.isInstalled.set(isInStandaloneMode);
  }

  private setupInstallPrompt(): void {
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferredPrompt = e as InstallPromptEvent;
      this.canInstall.set(true);

      const info = this.platformInfo();
      info.canInstallPWA = true;
      this.platformInfo.set(info);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.isInstalled.set(true);

      const info = this.platformInfo();
      info.isInstalled = true;
      this.platformInfo.set(info);
    });
  }

  async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) {
      this.logger.warn('[InstallService] No deferred install prompt available');

      return false;
    }

    try {
      await this.deferredPrompt.prompt();
      const choiceResult = await this.deferredPrompt.userChoice;

      this.logger.info('[InstallService] User choice:', choiceResult.outcome);

      if (choiceResult.outcome === 'accepted') {
        this.deferredPrompt = null;
        this.canInstall.set(false);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('[InstallService] Error during install prompt:', error);
      return false;
    }
  }

  async openInstallDialog(): Promise<void> {
    const { InstallDialogComponent } = await import('../components/install-dialog/install-dialog.component');

    this.dialog.open(InstallDialogComponent, {
      width: '500px',
      maxWidth: '90vw',
      data: {
        platformInfo: this.platformInfo(),
        canInstall: this.canInstall(),
      },
    });
  }

  shouldShowInstallOption(): boolean {
    // Don't show if already installed
    if (this.isInstalled()) {
      return false;
    }

    // Show if PWA can be installed or if on a platform with store options
    const info = this.platformInfo();
    const shouldShow = info.canInstallPWA || info.isWindows || info.isAndroid || info.isIOS;

    return shouldShow;
  }

  /**
   * Get current installation status for debugging
   */
  getInstallationStatus(): {
    isInstalled: boolean;
    canInstall: boolean;
    platformInfo: PlatformInfo;
    shouldShowOption: boolean;
  } {
    return {
      isInstalled: this.isInstalled(),
      canInstall: this.canInstall(),
      platformInfo: this.platformInfo(),
      shouldShowOption: this.shouldShowInstallOption(),
    };
  }
}
