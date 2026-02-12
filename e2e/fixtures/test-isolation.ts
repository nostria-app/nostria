/**
 * Test Isolation Helpers
 *
 * Functions to reset app state between tests to prevent test pollution.
 * Clears localStorage, sessionStorage, IndexedDB, and service worker caches.
 */
import { Page } from '@playwright/test';
import { STORAGE_KEYS } from './test-data';

/**
 * Clear all localStorage entries.
 */
export async function clearLocalStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.clear();
  });
}

/**
 * Clear all sessionStorage entries.
 */
export async function clearSessionStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.clear();
  });
}

/**
 * Clear only Nostria-specific localStorage keys.
 * Preserves any unrelated localStorage data.
 */
export async function clearNostriaStorage(page: Page): Promise<void> {
  await page.evaluate((keys) => {
    for (const key of Object.values(keys)) {
      localStorage.removeItem(key);
    }
    // Also clear any keys that start with 'nostria-'
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('nostria-')) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      localStorage.removeItem(k);
    }
  }, STORAGE_KEYS);
}

/**
 * Clear all IndexedDB databases.
 * This is particularly important for Nostr apps that cache events in IDB.
 */
export async function clearIndexedDB(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (!('indexedDB' in window)) return;

    // Get all database names
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });
}

/**
 * Unregister all service workers and clear their caches.
 */
export async function clearServiceWorkers(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return;

    // Unregister all service workers
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
    }

    // Clear all caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        await caches.delete(name);
      }
    }
  });
}

/**
 * Full app state reset — clears everything.
 * Call this between tests that need complete isolation.
 */
export async function resetAppState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Clear all storage
    localStorage.clear();
    sessionStorage.clear();

    // Clear IndexedDB
    if ('indexedDB' in window) {
      try {
        const databases = await indexedDB.databases();
        for (const db of databases) {
          if (db.name) {
            indexedDB.deleteDatabase(db.name);
          }
        }
      } catch {
        // indexedDB.databases() may not be supported in all browsers
      }
    }

    // Clear service workers and caches
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      } catch {
        // ignore
      }
    }

    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
        }
      } catch {
        // ignore
      }
    }
  });
}

/**
 * Set up a clean test environment with optional pre-configured state.
 *
 * @param page - Playwright page
 * @param options - Configuration options
 */
export async function setupCleanEnvironment(
  page: Page,
  options: {
    /** Clear all state before setting up */
    clearAll?: boolean;
    /** Set theme preference */
    theme?: 'light' | 'dark';
    /** Additional localStorage entries to set */
    localStorage?: Record<string, string>;
  } = {}
): Promise<void> {
  const { clearAll = true, theme, localStorage: extraStorage } = options;

  if (clearAll) {
    // Use addInitScript to clear state before page loads
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }

  if (theme) {
    await page.addInitScript(({ key, value }: { key: string; value: string }) => {
      localStorage.setItem(key, value);
    }, { key: STORAGE_KEYS.theme, value: theme });
  }

  if (extraStorage) {
    await page.addInitScript((entries: Record<string, string>) => {
      for (const [key, value] of Object.entries(entries)) {
        localStorage.setItem(key, value);
      }
    }, extraStorage);
  }
}

/**
 * Verify that the app state is clean (no residual auth or data).
 * Useful as a post-test assertion to ensure proper cleanup.
 */
export async function verifyCleanState(page: Page): Promise<{
  hasAuth: boolean;
  storageKeys: string[];
  indexedDBDatabases: number;
}> {
  return await page.evaluate(async (keys) => {
    const hasAuth = localStorage.getItem(keys.account) !== null
      || localStorage.getItem(keys.accounts) !== null;

    const storageKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) storageKeys.push(k);
    }

    let indexedDBDatabases = 0;
    try {
      if ('indexedDB' in window) {
        const dbs = await indexedDB.databases();
        indexedDBDatabases = dbs.length;
      }
    } catch {
      // ignore
    }

    return { hasAuth, storageKeys, indexedDBDatabases };
  }, STORAGE_KEYS);
}
