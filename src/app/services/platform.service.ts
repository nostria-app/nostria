import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * The type of app context the user is running in.
 * - 'web': Standard browser (desktop or mobile browser)
 * - 'pwa': Installed Progressive Web App (standalone display mode)
 * - 'native-android': Native Android app (Play Store / TWA)
 * - 'native-ios': Native iOS app (App Store)
 */
export type AppContext = 'web' | 'pwa' | 'native-android' | 'native-ios';

/**
 * Available payment methods based on platform context.
 * - 'bitcoin': Lightning Network invoice (default for web/pwa)
 * - 'play-store': Google Play Billing (Android native apps)
 * - 'app-store': Apple App Store / StoreKit (iOS native apps)
 * - 'external-url': External URL redirect (fallback for any platform)
 */
export type PaymentPlatform = 'bitcoin' | 'play-store' | 'app-store' | 'external-url';

/**
 * Service for detecting platform (OS) and providing platform-specific utilities.
 * Detects whether the app is running as a native app, PWA, or in a browser,
 * and provides payment platform routing based on the app context.
 */
@Injectable({
  providedIn: 'root',
})
export class PlatformService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // Platform detection signals
  readonly isMac = signal(false);
  readonly isWindows = signal(false);
  readonly isLinux = signal(false);
  readonly isIOS = signal(false);
  readonly isAndroid = signal(false);

  // App context detection signals
  readonly isStandalone = signal(false);
  readonly isNativeAndroid = signal(false);
  readonly isNativeIOS = signal(false);

  /**
   * Simulated app context for debugging platform-specific UI.
   * When set to a non-null value, overrides the detected app context.
   * Set to null to use real detection.
   */
  readonly simulatedAppContext = signal<AppContext | null>(null);

  /**
   * Debug gate for native store billing flows.
   * Disabled by default so premium checkout keeps Lightning as the active method
   * unless explicitly enabled in Settings > Debug.
   */
  readonly enableNativeStorePaymentsForDebug = signal(false);

  /** The current app context (web, pwa, native-android, native-ios) */
  readonly appContext = computed<AppContext>(() => {
    const simulated = this.simulatedAppContext();
    if (simulated !== null) return simulated;
    if (this.isNativeIOS()) return 'native-ios';
    if (this.isNativeAndroid()) return 'native-android';
    if (this.isStandalone()) return 'pwa';
    return 'web';
  });

  /** Whether the app is running as a native mobile app (Android or iOS) */
  readonly isNativeApp = computed(() => {
    const ctx = this.appContext();
    return ctx === 'native-android' || ctx === 'native-ios';
  });

  /** Whether the app is running on a mobile device (native or mobile browser) */
  readonly isMobile = computed(() => this.isIOS() || this.isAndroid());

  /**
   * The recommended payment platform based on app context.
   * - Native Android: Play Store billing
   * - Native iOS: App Store / StoreKit
   * - Web/PWA: Bitcoin Lightning
   */
  readonly paymentPlatform = computed<PaymentPlatform>(() => {
    if (!this.enableNativeStorePaymentsForDebug()) {
      return 'bitcoin';
    }

    const ctx = this.appContext();
    if (ctx === 'native-android') return 'play-store';
    if (ctx === 'native-ios') return 'app-store';
    return 'bitcoin';
  });

  /** Whether Bitcoin Lightning payment is available (web/PWA context) */
  readonly canPayWithBitcoin = computed(() => this.paymentPlatform() === 'bitcoin');

  /** Whether Play Store billing is available (Android native context) */
  readonly canPayWithPlayStore = computed(() => this.paymentPlatform() === 'play-store');

  /** Whether App Store / StoreKit billing is available (iOS native context) */
  readonly canPayWithAppStore = computed(() => this.paymentPlatform() === 'app-store');

  /** Whether the user must be directed to an external URL to pay (fallback, always available) */
  readonly mustUseExternalPayment = computed(() => this.paymentPlatform() === 'external-url');

  constructor() {
    if (this.isBrowser) {
      this.detectPlatform();
      this.detectAppContext();
    }
  }

  /**
   * Detect the current platform based on user agent
   */
  private detectPlatform(): void {
    const userAgent = navigator.userAgent.toLowerCase();

    this.isMac.set(/macintosh|mac os x/.test(userAgent) && !/iphone|ipad|ipod/.test(userAgent));
    this.isWindows.set(/windows/.test(userAgent));
    this.isLinux.set(/linux/.test(userAgent) && !/android/.test(userAgent));
    this.isIOS.set(/iphone|ipad|ipod/.test(userAgent));
    this.isAndroid.set(/android/.test(userAgent));
  }

  /**
   * Detect whether the app is running as a native app, PWA, or browser.
   *
   * Detection heuristics:
   * - Native Android: TWA (Trusted Web Activity) sets document.referrer to the Android package,
   *   or a custom query param / Android WebView user agent marker is present.
   * - Native iOS: iOS Safari standalone mode in combination with iOS-specific signals.
   * - PWA: display-mode standalone media query matches.
   */
  private detectAppContext(): void {
    // Check if running in standalone (PWA or TWA) mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    this.isStandalone.set(isStandalone);

    // Check URL params for native app markers (set by native app shells)
    const urlParams = new URLSearchParams(window.location.search);
    const nativeParam = urlParams.get('app_context');

    if (nativeParam === 'android' || this.detectTWA()) {
      this.isNativeAndroid.set(true);
    } else if (nativeParam === 'ios' || (isStandalone && this.isIOS())) {
      // On iOS, standalone + iOS means it's from the App Store wrapper or PWA.
      // The native iOS app shell should set app_context=ios to distinguish from PWA.
      if (nativeParam === 'ios') {
        this.isNativeIOS.set(true);
      }
    }
  }

  /**
   * Detect if running inside a Trusted Web Activity (TWA) on Android.
   * TWAs set document.referrer to 'android-app://<package-name>'.
   */
  private detectTWA(): boolean {
    return document.referrer.startsWith('android-app://');
  }

  /**
   * Check if a keyboard event uses the correct modifier key for the platform
   * - On Mac: Alt/Option key (changed from Cmd to avoid conflict with macOS command center)
   * - On Windows/Linux: Alt key
   * 
   * @param event - The keyboard event
   * @returns true if the correct platform modifier key is pressed
   */
  hasModifierKey(event: KeyboardEvent): boolean {
    // All platforms now use Alt/Option key
    return event.altKey && !event.metaKey && !event.ctrlKey;
  }

  /**
   * Get the display name for the modifier key used on this platform
   * @returns The modifier key display name (e.g., "Alt", "Option", "⌥")
   */
  getModifierKeyDisplay(useSymbol = false): string {
    if (this.isMac()) {
      return useSymbol ? '⌥' : 'Option';
    } else {
      return 'Alt';
    }
  }

  /**
   * Format a keyboard shortcut for display based on platform
   * @param key - The key (e.g., "C", "S", "N")
   * @param useSymbol - Whether to use symbol (⌥) or text (Option/Alt) for modifier
   * @returns Formatted shortcut string (e.g., "⌥+C" or "Alt+C")
   */
  formatShortcut(key: string, useSymbol = false): string {
    const modifier = this.getModifierKeyDisplay(useSymbol);
    return `${modifier}+${key}`;
  }
}
