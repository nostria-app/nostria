import { Injectable, computed, inject, signal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';

export type RuneId = 'bitcoin-price' | 'nostr-swiss-knife' | 'music-favorites';

export interface RunesSettings {
  runeOrder: RuneId[];
  enabledRunes: RuneId[];
  openRunes: RuneId[];
}

const STORAGE_KEY = 'nostria-runes-settings-v1';

const ALL_RUNES: RuneId[] = ['bitcoin-price', 'nostr-swiss-knife', 'music-favorites'];

const DEFAULT_SETTINGS: RunesSettings = {
  runeOrder: [...ALL_RUNES],
  enabledRunes: [...ALL_RUNES],
  openRunes: [],
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

  clearOpenRunes(): void {
    this._settings.update(current => {
      return {
        ...current,
        openRunes: [],
      };
    });

    this.persist();
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

    return {
      runeOrder,
      enabledRunes: enabledRunes.length > 0 ? enabledRunes : [...DEFAULT_SETTINGS.enabledRunes],
      openRunes,
    };
  }

  private validateRuneArray(items: unknown[]): RuneId[] {
    const validated: RuneId[] = [];

    for (const item of items) {
      if (item === 'bitcoin-price' || item === 'nostr-swiss-knife' || item === 'music-favorites') {
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

  private persist(): void {
    this.localStorage.setObject(STORAGE_KEY, this._settings());
  }
}
