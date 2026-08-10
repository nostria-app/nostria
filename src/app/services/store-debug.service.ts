import { inject, PLATFORM_ID, signal, Service, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type StoreDebugLevel = 'info' | 'success' | 'warn' | 'error';

export interface StoreDebugEntry {
  id: number;
  /** Milliseconds since epoch (UI timestamp, not a Nostr timestamp) */
  timestamp: number;
  level: StoreDebugLevel;
  /** Short step name, e.g. 'bridge', 'purchase', 'verify' */
  step: string;
  message: string;
  /** Pre-serialized, truncated detail payload */
  detail?: string;
}

const STORAGE_KEY = 'nostria-store-debug-log';
const MAX_ENTRIES = 300;
const MAX_DETAIL_LENGTH = 800;

/**
 * Records every step of a native store (App Store / Play Store) purchase so the
 * flow can be inspected on a device where no developer console is available.
 *
 * The log is persisted to localStorage so it survives the WKWebView reloads that
 * happen around the StoreKit purchase sheet.
 */
@Service()
export class StoreDebugService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly entries = signal<StoreDebugEntry[]>([]);

  /** Newest entries first, for display. */
  readonly entriesNewestFirst = computed(() => [...this.entries()].reverse());

  readonly hasErrors = computed(() => this.entries().some(e => e.level === 'error'));

  private nextId = 1;

  constructor() {
    if (this.isBrowser) {
      this.restore();
    }
  }

  info(step: string, message: string, detail?: unknown): void {
    this.add('info', step, message, detail);
  }

  success(step: string, message: string, detail?: unknown): void {
    this.add('success', step, message, detail);
  }

  warn(step: string, message: string, detail?: unknown): void {
    this.add('warn', step, message, detail);
  }

  error(step: string, message: string, detail?: unknown): void {
    this.add('error', step, message, detail);
  }

  clear(): void {
    this.entries.set([]);
    this.persist();
  }

  /** Plain-text dump suitable for copying into a bug report. */
  export(): string {
    return this.entries()
      .map(entry => {
        const time = new Date(entry.timestamp).toISOString();
        const detail = entry.detail ? `\n    ${entry.detail}` : '';
        return `[${time}] ${entry.level.toUpperCase()} ${entry.step}: ${entry.message}${detail}`;
      })
      .join('\n');
  }

  /**
   * Shorten a long opaque token (JWS / purchase token) so it can be logged
   * without dumping the whole credential into storage.
   */
  static summarizeToken(token: string | undefined | null): string {
    if (!token) {
      return '(none)';
    }
    if (token.length <= 24) {
      return token;
    }
    return `${token.slice(0, 12)}…${token.slice(-8)} (len=${token.length})`;
  }

  private add(level: StoreDebugLevel, step: string, message: string, detail?: unknown): void {
    const entry: StoreDebugEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      level,
      step,
      message,
      detail: this.serializeDetail(detail),
    };

    this.entries.update(entries => {
      const next = [...entries, entry];
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });

    this.persist();
  }

  private serializeDetail(detail: unknown): string | undefined {
    if (detail === undefined || detail === null) {
      return undefined;
    }

    let text: string;
    if (typeof detail === 'string') {
      text = detail;
    } else if (detail instanceof Error) {
      text = `${detail.name}: ${detail.message}`;
    } else {
      try {
        text = JSON.stringify(detail);
      } catch {
        text = String(detail);
      }
    }

    return text.length > MAX_DETAIL_LENGTH
      ? `${text.slice(0, MAX_DETAIL_LENGTH)}… (truncated)`
      : text;
  }

  private persist(): void {
    if (!this.isBrowser) {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries()));
    } catch {
      // Storage full or unavailable — the in-memory log still works.
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as StoreDebugEntry[];
      if (!Array.isArray(parsed)) {
        return;
      }

      this.entries.set(parsed);
      this.nextId = parsed.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    } catch {
      // Corrupt log — start fresh.
    }
  }
}
