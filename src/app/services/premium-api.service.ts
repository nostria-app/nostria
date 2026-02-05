import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfiguration } from '../api/api-configuration';
import { USE_NIP98 } from './interceptors/nip98Auth';
import { Account } from '../api/models/account';

/**
 * Payment history item returned from the API
 */
export interface PaymentHistoryItem {
  id: string;
  status: 'pending' | 'expired' | 'paid';
  tier: string;
  billingCycle: 'monthly' | 'quarterly' | 'yearly';
  priceCents: number;
  currency?: string;
  createdAt: number;
  paidAt?: number;
}

/**
 * Subscription history item returned from the API
 */
export interface SubscriptionHistoryItem {
  id: string;
  tier: string;
  billingCycle: 'monthly' | 'quarterly' | 'yearly';
  priceCents: number;
  currency?: string;
  purchaseDate: number;
  startsAt: number;
  expiresAt: number;
}

/**
 * Request body for renewing a subscription
 */
export interface RenewSubscriptionRequest {
  paymentId: string;
}

/**
 * Premium API Service
 * 
 * Provides access to premium-related API endpoints that are not part of the
 * auto-generated API services. This service handles:
 * - Subscription renewal
 * - Payment history
 * - Subscription history
 */
@Injectable({ providedIn: 'root' })
export class PremiumApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);

  private get rootUrl(): string {
    return this.config.rootUrl;
  }

  /**
   * Renew an existing subscription
   * 
   * POST /api/account/renew
   * 
   * @param paymentId - The ID of the paid Lightning invoice
   * @returns Updated account details
   */
  renewSubscription(paymentId: string): Observable<Account> {
    const context = new HttpContext().set(USE_NIP98, true);
    return this.http.post<Account>(
      `${this.rootUrl}/account/renew`,
      { paymentId } as RenewSubscriptionRequest,
      { context }
    );
  }

  /**
   * Get payment history for the authenticated user
   * 
   * GET /api/payment/history
   * 
   * @param limit - Maximum number of items to return (default 50, max 100)
   * @returns Array of payment history items
   */
  getPaymentHistory(limit = 50): Observable<PaymentHistoryItem[]> {
    const context = new HttpContext().set(USE_NIP98, true);
    return this.http.get<PaymentHistoryItem[]>(
      `${this.rootUrl}/payment/history`,
      { 
        context,
        params: { limit: Math.min(limit, 100).toString() }
      }
    );
  }

  /**
   * Get subscription history for the authenticated user
   * 
   * GET /api/account/subscription-history
   * 
   * @param limit - Maximum number of items to return (default 50, max 100)
   * @returns Array of subscription history items
   */
  getSubscriptionHistory(limit = 50): Observable<SubscriptionHistoryItem[]> {
    const context = new HttpContext().set(USE_NIP98, true);
    return this.http.get<SubscriptionHistoryItem[]>(
      `${this.rootUrl}/account/subscription-history`,
      { 
        context,
        params: { limit: Math.min(limit, 100).toString() }
      }
    );
  }
}
