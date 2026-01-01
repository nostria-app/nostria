import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { InstallService, PlatformInfo } from '../../services/install.service';

export interface InstallDialogData {
  platformInfo: PlatformInfo;
  canInstall: boolean;
}

@Component({
  selector: 'app-install-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatDividerModule],
  template: `
    <h2 mat-dialog-title>Install Nostria</h2>
    <mat-dialog-content>
      <div class="install-options">
        @if (showPWAInstall()) {
        <div class="install-option pwa-option">
          <mat-icon>web</mat-icon>
          <div class="option-content">
            <h3>Install as Web App</h3>
            <p>Install Nostria directly from your browser for quick access</p>
            <button mat-raised-button color="primary" (click)="installPWA()">
              <mat-icon>download</mat-icon>
              Install Now
            </button>
            @if (!data.canInstall) {
            <p class="install-hint">
              <mat-icon inline>info</mat-icon>
              @if (data.platformInfo.isMacOS) {
              <span>
                <strong>Chrome/Edge:</strong> Look for the install icon <mat-icon inline style="vertical-align: middle;">download</mat-icon> in the address bar<br>
                <strong>Safari:</strong> File menu → Add to Dock
              </span>
              } @else if (data.platformInfo.isAndroid) {
              <span>Tap the menu (⋮) in Chrome, then select "Add to Home screen" or "Install app"</span>
              } @else {
              <span>Look for the install icon <mat-icon inline style="vertical-align: middle;">download</mat-icon> in your browser's address bar (right side)</span>
              }
            </p>
            }
          </div>
        </div>
        }

        @if (showPWAInstall() && (data.platformInfo.isWindows || data.platformInfo.isAndroid || data.platformInfo.isIOS)) {
        <mat-divider></mat-divider>
        }

        @if (data.platformInfo.isWindows) {
        <div class="install-option">
          <mat-icon>desktop_windows</mat-icon>
          <div class="option-content">
            <h3>Microsoft Store</h3>
            <p>Download from the Microsoft Store for Windows</p>
            <button mat-stroked-button (click)="openWindowsStore()">
              <mat-icon>open_in_new</mat-icon>
              Open Store
            </button>
          </div>
        </div>
        }

        @if (data.platformInfo.isWindows && data.platformInfo.isAndroid) {
        <mat-divider></mat-divider>
        }

        @if (data.platformInfo.isAndroid) {
        <div class="install-option">
          <mat-icon>android</mat-icon>
          <div class="option-content">
            <h3>Google Play Store</h3>
            <p>Download from the Google Play Store for Android</p>
            <button mat-stroked-button (click)="openPlayStore()">
              <mat-icon>open_in_new</mat-icon>
              Open Store
            </button>
          </div>
        </div>

        <mat-divider></mat-divider>

        <div class="install-option">
          <mat-icon>android</mat-icon>
          <div class="option-content">
            <h3>Download APK</h3>
            <p>Download the Android package file directly</p>
            <button mat-stroked-button (click)="downloadApk()">
              <mat-icon>download</mat-icon>
              Download APK
            </button>
          </div>
        </div>
        }

        @if (data.platformInfo.isAndroid && data.platformInfo.isIOS) {
        <mat-divider></mat-divider>
        }

        @if (data.platformInfo.isIOS) {
        <div class="install-option">
          <mat-icon>apple</mat-icon>
          <div class="option-content">
            <h3>App Store</h3>
            <p>Download from the Apple App Store for iOS</p>
            <button mat-stroked-button (click)="openAppStore()">
              <mat-icon>open_in_new</mat-icon>
              Open Store
            </button>
          </div>
        </div>
        }

        @if (data.platformInfo.isIOS && !data.canInstall && (data.platformInfo.isIOS || data.platformInfo.isMacOS)) {
        <mat-divider></mat-divider>
        }

        @if (!data.canInstall && (data.platformInfo.isIOS || data.platformInfo.isMacOS)) {
        <div class="install-option ios-instructions">
          <mat-icon>info</mat-icon>
          <div class="option-content">
            <h3>Install on iOS/Safari</h3>
            <p>To install Nostria as a web app:</p>
            <ol>
              <li>Tap the Share button <mat-icon inline>ios_share</mat-icon></li>
              <li>Scroll down and tap "Add to Home Screen"</li>
              <li>Tap "Add" to confirm</li>
            </ol>
          </div>
        </div>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      mat-dialog-content {
        min-height: 200px;
        max-height: 70vh;
        overflow-y: auto;
      }

      .install-options {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .install-option {
        display: flex;
        gap: 16px;
        align-items: flex-start;
        padding: 16px 0;

        > mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          color: var(--mat-sys-primary);
          flex-shrink: 0;
        }

        .option-content {
          flex: 1;

          h3 {
            margin: 0 0 8px 0;
            font-size: 18px;
            font-weight: 500;
          }

          p {
            margin: 0 0 12px 0;
            color: var(--mat-sys-on-surface-variant);
          }

          .install-hint {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 12px;
            margin-top: 16px;
            background-color: var(--mat-sys-surface-container-high);
            border-radius: 4px;
            color: var(--mat-sys-on-surface);
            font-size: 14px;

            mat-icon {
              font-size: 20px;
              width: 20px;
              height: 20px;
              flex-shrink: 0;
              margin-top: 2px;
            }
          }

          ol {
            margin: 8px 0 0 0;
            padding-left: 20px;

            li {
              margin-bottom: 8px;
              display: flex;
              align-items: center;
              gap: 4px;

              mat-icon {
                font-size: 18px;
                width: 18px;
                height: 18px;
              }
            }
          }

          button {
            margin-top: 8px;
          }
        }
      }

      .pwa-option {
        background-color: var(--mat-sys-primary-container);
        padding: 16px;
        border-radius: 8px;
        margin: 0 0 0 0;

        > mat-icon {
          color: var(--mat-sys-on-primary-container);
        }

        .option-content {
          h3 {
            color: var(--mat-sys-on-primary-container);
          }

          p {
            color: var(--mat-sys-on-primary-container);
            opacity: 0.8;
          }
        }
      }

      .ios-instructions {
        background-color: var(--mat-sys-surface-container-high);
        padding: 16px;
        border-radius: 8px;
      }

      mat-divider {
        margin: 8px 0;
      }
    `,
  ],
})
export class InstallDialogComponent {
  readonly dialogRef = inject(MatDialogRef<InstallDialogComponent>);
  readonly data = inject<InstallDialogData>(MAT_DIALOG_DATA);
  private readonly installService = inject(InstallService);
  private readonly snackBar = inject(MatSnackBar);

  constructor() {
    // Debug logging
    console.log('[InstallDialog] Dialog data:', {
      canInstall: this.data.canInstall,
      platformInfo: this.data.platformInfo,
    });
  }

  showPWAInstall(): boolean {
    // Show PWA install section for Windows, Linux, Mac, and Android
    // Android Chrome supports beforeinstallprompt and direct PWA installation
    return (
      this.data.platformInfo.isWindows ||
      this.data.platformInfo.isLinux ||
      this.data.platformInfo.isMacOS ||
      this.data.platformInfo.isAndroid
    );
  }

  async installPWA(): Promise<void> {
    const result = await this.installService.promptInstall();
    if (result) {
      this.snackBar.open('App installed successfully!', 'Close', { duration: 3000 });
      this.dialogRef.close();
    } else if (!this.data.canInstall) {
      // Prompt not available - guide user to manual installation
      let message = 'Look for the install icon in your browser\'s address bar (usually on the right side)';

      if (this.data.platformInfo.isMacOS) {
        message = 'Chrome/Edge: Look for install icon in address bar. Safari: File menu → Add to Dock';
      }

      this.snackBar.open(message, 'OK', {
        duration: 7000,
        panelClass: 'install-info-snackbar'
      });
    }
  }

  openWindowsStore(): void {
    window.open('https://apps.microsoft.com/store/detail/9N7F0TWQ0D8G', '_blank');
    this.dialogRef.close();
  }

  openPlayStore(): void {
    window.open('https://play.google.com/store/apps/details?id=app.nostria.twa', '_blank');
    this.dialogRef.close();
  }

  downloadApk(): void {
    window.open('https://github.com/nostria-app/nostria/releases/download/android-v1.0.5/nostria-android-v1.0.5.apk', '_blank');
    this.dialogRef.close();
  }

  openAppStore(): void {
    window.open('https://testflight.apple.com/join/ysTpCtum', '_blank');
    this.dialogRef.close();
  }
}
