import { inject, Component, OnInit } from '@angular/core';
import { Cache } from './cache';

@Component({
  selector: 'app-cache-example',
  standalone: true,
  template: `
    <div class="cache-example">
      <h2>Cache Service Examples</h2>

      <div class="stats">
        <h3>Cache Stats</h3>
        <p>Size: {{ cache.stats().size }} / {{ cache.stats().maxSize }}</p>
        <p>Hit Rate: {{ cache.getHitRate().toFixed(1) }}%</p>
        <p>Usage: {{ cache.getUsagePercentage().toFixed(1) }}%</p>
        <p>Hits: {{ cache.stats().hits }}</p>
        <p>Misses: {{ cache.stats().misses }}</p>
        <p>Evictions: {{ cache.stats().evictions }}</p>
      </div>

      <div class="actions">
        <button (click)="addTempData()">Add Temp Data (5s TTL)</button>
        <button (click)="addPersistentData()">Add Persistent Data</button>
        <button (click)="testLRU()">Test LRU Eviction</button>
        <button (click)="clearCache()">Clear Cache</button>
      </div>

      <div class="cache-contents">
        <h3>Cache Contents</h3>
        @for (key of cache.keys(); track key) {
          <div>{{ key }}: {{ cache.get(key) }}</div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .cache-example {
        padding: 20px;
        max-width: 800px;
        margin: 0 auto;
      }

      .stats {
        background: var(--mat-sys-surface-container);
        padding: 16px;
        border-radius: 8px;
        margin: 16px 0;
        box-shadow: var(--mat-sys-level1);
      }

      .actions {
        display: flex;
        gap: 8px;
        margin: 16px 0;
        flex-wrap: wrap;
      }

      .actions button {
        padding: 8px 16px;
        background: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }

      .cache-contents {
        background: var(--mat-sys-surface-container);
        padding: 16px;
        border-radius: 8px;
        margin: 16px 0;
        box-shadow: var(--mat-sys-level1);
      }
    `,
  ],
})
export class CacheExampleComponent implements OnInit {
  protected readonly cache = inject(Cache);

  ngOnInit(): void {
    // Configure cache with custom settings
    this.cache.configure({
      maxSize: 10,
      ttl: 30000, // 30 seconds default
    });
  }

  addTempData(): void {
    const timestamp = Date.now();
    this.cache.set(`temp_${timestamp}`, `Temporary data ${timestamp}`, {
      ttl: 5000, // 5 seconds
    });
  }

  addPersistentData(): void {
    const timestamp = Date.now();
    this.cache.set(`persistent_${timestamp}`, `Persistent data ${timestamp}`, {
      persistent: true, // Never expires
    });
  }

  testLRU(): void {
    // Add more items than maxSize to trigger LRU eviction
    for (let i = 0; i < 15; i++) {
      this.cache.set(`lru_test_${i}`, `LRU Test Item ${i}`);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// Example usage in a service or component
export class ExampleUsageService {
  private readonly cache = inject(Cache);

  async getUserData(userId: string): Promise<any> {
    // Try to get from cache first
    let userData = this.cache.get<any>(`user_${userId}`);

    if (!userData) {
      // Fetch from API if not in cache
      userData = await this.fetchUserFromAPI(userId);

      // Cache for 10 minutes
      this.cache.set(`user_${userId}`, userData, {
        ttl: 10 * 60 * 1000, // 10 minutes
      });
    }

    return userData;
  }

  cacheUserSettings(userId: string, settings: any): void {
    // Cache user settings permanently (until manually cleared)
    this.cache.set(`settings_${userId}`, settings, {
      persistent: true,
    });
  }

  cacheTempSearchResults(query: string, results: any[]): void {
    // Cache search results for 2 minutes with limited size
    this.cache.set(`search_${query}`, results, {
      ttl: 2 * 60 * 1000, // 2 minutes
      maxSize: 50, // Keep only 50 search results max
    });
  }

  private async fetchUserFromAPI(userId: string): Promise<any> {
    const response = await fetch(`/api/users/${userId}`);
    return response.json();
  }
}
