/**
 * Playwright Test Fixtures and Utilities
 *
 * Extended test fixtures for AI-friendly automation:
 * - Console log capture
 * - Screenshot helpers
 * - Nostr-specific utilities
 * - Error reporting
 */
import { test as base, expect, Page, BrowserContext, ConsoleMessage } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Console log entry for AI analysis
 */
interface ConsoleLogEntry {
  timestamp: string;
  type: string;
  text: string;
  location?: {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
}

/**
 * Test context with additional utilities
 */
interface TestContext {
  consoleLogs: ConsoleLogEntry[];
  captureScreenshot: (name: string) => Promise<string>;
  waitForNostrReady: () => Promise<void>;
  clearConsoleLogs: () => void;
  getConsoleLogs: () => ConsoleLogEntry[];
  saveConsoleLogs: (testName: string) => Promise<void>;
}

/**
 * Extended test fixture with AI-friendly utilities
 */
export const test = base.extend<TestContext>({
  consoleLogs: [[], { option: true }],

  /**
   * Capture a named screenshot and return the file path
   */
  captureScreenshot: async ({ page }, use) => {
    const captureScreenshot = async (name: string): Promise<string> => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotDir = path.join(process.cwd(), 'test-results', 'screenshots');

      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }

      const filename = `${name}-${timestamp}.png`;
      const filepath = path.join(screenshotDir, filename);

      await page.screenshot({
        path: filepath,
        fullPage: true,
      });

      console.log(`📸 Screenshot saved: ${filepath}`);
      return filepath;
    };

    await use(captureScreenshot);
  },

  /**
   * Wait for Nostria app to be fully loaded and ready
   */
  waitForNostrReady: async ({ page }, use) => {
    const waitForNostrReady = async (): Promise<void> => {
      // Wait for Angular to be ready
      await page.waitForFunction(() => {
        // Check if Angular is bootstrapped
        const appRoot = document.querySelector('app-root');
        if (!appRoot) return false;

        // Check if main content is rendered
        const mainContent = document.querySelector('mat-sidenav-content, .main-content, main');
        return !!mainContent;
      }, { timeout: 30000 });

      // Additional wait for any loading indicators to disappear
      await page.waitForTimeout(500);

      // Wait for network to be mostly idle
      await page.waitForLoadState('networkidle');
    };

    await use(waitForNostrReady);
  },

  /**
   * Clear collected console logs
   */
  clearConsoleLogs: async ({ consoleLogs }, use) => {
    const clearConsoleLogs = (): void => {
      consoleLogs.length = 0;
    };

    await use(clearConsoleLogs);
  },

  /**
   * Get current console logs
   */
  getConsoleLogs: async ({ consoleLogs }, use) => {
    const getConsoleLogs = (): ConsoleLogEntry[] => {
      return [...consoleLogs];
    };

    await use(getConsoleLogs);
  },

  /**
   * Save console logs to a file for AI analysis
   */
  saveConsoleLogs: async ({ consoleLogs }, use) => {
    const saveConsoleLogs = async (testName: string): Promise<void> => {
      const logsDir = path.join(process.cwd(), 'test-results', 'logs');

      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${testName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.json`;
      const filepath = path.join(logsDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(consoleLogs, null, 2));
      console.log(`📝 Console logs saved: ${filepath}`);
    };

    await use(saveConsoleLogs);
  },

  /**
   * Automatically collect console logs
   */
  page: async ({ page, consoleLogs }, use) => {
    // Set up console log collection
    page.on('console', (msg: ConsoleMessage) => {
      const entry: ConsoleLogEntry = {
        timestamp: new Date().toISOString(),
        type: msg.type(),
        text: msg.text(),
        location: msg.location() ? {
          url: msg.location().url,
          lineNumber: msg.location().lineNumber,
          columnNumber: msg.location().columnNumber,
        } : undefined,
      };
      consoleLogs.push(entry);

      // Also log errors to test output for immediate visibility
      if (msg.type() === 'error') {
        console.error(`🔴 Console Error: ${msg.text()}`);
      }
    });

    // Capture page errors
    page.on('pageerror', (error) => {
      consoleLogs.push({
        timestamp: new Date().toISOString(),
        type: 'pageerror',
        text: error.message,
      });
      console.error(`🔴 Page Error: ${error.message}`);
    });

    // Capture request failures
    page.on('requestfailed', (request) => {
      consoleLogs.push({
        timestamp: new Date().toISOString(),
        type: 'requestfailed',
        text: `${request.method()} ${request.url()} - ${request.failure()?.errorText}`,
      });
    });

    await use(page);
  },
});

export { expect };

/**
 * Page Object Model base class
 */
export abstract class BasePage {
  constructor(protected page: Page) { }

  /**
   * Navigate to this page
   */
  abstract goto(): Promise<void>;

  /**
   * Wait for the page to be ready
   */
  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get current URL
   */
  getUrl(): string {
    return this.page.url();
  }

  /**
   * Take a screenshot with a descriptive name
   */
  async screenshot(name: string): Promise<void> {
    const screenshotDir = path.join(process.cwd(), 'test-results', 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await this.page.screenshot({
      path: path.join(screenshotDir, `${name}-${timestamp}.png`),
      fullPage: true,
    });
  }
}

/**
 * Nostr-specific test utilities
 */
export class NostrTestUtils {
  constructor(private page: Page) { }

  /**
   * Generate a test keypair for testing
   * Note: Uses a deterministic seed for reproducible tests
   */
  static generateTestKeypair(seed = 'test-seed'): { pubkey: string; privkey: string } {
    // In real tests, you'd use nostr-tools to generate proper keypairs
    // This is a placeholder that should be replaced with actual implementation
    const encoder = new TextEncoder();
    const data = encoder.encode(seed);

    // Simple deterministic "keypair" for testing - replace with nostr-tools
    const privkeyHex = Array.from(new Uint8Array(32))
      .map((_, i) => ((data[i % data.length] + i) % 256).toString(16).padStart(2, '0'))
      .join('');

    return {
      privkey: privkeyHex,
      pubkey: privkeyHex, // In reality, this would be derived from privkey
    };
  }

  /**
   * Wait for a specific Nostr event kind to appear
   */
  async waitForEventKind(kind: number, timeout = 10000): Promise<void> {
    await this.page.waitForFunction(
      (k) => {
        // Check if events of this kind exist in the page
        const events = (window as unknown as { nostrEvents?: { kind: number }[] }).nostrEvents;
        return events?.some((e) => e.kind === k);
      },
      kind,
      { timeout }
    );
  }

  /**
   * Get all visible notes/events on the page
   */
  async getVisibleNotes(): Promise<string[]> {
    return await this.page.evaluate(() => {
      const noteElements = document.querySelectorAll('[data-note-id], .note-content, app-event');
      return Array.from(noteElements).map((el) => el.textContent || '');
    });
  }
}
