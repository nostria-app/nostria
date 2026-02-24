import { Injectable, computed, inject, signal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';

export type RuneId = 'bitcoin-price' | 'weather' | 'nostr-swiss-knife' | 'music-favorites';
export type SidebarWidgetId = 'favorites' | 'runes';

export const BITCOIN_PRICE_API = 'https://pay.ariton.app/price';

export interface WeatherLocationPreference {
  latitude: number;
  longitude: number;
  label: string;
}

export interface CachedBitcoinPrice {
  usd: number;
  eur: number;
  updatedAt: number;
}

export interface RunesSettings {
  runeOrder: RuneId[];
  enabledRunes: RuneId[];
  openRunes: RuneId[];
  sidebarWidgetOrder: SidebarWidgetId[];
  enabledSidebarWidgets: SidebarWidgetId[];
  weatherManualLocation: WeatherLocationPreference | null;
}

const STORAGE_KEY = 'nostria-runes-settings-v1';
const BITCOIN_PRICE_CACHE_KEY = 'nostria-bitcoin-price-cache';

const ALL_RUNES: RuneId[] = ['bitcoin-price', 'weather', 'nostr-swiss-knife', 'music-favorites'];
const ALL_SIDEBAR_WIDGETS: SidebarWidgetId[] = ['favorites', 'runes'];

const DEFAULT_SETTINGS: RunesSettings = {
  runeOrder: [...ALL_RUNES],
  enabledRunes: ['nostr-swiss-knife', 'music-favorites'],
  openRunes: [],
  sidebarWidgetOrder: [...ALL_SIDEBAR_WIDGETS],
  enabledSidebarWidgets: [...ALL_SIDEBAR_WIDGETS],
  weatherManualLocation: null,
};

@Injectable({
  providedIn: 'root',
})
export class RunesSettingsService {
  private readonly localStorage = inject(LocalStorageService);

  private readonly _settings = signal<RunesSettings>(this.loadSettings());

  readonly settings = this._settings.asReadonly();
  readonly runeOrder = computed(() => this._settings().runeOrder);
  readonly enabledRunes = computed(() => this._settings().enabledRunes);
  readonly openRunes = computed(() => this._settings().openRunes);
  readonly sidebarWidgetOrder = computed(() => this._settings().sidebarWidgetOrder);
  readonly enabledSidebarWidgets = computed(() => this._settings().enabledSidebarWidgets);
  readonly weatherManualLocation = computed(() => this._settings().weatherManualLocation);
  readonly visibleSidebarWidgets = computed(() => {
    const enabled = this.enabledSidebarWidgets();
    return this.sidebarWidgetOrder().filter(widget => enabled.includes(widget));
  });

  isRuneEnabled(runeId: RuneId): boolean {
    return this.enabledRunes().includes(runeId);
  }

  setRuneEnabled(runeId: RuneId, enabled: boolean): void {
    this._settings.update(current => {
      const hasRune = current.enabledRunes.includes(runeId);

      if (enabled && !hasRune) {
        return {
          ...current,
          enabledRunes: [...current.enabledRunes, runeId],
        };
      }

      if (!enabled && hasRune) {
        const nextEnabled = current.enabledRunes.filter(id => id !== runeId);
        return {
          ...current,
          enabledRunes: nextEnabled,
          openRunes: current.openRunes.filter(id => id !== runeId),
        };
      }

      return current;
    });

    this.persist();
  }

  toggleRuneEnabled(runeId: RuneId): boolean {
    const nextEnabled = !this.isRuneEnabled(runeId);
    this.setRuneEnabled(runeId, nextEnabled);
    return nextEnabled;
  }

  setRuneOpen(runeId: RuneId, open: boolean): void {
    this._settings.update(current => {
      if (!current.enabledRunes.includes(runeId)) {
        return current;
      }

      const isOpen = current.openRunes.includes(runeId);
      if (open && !isOpen) {
        return {
          ...current,
          openRunes: [...current.openRunes, runeId],
        };
      }

      if (!open && isOpen) {
        return {
          ...current,
          openRunes: current.openRunes.filter(id => id !== runeId),
        };
      }

      return current;
    });

    this.persist();
  }

  toggleRuneOpen(runeId: RuneId): boolean {
    const nextOpen = !this.openRunes().includes(runeId);
    this.setRuneOpen(runeId, nextOpen);
    return nextOpen;
  }

  setRuneOrder(order: RuneId[]): void {
    this._settings.update(current => {
      const deduped = this.normalizeRuneOrder(order);
      return {
        ...current,
        runeOrder: deduped,
        enabledRunes: this.sortByOrder(current.enabledRunes, deduped),
        openRunes: this.sortByOrder(current.openRunes, deduped),
      };
    });

    this.persist();
  }

  moveRuneUp(runeId: RuneId): boolean {
    return this.moveRune(runeId, -1);
  }

  moveRuneDown(runeId: RuneId): boolean {
    return this.moveRune(runeId, 1);
  }

  isSidebarWidgetEnabled(widgetId: SidebarWidgetId): boolean {
    return this.enabledSidebarWidgets().includes(widgetId);
  }

  setSidebarWidgetEnabled(widgetId: SidebarWidgetId, enabled: boolean): void {
    this._settings.update(current => {
      const hasWidget = current.enabledSidebarWidgets.includes(widgetId);

      if (enabled && !hasWidget) {
        return {
          ...current,
          enabledSidebarWidgets: this.sortSidebarWidgetsByOrder([...current.enabledSidebarWidgets, widgetId], current.sidebarWidgetOrder),
        };
      }

      if (!enabled && hasWidget) {
        return {
          ...current,
          enabledSidebarWidgets: current.enabledSidebarWidgets.filter(widget => widget !== widgetId),
        };
      }

      return current;
    });

    this.persist();
  }

  setSidebarWidgetOrder(order: SidebarWidgetId[]): void {
    this._settings.update(current => {
      const normalizedOrder = this.normalizeSidebarWidgetOrder(order);
      return {
        ...current,
        sidebarWidgetOrder: normalizedOrder,
        enabledSidebarWidgets: this.sortSidebarWidgetsByOrder(current.enabledSidebarWidgets, normalizedOrder),
      };
    });

    this.persist();
  }

  moveSidebarWidgetUp(widgetId: SidebarWidgetId): boolean {
    return this.moveSidebarWidget(widgetId, -1);
  }

  moveSidebarWidgetDown(widgetId: SidebarWidgetId): boolean {
    return this.moveSidebarWidget(widgetId, 1);
  }

  setWeatherManualLocation(location: WeatherLocationPreference): void {
    this._settings.update(current => ({
      ...current,
      weatherManualLocation: {
        latitude: location.latitude,
        longitude: location.longitude,
        label: location.label,
      },
    }));

    this.persist();
  }

  clearWeatherManualLocation(): void {
    this._settings.update(current => ({
      ...current,
      weatherManualLocation: null,
    }));

    this.persist();
  }

  clearOpenRunes(): void {
    this._settings.update(current => {
      return {
        ...current,
        openRunes: [],
      };
    });

    this.persist();
  }

  getCachedBitcoinPrice(): CachedBitcoinPrice | null {
    const cached = this.localStorage.getObject<CachedBitcoinPrice>(BITCOIN_PRICE_CACHE_KEY);
    if (!cached || typeof cached.usd !== 'number' || typeof cached.eur !== 'number' || typeof cached.updatedAt !== 'number') {
      return null;
    }

    return cached;
  }

  setCachedBitcoinPrice(price: CachedBitcoinPrice): void {
    this.localStorage.setObject(BITCOIN_PRICE_CACHE_KEY, price);
  }

  private loadSettings(): RunesSettings {
    const stored = this.localStorage.getObject<Partial<RunesSettings> & { pinnedRuneId?: RuneId | null }>(STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_SETTINGS };
    }

    const runeOrder = this.normalizeRuneOrder(Array.isArray(stored.runeOrder) ? stored.runeOrder : ALL_RUNES);

    const enabledRunesRaw = Array.isArray(stored.enabledRunes) ? stored.enabledRunes : DEFAULT_SETTINGS.enabledRunes;
    const enabledRunes = this.sortByOrder(this.validateRuneArray(enabledRunesRaw), runeOrder);

    const openRunesRaw = Array.isArray(stored.openRunes)
      ? stored.openRunes
      : (stored.pinnedRuneId ? [stored.pinnedRuneId] : []);
    const openRunes = this.sortByOrder(
      this.validateRuneArray(openRunesRaw).filter(id => enabledRunes.includes(id)),
      runeOrder,
    );

    const sidebarWidgetOrder = this.normalizeSidebarWidgetOrder(
      Array.isArray(stored.sidebarWidgetOrder) ? stored.sidebarWidgetOrder : ALL_SIDEBAR_WIDGETS,
    );

    const enabledSidebarWidgetsRaw = Array.isArray(stored.enabledSidebarWidgets)
      ? stored.enabledSidebarWidgets
      : ALL_SIDEBAR_WIDGETS;

    const enabledSidebarWidgets = this.sortSidebarWidgetsByOrder(
      this.validateSidebarWidgetArray(enabledSidebarWidgetsRaw),
      sidebarWidgetOrder,
    );

    const weatherManualLocation = this.parseWeatherManualLocation(stored.weatherManualLocation);

    return {
      runeOrder,
      enabledRunes: enabledRunes.length > 0 ? enabledRunes : [...DEFAULT_SETTINGS.enabledRunes],
      openRunes,
      sidebarWidgetOrder,
      enabledSidebarWidgets: enabledSidebarWidgets.length > 0 ? enabledSidebarWidgets : [...DEFAULT_SETTINGS.enabledSidebarWidgets],
      weatherManualLocation,
    };
  }

  private parseWeatherManualLocation(value: unknown): WeatherLocationPreference | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Partial<WeatherLocationPreference>;

    if (typeof record.latitude !== 'number' || typeof record.longitude !== 'number' || typeof record.label !== 'string') {
      return null;
    }

    return {
      latitude: record.latitude,
      longitude: record.longitude,
      label: record.label,
    };
  }

  private validateRuneArray(items: unknown[]): RuneId[] {
    const validated: RuneId[] = [];

    for (const item of items) {
      if (item === 'bitcoin-price' || item === 'weather' || item === 'nostr-swiss-knife' || item === 'music-favorites') {
        if (!validated.includes(item)) {
          validated.push(item);
        }
      }
    }

    return validated;
  }

  private normalizeRuneOrder(items: unknown[]): RuneId[] {
    const normalized = this.validateRuneArray(items);

    for (const rune of ALL_RUNES) {
      if (!normalized.includes(rune)) {
        normalized.push(rune);
      }
    }

    return normalized;
  }

  private sortByOrder(items: RuneId[], order: RuneId[]): RuneId[] {
    return [...items].sort((left, right) => order.indexOf(left) - order.indexOf(right));
  }

  private validateSidebarWidgetArray(items: unknown[]): SidebarWidgetId[] {
    const validated: SidebarWidgetId[] = [];

    for (const item of items) {
      if (item === 'favorites' || item === 'runes') {
        if (!validated.includes(item)) {
          validated.push(item);
        }
      }
    }

    return validated;
  }

  private normalizeSidebarWidgetOrder(items: unknown[]): SidebarWidgetId[] {
    const normalized = this.validateSidebarWidgetArray(items);

    for (const widget of ALL_SIDEBAR_WIDGETS) {
      if (!normalized.includes(widget)) {
        normalized.push(widget);
      }
    }

    return normalized;
  }

  private sortSidebarWidgetsByOrder(items: SidebarWidgetId[], order: SidebarWidgetId[]): SidebarWidgetId[] {
    return [...items].sort((left, right) => order.indexOf(left) - order.indexOf(right));
  }

  private moveRune(runeId: RuneId, direction: -1 | 1): boolean {
    const currentOrder = [...this.runeOrder()];
    const currentIndex = currentOrder.indexOf(runeId);

    if (currentIndex < 0) {
      return false;
    }

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= currentOrder.length) {
      return false;
    }

    currentOrder.splice(currentIndex, 1);
    currentOrder.splice(targetIndex, 0, runeId);
    this.setRuneOrder(currentOrder);
    return true;
  }

  private moveSidebarWidget(widgetId: SidebarWidgetId, direction: -1 | 1): boolean {
    const currentOrder = [...this.sidebarWidgetOrder()];
    const currentIndex = currentOrder.indexOf(widgetId);

    if (currentIndex < 0) {
      return false;
    }

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= currentOrder.length) {
      return false;
    }

    currentOrder.splice(currentIndex, 1);
    currentOrder.splice(targetIndex, 0, widgetId);
    this.setSidebarWidgetOrder(currentOrder);
    return true;
  }

  private persist(): void {
    this.localStorage.setObject(STORAGE_KEY, this._settings());
  }
}
