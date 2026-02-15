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
  receiveNativePushToken?: (token: string) => void;
  receivePushNotification?: (payload: unknown) => void;
}

/**
 * Service to handle native push notifications for PWABuilder-packaged apps.
 * 
 * For Android (TWA): Web Push works with notification delegation enabled.
 * For iOS: Uses APNs token from the native shell and backend registration.
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

  /** The native push token received from the native iOS app */
  nativePushToken = signal<string | null>(null);

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

  /** Setup the native bridge for iOS push token communication */
  private setupNativeBridge(): void {
    const win = window as WebKitWindow;

    // Listen for native push token from native iOS app
    win.receiveNativePushToken = (token: string) => {
      this.logger.info('Received native push token from native app');
      this.nativePushToken.set(token);
      // Dispatch event for other services to handle
      window.dispatchEvent(new CustomEvent('nativePushTokenReceived', { detail: { token } }));
    };

    // Listen for push notifications from native iOS app
    win.receivePushNotification = (payload: unknown) => {
      this.logger.debug('Received push notification from native app:', payload);
      window.dispatchEvent(new CustomEvent('nativePushReceived', { detail: payload }));
    };
  }

  /** Request push token from native iOS app */
  requestPushToken(): void {
    const win = window as WebKitWindow;
    if (win.webkit?.messageHandlers?.push) {
      try {
        win.webkit.messageHandlers.push.postMessage({
          action: 'requestToken'
        });
        this.logger.debug('Requested push token from native app');
      } catch (e) {
        this.logger.error('Failed to request push token:', e);
      }
    }
  }

  /**
   * Register native push token with your backend
   * Call this after receiving the native push token
   */
  async registerNativePushTokenWithBackend(token: string, pubkey: string): Promise<void> {
    // This should be implemented to send the APNs token to your notification backend.
    // Your backend can map this to Azure Notification Hub registrations/installations.
    this.logger.info('Native push token should be registered with backend for pubkey:', pubkey);

    // TODO: Implement API call to register native push token
    // Example:
    // await fetch(`${backendUrl}/api/subscription/native-push/${pubkey}`, {
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
      return 'Native iOS Push (APNs via Azure Notification Hub)';
    }
    if (this.isTWA()) {
      return 'Web Push (TWA Delegation)';
    }
    return 'Web Push';
  }
}
