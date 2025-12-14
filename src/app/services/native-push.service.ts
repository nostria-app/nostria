import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from './logger.service';

// Type definitions for native bridge communication
interface WebKitMessageHandlers {
  push?: {
    postMessage: (message: unknown) => void;
  };
}

interface WebKitWindow extends Window {
  webkit?: {
    messageHandlers?: WebKitMessageHandlers;
  };
  receiveFCMToken?: (token: string) => void;
  receivePushNotification?: (payload: unknown) => void;
}

/**
 * Service to handle native push notifications for PWABuilder-packaged apps.
 * 
 * For Android (TWA): Web Push works with notification delegation enabled.
 * For iOS: Requires Firebase Cloud Messaging (FCM) integration in the native shell.
 * 
 * This service provides a bridge for the iOS native app to communicate with the PWA.
 */
@Injectable({
  providedIn: 'root',
})
export class NativePushService {
  private platformId = inject(PLATFORM_ID);
  private logger = inject(LoggerService);

  /** Whether the app is running in a native iOS context (PWABuilder iOS shell) */
  isNativeiOS = signal(false);

  /** Whether the app is running in a TWA (Android) */
  isTWA = signal(false);

  /** The FCM token received from the native iOS app */
  fcmToken = signal<string | null>(null);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.detectEnvironment();
      this.setupNativeBridge();
    }
  }

  /**
   * Detect if we're running in a native app context
   */
  private detectEnvironment(): void {
    // Check for TWA (Android)
    // TWAs typically have a specific document referrer or can be detected via the display mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isTWA = document.referrer.includes('android-app://') ||
      (isStandalone && /Android/i.test(navigator.userAgent));
    this.isTWA.set(isTWA);

    // Check for iOS PWA shell
    // PWABuilder iOS shell sets a specific user agent or we can check for webkit message handlers
    const isIOSPWA = this.hasWebKitMessageHandler() ||
      (isStandalone && /iPhone|iPad|iPod/i.test(navigator.userAgent));
    this.isNativeiOS.set(isIOSPWA);

    if (isTWA) {
      this.logger.info('Running in TWA (Android) context');
    }
    if (isIOSPWA) {
      this.logger.info('Running in native iOS PWA shell');
    }
  }

  /**
   * Check if WebKit message handlers are available (iOS native bridge)
   */
  private hasWebKitMessageHandler(): boolean {
    const win = window as WebKitWindow;
    return !!win.webkit?.messageHandlers?.push;
  }

  /**
   * Setup the native bridge for iOS FCM communication
   */
  private setupNativeBridge(): void {
    const win = window as WebKitWindow;

    // Listen for FCM token from native iOS app
    win.receiveFCMToken = (token: string) => {
      this.logger.info('Received FCM token from native app');
      this.fcmToken.set(token);
      // Dispatch event for other services to handle
      window.dispatchEvent(new CustomEvent('fcmTokenReceived', { detail: { token } }));
    };

    // Listen for push notifications from native iOS app
    win.receivePushNotification = (payload: unknown) => {
      this.logger.debug('Received push notification from native app:', payload);
      window.dispatchEvent(new CustomEvent('nativePushReceived', { detail: payload }));
    };
  }

  /**
   * Request FCM token from native iOS app
   */
  requestFCMToken(): void {
    const win = window as WebKitWindow;
    if (win.webkit?.messageHandlers?.push) {
      try {
        win.webkit.messageHandlers.push.postMessage({
          action: 'requestToken'
        });
        this.logger.debug('Requested FCM token from native app');
      } catch (e) {
        this.logger.error('Failed to request FCM token:', e);
      }
    }
  }

  /**
   * Register FCM token with your backend
   * Call this after receiving the FCM token
   */
  async registerFCMTokenWithBackend(token: string, pubkey: string): Promise<void> {
    // This should be implemented to send the FCM token to your notification backend
    // Your backend will use this to send notifications via FCM to iOS devices
    this.logger.info('FCM token should be registered with backend for pubkey:', pubkey);

    // TODO: Implement API call to register FCM token
    // Example:
    // await fetch(`${backendUrl}/api/subscription/fcm/${pubkey}`, {
    //   method: 'POST',
    //   body: JSON.stringify({ token, platform: 'ios' }),
    //   headers: { 'Content-Type': 'application/json' }
    // });
  }

  /**
   * Check if native push is available
   */
  isNativePushAvailable(): boolean {
    return this.isNativeiOS() || this.isTWA();
  }

  /**
   * Get the appropriate push method description for UI
   */
  getPushMethodDescription(): string {
    if (this.isNativeiOS()) {
      return 'Native iOS Push (FCM)';
    }
    if (this.isTWA()) {
      return 'Web Push (TWA Delegation)';
    }
    return 'Web Push';
  }
}
