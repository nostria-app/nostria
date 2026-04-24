import { Injectable, inject, signal } from '@angular/core';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';

/**
 * Tracks which Nostr events the user has actually seen (scrolled into the viewport)
 * in the Feeds view. Used by the "Hide Seen" filter.
 *
 * Design:
 * - On account init, an in-memory **snapshot** of all previously-seen event IDs is
 *   loaded from the `seenEvents` store. The snapshot is what the "Hide Seen"
 *   filter checks against.
 * - When an event scrolls into the viewport, it is added to a **session** set and
 *   queued for a batched write to IndexedDB. It is *not* added to the snapshot,
 *   so the user can keep scrolling and newly-seen events do not disappear from
 *   the current view. Next session (reload), those events become part of the
 *   snapshot and are hidden.
 *
 * Writes are debounced (batched) to avoid hammering the DB when many events
 * scroll into view quickly.
 */
@Injectable({ providedIn: 'root' })
export class SeenEventsService {
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);

  /** IDs that were already in the DB when this session started. Used by the filter. */
  private readonly snapshot = new Set<string>();

  /** IDs marked seen during this session (not used for filtering until next load). */
  private readonly session = new Set<string>();

  /** IDs pending a flush to IndexedDB. */
  private readonly pending = new Set<string>();

  /** Signal bumped whenever the snapshot changes — lets consumers re-evaluate. */
  readonly snapshotVersion = signal(0);

  /** Whether the initial snapshot has been loaded from the DB. */
  readonly loaded = signal(false);

  /** Rough cap so the in-memory structures do not grow without bound. */
  private static readonly MAX_SESSION_ENTRIES = 50_000;

  /** Seen events older than this are pruned on init. 90 days. */
  private static readonly RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

  private flushHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly flushDelayMs = 1500;

  /**
   * Load the snapshot of seen event IDs from the per-account database.
   * Call this once after the account database has been opened.
   */
  async loadSnapshot(): Promise<void> {
    this.snapshot.clear();
    this.session.clear();
    this.pending.clear();
    this.loaded.set(false);

    try {
      // Prune old records first so the snapshot stays reasonably sized
      await this.database.pruneSeenEvents(Date.now() - SeenEventsService.RETENTION_MS);

      const ids = await this.database.getAllSeenEventIds();
      for (const id of ids) {
        this.snapshot.add(id);
      }
      this.logger.info(`[SeenEvents] Loaded ${this.snapshot.size} seen event IDs`);
    } catch (error) {
      this.logger.warn('[SeenEvents] Failed to load snapshot:', error);
    } finally {
      this.loaded.set(true);
      this.snapshotVersion.update(v => v + 1);
    }
  }

  /**
   * Clear in-memory state. Call when switching accounts or signing out.
   */
  reset(): void {
    this.cancelFlush();
    this.snapshot.clear();
    this.session.clear();
    this.pending.clear();
    this.loaded.set(false);
    this.snapshotVersion.update(v => v + 1);
  }

  /**
   * True if the event was seen in a previous session (i.e. is in the snapshot).
   * Session-seen events return false so they stay visible in the current feed.
   */
  isSeenInSnapshot(id: string): boolean {
    return this.snapshot.has(id);
  }

  /**
   * Mark an event as seen. Called when an event element scrolls into the
   * viewport inside the Feeds view.
   */
  markSeen(id: string): void {
    if (!id) return;
    if (this.snapshot.has(id) || this.session.has(id)) return;

    if (this.session.size >= SeenEventsService.MAX_SESSION_ENTRIES) {
      return;
    }

    this.session.add(id);
    this.pending.add(id);
    this.scheduleFlush();
  }

  /**
   * Mark many events at once (useful for initial page hydration scenarios).
   */
  markManySeen(ids: Iterable<string>): void {
    for (const id of ids) {
      this.markSeen(id);
    }
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== null) return;
    this.flushHandle = setTimeout(() => {
      this.flushHandle = null;
      void this.flush();
    }, this.flushDelayMs);
  }

  private cancelFlush(): void {
    if (this.flushHandle !== null) {
      clearTimeout(this.flushHandle);
      this.flushHandle = null;
    }
  }

  private async flush(): Promise<void> {
    if (this.pending.size === 0) return;

    const ids = [...this.pending];
    this.pending.clear();

    try {
      await this.database.saveSeenEvents(ids, Date.now());
    } catch (error) {
      this.logger.warn('[SeenEvents] Failed to persist seen events:', error);
      // Re-queue on failure so we try again on the next flush
      for (const id of ids) {
        this.pending.add(id);
      }
      this.scheduleFlush();
    }
  }

  /**
   * Force an immediate flush (e.g. before the page unloads).
   */
  async flushNow(): Promise<void> {
    this.cancelFlush();
    await this.flush();
  }
}
