import { Injectable, effect, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PlatformService } from './platform.service';
import { LoggerService } from './logger.service';
import { environment } from '../../environments/environment';

/**
 * Product identifiers that map to store product IDs.
 * These must match the products configured in the Play Store / App Store.
 */
export interface StoreProduct {
  /** The product ID as configured in the native store */
  productId: string;
  /** Nostria tier name */
  tier: 'premium' | 'premium_plus';
  /** Billing cycle */
  billingCycle: 'monthly' | 'quarterly' | 'yearly';
}

/**
 * Result of a store purchase attempt
 */
export interface PurchaseResult {
  success: boolean;
  /** Store-specific purchase token for server verification */
  purchaseToken?: string;
  /** Store-specific order ID */
  orderId?: string;
  /** Error message if purchase failed */
  error?: string;
}

/** External payment URL for iOS users */
const EXTERNAL_PAYMENT_URL = 'https://nostria.app/premium';

/**
 * Store product ID mapping.
 * These IDs must match those configured in Google Play Console and App Store Connect.
 */
const STORE_PRODUCTS: StoreProduct[] = [
  { productId: 'nostria_premium_monthly', tier: 'premium', billingCycle: 'monthly' },
  { productId: 'nostria_premium_quarterly', tier: 'premium', billingCycle: 'quarterly' },
  { productId: 'nostria_premium_yearly', tier: 'premium', billingCycle: 'yearly' },
  { productId: 'nostria_premium_plus_monthly', tier: 'premium_plus', billingCycle: 'monthly' },
  { productId: 'nostria_premium_plus_quarterly', tier: 'premium_plus', billingCycle: 'quarterly' },
  { productId: 'nostria_premium_plus_yearly', tier: 'premium_plus', billingCycle: 'yearly' },
];

/**
 * Gift product IDs for Play Store.
 * Used when gifting a subscription to another user.
 */
const GIFT_PRODUCTS: StoreProduct[] = [
  { productId: 'nostria_gift_premium_1mo', tier: 'premium', billingCycle: 'monthly' },
  { productId: 'nostria_gift_premium_3mo', tier: 'premium', billingCycle: 'quarterly' },
  { productId: 'nostria_gift_premium_plus_1mo', tier: 'premium_plus', billingCycle: 'monthly' },
  { productId: 'nostria_gift_premium_plus_3mo', tier: 'premium_plus', billingCycle: 'quarterly' },
];

/** Debug-only one-time purchase product for store flow verification. */
const DONATION_PRODUCT_ID = 'nostria_donation_1usd';

/** App Store product ID for purchasing a verified @nostria.app username (1 year). */
const APP_STORE_USERNAME_PRODUCT_ID = 'username';

/** First release store subscription SKU (App Store + Play Store). */
const PRIMARY_STORE_SUBSCRIPTION_PRODUCT_ID = 'nostria_premium_monthly';

/**
 * Digital Goods API types for Play Store billing via TWA.
 * @see https://developer.chrome.com/docs/android/trusted-web-activity/receive-payments-play-billing
 */
interface DigitalGoodsService {
  getDetails(itemIds: string[]): Promise<ItemDetails[]>;
  listPurchases(): Promise<PurchaseDetails[]>;
}

interface ItemDetails {
  itemId: string;
  title: string;
  description: string;
  price: { currency: string; value: string };
  type: string;
}

interface PurchaseDetails {
  itemId: string;
  purchaseToken: string;
}

interface PaymentMethodData {
  supportedMethods: string;
  data: {
    sku: string;
    oldSku?: string;
  };
}

interface PaymentDetailsInit {
  total: { label: string; amount: { currency: string; value: string } };
}

/**
 * WebKit message handler interface for iOS StoreKit bridge.
 * The native iOS app shell exposes this via WKWebView's userContentController.
 */
interface WebKitMessageHandler {
  postMessage(message: unknown): void;
}

interface WebKitHandlers {
  nostriaStoreKit?: WebKitMessageHandler;
}

/**
 * Result payload posted back from the iOS native shell
 * via window.nostriaStoreKitCallback().
 */
interface AppStorePurchaseResponse {
  success: boolean;
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  error?: string;
}

/**
 * Service for handling in-app purchases across platforms.
 *
 * On Android (TWA), uses the Digital Goods API + Payment Request API
 * to interact with Google Play Billing.
 *
 * On iOS (native app), uses a WebKit message handler bridge to
 * communicate with the native StoreKit 2 integration.
 *
 * On web/PWA, this service is not used (Bitcoin Lightning is used instead).
 */
@Injectable({
  providedIn: 'root',
})
export class InAppPurchaseService {
  private readonly platformService = inject(PlatformService);
  private readonly logger = inject(LoggerService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  /** Whether Play Store billing is available and ready */
  readonly playStoreAvailable = signal(false);

  /** Whether App Store / StoreKit billing is available and ready */
  readonly appStoreAvailable = signal(false);

  /** Whether a purchase is currently in progress */
  readonly purchasing = signal(false);

  private digitalGoodsService: DigitalGoodsService | null = null;
  private playStoreInitAttempted = false;
  private appStoreInitAttempted = false;

  /** Pending App Store purchase resolve callback */
  private appStorePurchaseResolve: ((result: PurchaseResult) => void) | null = null;

  constructor() {
    if (!this.isBrowser) {
      return;
    }

    effect(() => {
      if (this.platformService.canPayWithPlayStore() && !this.playStoreInitAttempted) {
        this.playStoreInitAttempted = true;
        void this.initPlayStoreBilling();
      }

      if (this.platformService.canPayWithAppStore() && !this.appStoreInitAttempted) {
        this.appStoreInitAttempted = true;
        this.initAppStoreBilling();
      }
    });
  }

  /**
   * Initialize Google Play Store billing via Digital Goods API.
   * This is only available inside a TWA (Trusted Web Activity).
   */
  private async initPlayStoreBilling(): Promise<void> {
    try {
      if ('getDigitalGoodsService' in window) {
        this.digitalGoodsService = await (
          window as unknown as {
            getDigitalGoodsService: (paymentMethod: string) => Promise<DigitalGoodsService>;
          }
        ).getDigitalGoodsService('https://play.google.com/billing');
        this.playStoreAvailable.set(true);
        this.logger.info('Play Store billing initialized');
      } else {
        this.logger.warn('Digital Goods API not available');
      }
    } catch (error) {
      this.logger.error('Failed to initialize Play Store billing:', error);
    }
  }

  /**
   * Initialize Apple App Store billing via WebKit message handler bridge.
   * The native iOS app shell exposes `window.webkit.messageHandlers.nostriaStoreKit`
   * and posts results back via `window.nostriaStoreKitCallback`.
   */
  private initAppStoreBilling(): void {
    try {
      const webkit = (window as unknown as { webkit?: { messageHandlers?: WebKitHandlers } }).webkit;
      if (webkit?.messageHandlers?.nostriaStoreKit) {
        this.appStoreAvailable.set(true);
        this.logger.info('App Store billing bridge detected');

        // Register the global callback for receiving purchase results from native
        (window as unknown as { nostriaStoreKitCallback: (response: AppStorePurchaseResponse) => void })
          .nostriaStoreKitCallback = (response: AppStorePurchaseResponse) => {
            this.handleAppStoreCallback(response);
          };
      } else {
        this.logger.warn('WebKit StoreKit message handler not available');
      }
    } catch (error) {
      this.logger.error('Failed to initialize App Store billing:', error);
    }
  }

  /**
   * Handle the callback from the native iOS app shell after a StoreKit purchase.
   */
  private handleAppStoreCallback(response: AppStorePurchaseResponse): void {
    if (!this.appStorePurchaseResolve) {
      this.logger.warn('Received App Store callback with no pending purchase');
      return;
    }

    const resolve = this.appStorePurchaseResolve;
    this.appStorePurchaseResolve = null;
    this.purchasing.set(false);

    if (response.success && response.transactionId) {
      resolve({
        success: true,
        purchaseToken: response.transactionId,
        orderId: response.originalTransactionId,
      });
    } else {
      resolve({
        success: false,
        error: response.error || 'App Store purchase failed',
      });
    }
  }

  /**
   * Get the store product ID for a given tier and billing cycle.
   */
  getProductId(
    tier: 'premium' | 'premium_plus',
    billingCycle: 'monthly' | 'quarterly' | 'yearly'
  ): string | undefined {
    return STORE_PRODUCTS.find(
      (p) => p.tier === tier && p.billingCycle === billingCycle
    )?.productId;
  }

  /**
   * Get the gift product ID for a given tier and duration.
   */
  getGiftProductId(
    tier: 'premium' | 'premium_plus',
    durationMonths: 1 | 3
  ): string | undefined {
    const billingCycle = durationMonths === 1 ? 'monthly' : 'quarterly';
    return GIFT_PRODUCTS.find(
      (p) => p.tier === tier && p.billingCycle === billingCycle
    )?.productId;
  }

  /** Get the debug donation product ID ($1) used for store purchase verification. */
  getDonationProductId(): string {
    return DONATION_PRODUCT_ID;
  }

  /** Get the App Store SKU for a 1-year verified @nostria.app username purchase. */
  getAppStoreUsernameProductId(): string {
    return APP_STORE_USERNAME_PRODUCT_ID;
  }

  /** Get the currently supported subscription SKU for native stores. */
  getPrimaryStoreSubscriptionProductId(): string {
    return PRIMARY_STORE_SUBSCRIPTION_PRODUCT_ID;
  }

  /**
   * Get product details from the Play Store.
   * Returns pricing and other product information.
   */
  async getProductDetails(productIds: string[]): Promise<ItemDetails[]> {
    if (!this.digitalGoodsService) {
      return [];
    }

    try {
      return await this.digitalGoodsService.getDetails(productIds);
    } catch (error) {
      this.logger.error('Failed to get product details:', error);
      return [];
    }
  }

  /**
   * Purchase a subscription via Google Play Store.
   * Uses the Payment Request API with the Play Store payment method.
   *
   * @param productId The store product ID to purchase
   * @returns Purchase result with token for server-side verification
   */
  async purchaseWithPlayStore(productId: string): Promise<PurchaseResult> {
    if (!this.digitalGoodsService) {
      return { success: false, error: 'Play Store billing not available' };
    }

    this.purchasing.set(true);

    try {
      // Get product details for pricing
      const details = await this.digitalGoodsService.getDetails([productId]);
      if (!details || details.length === 0) {
        return { success: false, error: 'Product not found in store' };
      }

      const product = details[0];

      // Create a Payment Request with the Play Store payment method
      const paymentMethodData: PaymentMethodData[] = [
        {
          supportedMethods: 'https://play.google.com/billing',
          data: { sku: productId },
        },
      ];

      const paymentDetails: PaymentDetailsInit = {
        total: {
          label: product.title,
          amount: {
            currency: product.price.currency,
            value: product.price.value,
          },
        },
      };

      const request = new PaymentRequest(paymentMethodData as unknown as PaymentMethodData[], paymentDetails);
      const response = await request.show();

      // Extract purchase token from the response
      const responseData = response.details as unknown as { purchaseToken: string; orderId?: string };
      const purchaseToken = responseData?.purchaseToken;

      // Complete the payment request
      await response.complete('success');

      if (purchaseToken) {
        this.logger.info('Play Store purchase completed:', productId);
        return {
          success: true,
          purchaseToken,
          orderId: responseData?.orderId,
        };
      } else {
        return { success: false, error: 'No purchase token received' };
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { success: false, error: 'Purchase cancelled by user' };
      }
      this.logger.error('Play Store purchase failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Purchase failed',
      };
    } finally {
      this.purchasing.set(false);
    }
  }

  /**
   * Purchase a subscription via Apple App Store / StoreKit.
   * Sends a message to the native iOS shell via WebKit message handlers,
   * which triggers a StoreKit purchase flow. The result is received
   * asynchronously via `window.nostriaStoreKitCallback`.
   *
   * @param productId The App Store product ID to purchase
   * @returns Purchase result with transaction ID for server-side verification
   */
  async purchaseWithAppStore(productId: string): Promise<PurchaseResult> {
    const webkit = (window as unknown as { webkit?: { messageHandlers?: WebKitHandlers } }).webkit;
    const handler = webkit?.messageHandlers?.nostriaStoreKit;

    if (!handler) {
      return { success: false, error: 'App Store billing not available' };
    }

    this.purchasing.set(true);

    try {
      return await new Promise<PurchaseResult>((resolve) => {
        // Set up the resolve callback before posting the message
        this.appStorePurchaseResolve = resolve;

        // Set a timeout in case the native shell never responds
        const timeout = setTimeout(() => {
          if (this.appStorePurchaseResolve === resolve) {
            this.appStorePurchaseResolve = null;
            this.purchasing.set(false);
            resolve({ success: false, error: 'App Store purchase timed out' });
          }
        }, 120000); // 2 minute timeout

        // Override resolve to also clear the timeout
        this.appStorePurchaseResolve = (result: PurchaseResult) => {
          clearTimeout(timeout);
          resolve(result);
        };

        // Send purchase request to native iOS shell
        handler.postMessage({
          action: 'purchase',
          productId,
        });

        this.logger.info('App Store purchase initiated:', productId);
      });
    } catch (error) {
      this.purchasing.set(false);
      this.logger.error('App Store purchase failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'App Store purchase failed',
      };
    }
  }

  /**
   * Acknowledge a Play Store purchase after server verification.
   * This must be called to prevent Google from refunding the purchase.
   */
  async acknowledgePurchase(purchaseToken: string): Promise<boolean> {
    if (!this.digitalGoodsService) {
      return false;
    }

    try {
      // The Digital Goods API handles acknowledgement through listPurchases
      const purchases = await this.digitalGoodsService.listPurchases();
      return purchases.some((p) => p.purchaseToken === purchaseToken);
    } catch (error) {
      this.logger.error('Failed to acknowledge purchase:', error);
      return false;
    }
  }

  /**
   * Open the external payment URL (fallback for any platform).
   * Useful when native store billing is unavailable or as a user choice.
   *
   * @param pubkey The user's public key to pre-fill on the payment page
   * @param tier The premium tier to purchase
   * @param billingCycle The billing cycle
   */
  openExternalPaymentUrl(
    pubkey: string,
    tier?: string,
    billingCycle?: string
  ): void {
    const url = new URL(EXTERNAL_PAYMENT_URL);
    url.searchParams.set('pubkey', pubkey);
    if (tier) {
      url.searchParams.set('tier', tier);
    }
    if (billingCycle) {
      url.searchParams.set('cycle', billingCycle);
    }

    window.open(url.toString(), '_blank');

    this.snackBar.open(
      'Opening payment page in your browser. Complete your purchase there and return to the app.',
      'OK',
      { duration: 8000 }
    );
  }

  /**
   * Open the external payment URL for gifting (iOS).
   *
   * @param pubkey The sender's public key
   * @param recipientPubkey The gift recipient's public key
   * @param tier The premium tier to gift
   * @param duration Duration in months
   */
  openExternalGiftUrl(
    pubkey: string,
    recipientPubkey: string,
    tier?: string,
    duration?: number
  ): void {
    const url = new URL(EXTERNAL_PAYMENT_URL);
    url.searchParams.set('pubkey', pubkey);
    url.searchParams.set('gift', recipientPubkey);
    if (tier) {
      url.searchParams.set('tier', tier);
    }
    if (duration) {
      url.searchParams.set('duration', String(duration));
    }

    window.open(url.toString(), '_blank');

    this.snackBar.open(
      'Opening gift payment page in your browser.',
      'OK',
      { duration: 8000 }
    );
  }

  /**
   * Verify a store purchase with the Nostria backend.
   * The backend will validate the purchase token with the store
   * and activate the subscription.
   *
   * @param purchaseToken The token from the store purchase
   * @param pubkey The user's public key
   * @param store Which store the purchase was from
   */
  async verifyPurchaseWithBackend(
    purchaseToken: string,
    pubkey: string,
    store: 'play-store' | 'app-store'
  ): Promise<boolean> {
    try {
      const response = await fetch(`${environment.backendUrl}account/verify-store-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseToken,
          pubkey,
          store,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        this.logger.error('Backend purchase verification failed:', errorData);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to verify purchase with backend:', error);
      return false;
    }
  }
}
