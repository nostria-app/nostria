import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, InjectionToken, PLATFORM_ID, inject, signal } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Event, verifyEvent } from 'nostr-tools';
import { PublishService } from './publish.service';

export interface ScheduledPost {
  id: string;
  events: Event[];
  relayUrls: string[][];
  nextEvent: number;
  attempts: number;
  retryAt: number;
  leaseUntil: number;
  claim: number;
}

interface ScheduledPostsDatabase extends DBSchema {
  posts: { key: string; value: ScheduledPost };
}

export const SCHEDULED_POSTS_DATABASE = new InjectionToken<string>('Scheduled posts database', {
  providedIn: 'root',
  factory: () => 'nostria-scheduled-posts',
});

@Injectable({ providedIn: 'root' })
export class ScheduledPostsService {
  private readonly publisher = inject(PublishService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly databaseName = inject(SCHEDULED_POSTS_DATABASE);
  private readonly destroyRef = inject(DestroyRef);
  private database?: Promise<IDBPDatabase<ScheduledPostsDatabase>>;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private started = false;
  private destroyed = false;
  private readonly _posts = signal<ScheduledPost[]>([]);
  readonly posts = this._posts.asReadonly();
  private readonly _error = signal(false);
  readonly error = this._error.asReadonly();
  private readonly wake = () => { void this.processDue(); };

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.timer);
      if (this.isBrowser) {
        window.removeEventListener('online', this.wake);
        document.removeEventListener('visibilitychange', this.wake);
      }
      void this.database?.then(db => db.close());
    });
  }

  start(): void {
    if (!this.isBrowser || this.started) return;
    this.started = true;
    window.addEventListener('online', this.wake);
    document.addEventListener('visibilitychange', this.wake);
    this.wake();
  }

  private db(): Promise<IDBPDatabase<ScheduledPostsDatabase>> {
    if (!this.isBrowser) throw new Error('Scheduled posts require local device storage');
    this.database ??= openDB<ScheduledPostsDatabase>(this.databaseName, 1, {
      upgrade(db) { db.createObjectStore('posts', { keyPath: 'id' }); },
    }).catch(error => {
      this.database = undefined;
      throw error;
    });
    return this.database;
  }

  async refresh(): Promise<void> {
    const posts = await (await this.db()).getAll('posts');
    this._posts.set(posts.sort((a, b) => a.events[0].created_at - b.events[0].created_at));
  }

  async add(events: Event[]): Promise<void> {
    const first = events[0];
    if (!first || first.created_at <= Math.floor(Date.now() / 1000) ||
      events.some(event => event.pubkey !== first.pubkey ||
        event.created_at !== first.created_at || !verifyEvent(structuredClone(event)))) {
      throw new Error($localize`:@@scheduled.invalid:Choose a future time and sign the post again.`);
    }
    // Capture the author's destinations now; account switching must not change delivery.
    const relayUrls = await Promise.all(events.map(event =>
      this.publisher.getRelayUrlsForPublish(event, { useOptimizedRelays: false })));
    if (relayUrls.some(urls => urls.length === 0)) {
      throw new Error($localize`:@@scheduled.noRelays:Configure a write relay before scheduling a post.`);
    }
    await (await this.db()).add('posts', {
      id: first.id, events, relayUrls, nextEvent: 0, attempts: 0, retryAt: 0, leaseUntil: 0, claim: 0,
    });
    await this.refresh();
    this.armTimer();
  }

  async cancel(id: string): Promise<void> {
    const tx = (await this.db()).transaction('posts', 'readwrite');
    const post = await tx.store.get(id);
    if (post && post.leaseUntil > Date.now()) {
      await tx.done;
      throw new Error($localize`:@@scheduled.busy:This post is being published. Try again shortly.`);
    }
    await tx.store.delete(id);
    await tx.done;
    await this.refresh();
  }

  async retry(id: string): Promise<void> {
    const tx = (await this.db()).transaction('posts', 'readwrite');
    const post = await tx.store.get(id);
    if (post && post.leaseUntil <= Date.now()) {
      await tx.store.put({ ...post, retryAt: 0 });
    }
    await tx.done;
    await this.processDue();
  }

  async processDue(): Promise<void> {
    if (!this.isBrowser || this.running || this.destroyed) return;
    this.running = true;
    clearTimeout(this.timer);
    try {
      await this.refresh();
      for (const candidate of this.posts()) {
        if (this.destroyed) break;
        // An IndexedDB transaction claims each item across tabs. An interrupted attempt
        // can be retried after the lease expires, always with the same signed event ID.
        const db = await this.db();
        const tx = db.transaction('posts', 'readwrite');
        const post = await tx.store.get(candidate.id);
        const now = Date.now();
        if (!post || post.events[0].created_at * 1000 > now ||
          post.retryAt > now || post.leaseUntil > now) {
          await tx.done;
          continue;
        }
        post.leaseUntil = now + 60_000;
        post.claim++;
        await tx.store.put(post);
        await tx.done;
        await this.refresh();
        try {
          while (post.nextEvent < post.events.length) {
            const result = await this.publisher.publish(post.events[post.nextEvent], {
              relayUrls: post.relayUrls[post.nextEvent], useOptimizedRelays: false,
            });
            if (!result.success) throw new Error('No relay accepted the scheduled post');
            post.nextEvent++;
            post.leaseUntil = Date.now() + 60_000;
            if (!await this.saveClaim(post)) break;
          }
          if (post.nextEvent === post.events.length) await this.saveClaim(post, true);
        } catch {
          post.attempts++;
          post.retryAt = Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(post.attempts - 1, 4));
          post.leaseUntil = 0;
          await this.saveClaim(post);
        }
      }
      await this.refresh();
      this._error.set(false);
    } catch {
      this._error.set(true);
    } finally {
      this.running = false;
      this.armTimer();
    }
  }

  private async saveClaim(post: ScheduledPost, remove = false): Promise<boolean> {
    const tx = (await this.db()).transaction('posts', 'readwrite');
    const current = await tx.store.get(post.id);
    const owned = current?.claim === post.claim;
    if (owned) {
      if (remove) await tx.store.delete(post.id);
      else await tx.store.put(post);
    }
    await tx.done;
    return owned;
  }

  private armTimer(): void {
    if (!this.started || this.destroyed) return;
    clearTimeout(this.timer);
    // Also poll for changes made in another tab and clock changes after device sleep.
    const next = Math.min(Date.now() + 15_000, ...this.posts().map(post =>
      Math.max(post.events[0].created_at * 1000, post.retryAt, post.leaseUntil)));
    this.timer = setTimeout(this.wake, Math.max(100, next - Date.now()));
  }
}
