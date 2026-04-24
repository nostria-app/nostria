import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { LocalStorageService } from './local-storage.service';
import { SettingsService } from './settings.service';
import { BITCOIN_PRICE_API, BITCOIN_PRICE_PROXY_API } from './runes-settings.service';

interface CachedBitcoinUsdPrice {
  usd: number;
  updatedAt: number;
}

export interface SatDisplayOptions {
  showUnit?: boolean;
  compact?: boolean;
  hideWhenWalletHidden?: boolean;
  placeholder?: string;
  prefix?: string;
}

export interface SatDisplayValue {
  value: string;
  unit: string | null;
  mode: 'sats' | 'usd' | 'hidden' | 'placeholder';
}

const PRICE_CACHE_KEY = 'nostria-bitcoin-price-cache';
const PRICE_CACHE_TTL_SECONDS = 5 * 60;

@Injectable({
  providedIn: 'root',
})
export class SatDisplayService {
  private readonly settings = inject(SettingsService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly logger = inject(LoggerService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly cachedPrice = this.loadCachedPrice();
  private readonly usdPrice = signal<number | null>(this.cachedPrice?.usd ?? null);
  private readonly updatedAt = signal<number | null>(this.cachedPrice?.updatedAt ?? null);
  private readonly loading = signal(false);
  private loadPromise: Promise<number | null> | null = null;

  readonly displaySatsInUsd = computed(() => this.settings.settings().displaySatsInUsd === true);

  constructor() {
    effect(() => {
      if (this.displaySatsInUsd()) {
        void this.ensurePriceLoaded();
      }
    });
  }

  async toggleDisplayMode(): Promise<boolean> {
    const nextValue = !this.displaySatsInUsd();
    await this.settings.updateSettings({ displaySatsInUsd: nextValue });
    return nextValue;
  }

  async getSatsPerDollar(): Promise<number | null> {
    const usdPrice = await this.ensurePriceLoaded();
    if (typeof usdPrice !== 'number' || usdPrice <= 0) {
      return null;
    }

    return 100_000_000 / usdPrice;
  }

  async convertSatsToUsd(sats: number): Promise<number | null> {
    const usdPrice = await this.ensurePriceLoaded();
    if (typeof usdPrice !== 'number' || usdPrice <= 0) {
      return null;
    }

    return (sats * usdPrice) / 100_000_000;
  }

  async convertUsdToSats(usd: number): Promise<number | null> {
    const satsPerDollar = await this.getSatsPerDollar();
    if (typeof satsPerDollar !== 'number' || satsPerDollar <= 0) {
      return null;
    }

    return usd * satsPerDollar;
  }

  formatUsdValue(amount: number | null | undefined, compact = false): string {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return '$0.00';
    }

    return this.formatUsd(amount, compact);
  }

  async ensurePriceLoaded(force = false): Promise<number | null> {
    const now = Math.floor(Date.now() / 1000);
    const updatedAt = this.updatedAt();
    const currentUsdPrice = this.usdPrice();

    if (!force && currentUsdPrice !== null && updatedAt !== null && (now - updatedAt) < PRICE_CACHE_TTL_SECONDS) {
      return currentUsdPrice;
    }

    if (!force) {
      const cachedPrice = this.loadCachedPrice();
      if (cachedPrice && (now - cachedPrice.updatedAt) < PRICE_CACHE_TTL_SECONDS) {
        this.usdPrice.set(cachedPrice.usd);
        this.updatedAt.set(cachedPrice.updatedAt);
        return cachedPrice.usd;
      }
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loading.set(true);
    this.loadPromise = this.fetchPrice()
      .finally(() => {
        this.loading.set(false);
        this.loadPromise = null;
      });

    return this.loadPromise;
  }

  getDisplayValueFromSats(sats: number | null | undefined, options: SatDisplayOptions = {}): SatDisplayValue {
    const prefix = options.prefix ?? '';
    const showUnit = options.showUnit !== false;
    const placeholder = options.placeholder ?? '0';

    if (typeof sats !== 'number' || !Number.isFinite(sats)) {
      return {
        value: placeholder,
        unit: null,
        mode: 'placeholder',
      };
    }

    if (options.hideWhenWalletHidden && this.settings.settings().hideWalletAmounts) {
      return {
        value: `${prefix}****`,
        unit: showUnit && !this.displaySatsInUsd() ? 'sats' : null,
        mode: 'hidden',
      };
    }

    if (this.displaySatsInUsd()) {
      const usdPrice = this.usdPrice();
      if (typeof usdPrice === 'number' && usdPrice > 0) {
        const usdValue = (sats * usdPrice) / 100_000_000;
        return {
          value: `${prefix}${this.formatUsd(usdValue, options.compact === true)}`,
          unit: null,
          mode: 'usd',
        };
      }

      void this.ensurePriceLoaded();
    }

    return {
      value: `${prefix}${this.formatSatsNumber(sats, options.compact === true)}`,
      unit: showUnit ? 'sats' : null,
      mode: 'sats',
    };
  }

  getDisplayValueFromMsats(msats: number | null | undefined, options: SatDisplayOptions = {}): SatDisplayValue {
    if (typeof msats !== 'number' || !Number.isFinite(msats)) {
      return this.getDisplayValueFromSats(null, options);
    }

    return this.getDisplayValueFromSats(Math.floor(msats / 1000), options);
  }

  formatSats(sats: number | null | undefined, options: SatDisplayOptions = {}): string {
    const displayValue = this.getDisplayValueFromSats(sats, options);
    return displayValue.unit ? `${displayValue.value} ${displayValue.unit}` : displayValue.value;
  }

  formatMsats(msats: number | null | undefined, options: SatDisplayOptions = {}): string {
    const displayValue = this.getDisplayValueFromMsats(msats, options);
    return displayValue.unit ? `${displayValue.value} ${displayValue.unit}` : displayValue.value;
  }

  private async fetchPrice(): Promise<number | null> {
    try {
      const response = await fetch(this.getPriceUrl());
      if (!response.ok) {
        throw new Error(`Bitcoin price request failed (${response.status})`);
      }

      const data = await response.json() as { usd?: number };
      if (typeof data.usd !== 'number' || !Number.isFinite(data.usd) || data.usd <= 0) {
        throw new Error('Bitcoin price response did not include a valid USD value');
      }

      const updatedAt = Math.floor(Date.now() / 1000);
      this.usdPrice.set(data.usd);
      this.updatedAt.set(updatedAt);
      this.localStorage.setObject<CachedBitcoinUsdPrice>(PRICE_CACHE_KEY, { usd: data.usd, updatedAt });
      return data.usd;
    } catch (error) {
      this.logger.warn('Failed to load Bitcoin price for sat display', error);
      return this.usdPrice();
    }
  }

  private getPriceUrl(): string {
    return this.isBrowser ? BITCOIN_PRICE_PROXY_API : BITCOIN_PRICE_API;
  }

  private loadCachedPrice(): CachedBitcoinUsdPrice | null {
    const cachedPrice = this.localStorage.getObject<CachedBitcoinUsdPrice>(PRICE_CACHE_KEY);
    if (!cachedPrice || typeof cachedPrice.usd !== 'number' || typeof cachedPrice.updatedAt !== 'number') {
      return null;
    }

    return cachedPrice;
  }

  private formatSatsNumber(sats: number, compact: boolean): string {
    if (compact) {
      return new Intl.NumberFormat(undefined, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(sats);
    }

    return sats.toLocaleString();
  }

  private formatUsd(amount: number, compact: boolean): string {
    if (amount > 0 && amount < 0.01) {
      return '< $0.01';
    }

    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 2,
    }).format(amount);
  }
}