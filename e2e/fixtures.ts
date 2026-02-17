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
import { TestAuthHelper } from './helpers/auth';

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
 * Web Vitals metrics collected via PerformanceObserver
 */
interface WebVitalsMetrics {
  lcp?: number;  // Largest Contentful Paint (ms)
  fid?: number;  // First Input Delay (ms)
  cls?: number;  // Cumulative Layout Shift
  ttfb?: number; // Time to First Byte (ms)
  fcp?: number;  // First Contentful Paint (ms)
}

/**
 * Performance metrics result from the performanceMetrics fixture
 */
interface PerformanceMetricsResult {
  webVitals: WebVitalsMetrics;
  navigationTiming: Record<string, number>;
  save: (testName: string) => Promise<void>;
}

/**
 * Tracked network request summary
 */
interface NetworkRequestEntry {
  url: string;
  method: string;
  status?: number;
  resourceType: string;
  startTime: number;
  duration?: number;
  failed: boolean;
  failureText?: string;
}

/**
 * WebSocket connection summary
 */
interface WebSocketEntry {
  url: string;
  connectedAt: number;
  closedAt?: number;
  messagesSent: number;
  messagesReceived: number;
}

/**
 * Network monitor result from the networkMonitor fixture
 */
interface NetworkMonitorResult {
  requests: NetworkRequestEntry[];
  webSockets: WebSocketEntry[];
  failedRequests: NetworkRequestEntry[];
  save: (testName: string) => Promise<void>;
}

/**
 * Console analysis category summary
 */
interface ConsoleAnalysisResult {
  totalLogs: number;
  errors: ConsoleLogEntry[];
  warnings: ConsoleLogEntry[];
  nostrLogs: ConsoleLogEntry[];
  angularLogs: ConsoleLogEntry[];
  networkLogs: ConsoleLogEntry[];
  debugLogs: ConsoleLogEntry[];
  categorySummary: Record<string, number>;
  save: (testName: string) => Promise<void>;
}

/**
 * Memory usage snapshot
 */
interface MemorySnapshot {
  timestamp: number;
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/**
 * Memory monitor result from the memoryMonitor fixture
 */
interface MemoryMonitorResult {
  snapshots: MemorySnapshot[];
  capture: () => Promise<MemorySnapshot | null>;
  getDelta: () => { startMB: number; endMB: number; deltaMB: number; potentialLeak: boolean } | null;
  save: (testName: string) => Promise<void>;
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
  authenticatedPage: Page;
  performanceMetrics: PerformanceMetricsResult;
  networkMonitor: NetworkMonitorResult;
  consoleAnalyzer: ConsoleAnalysisResult;
  memoryMonitor: MemoryMonitorResult;
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
    await page.addInitScript(() => {
      const originalSend = WebSocket.prototype.send;

      WebSocket.prototype.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        try {
          if (typeof data === 'string' && data.startsWith('[')) {
            const parsed = JSON.parse(data) as unknown;
            if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
              const messageType = parsed[0].toUpperCase();

              if (messageType === 'EVENT' || messageType === 'AUTH') {
                console.warn(`[E2E Read-Only Guard] Blocked outgoing Nostr message: ${messageType}`);
                return;
              }
            }
          }
        } catch {
          // If parsing fails, keep default behavior
        }

        originalSend.call(this, data);
      };
    });

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

  /**
   * Pre-authenticated page fixture.
   *
   * Injects auth via TestAuthHelper.injectAuth(page) before yielding,
   * then clears auth via clearAuth(page) after the test completes.
   * Uses TEST_NSEC from env or auto-generates a throwaway keypair.
   */
  authenticatedPage: async ({ page, consoleLogs }, use) => {
    const { auth } = TestAuthHelper.fromEnvOrGenerate();
    await auth.injectAuth(page);

    await use(page);

    await auth.clearAuth(page);
  },

  /**
   * Performance metrics fixture.
   *
   * Collects Web Vitals (LCP, FID, CLS, TTFB, FCP) via page.evaluate()
   * using the PerformanceObserver API. Stores results in
   * test-results/metrics/.
   */
  performanceMetrics: async ({ page }, use) => {
    const webVitals: WebVitalsMetrics = {};
    const navigationTiming: Record<string, number> = {};

    // Inject PerformanceObserver to collect Web Vitals
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__webVitals = {};
      const vitals = (window as unknown as Record<string, Record<string, number>>).__webVitals;

      // LCP
      try {
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            vitals['lcp'] = entries[entries.length - 1].startTime;
          }
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch { /* not supported */ }

      // FID
      try {
        const fidObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries() as PerformanceEventTiming[];
          if (entries.length > 0) {
            vitals['fid'] = entries[0].processingStart - entries[0].startTime;
          }
        });
        fidObserver.observe({ type: 'first-input', buffered: true });
      } catch { /* not supported */ }

      // CLS
      try {
        let clsValue = 0;
        const clsObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!(entry as unknown as { hadRecentInput: boolean }).hadRecentInput) {
              clsValue += (entry as unknown as { value: number }).value;
            }
          }
          vitals['cls'] = clsValue;
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });
      } catch { /* not supported */ }

      // FCP
      try {
        const fcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntriesByName('first-contentful-paint');
          if (entries.length > 0) {
            vitals['fcp'] = entries[0].startTime;
          }
        });
        fcpObserver.observe({ type: 'paint', buffered: true });
      } catch { /* not supported */ }
    });

    const collectMetrics = async () => {
      // Collect Web Vitals from the injected observer
      const collected = await page.evaluate(() => {
        const vitals = (window as unknown as Record<string, Record<string, number>>).__webVitals || {};
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        return {
          vitals,
          navigation: nav ? {
            domContentLoaded: nav.domContentLoadedEventEnd,
            loadComplete: nav.loadEventEnd,
            ttfb: nav.responseStart - nav.requestStart,
            dnsLookup: nav.domainLookupEnd - nav.domainLookupStart,
            tcpConnect: nav.connectEnd - nav.connectStart,
            domInteractive: nav.domInteractive,
            domComplete: nav.domComplete,
          } : {},
        };
      });

      Object.assign(webVitals, collected.vitals);
      if (collected.navigation.ttfb !== undefined) {
        webVitals.ttfb = collected.navigation.ttfb;
      }
      Object.assign(navigationTiming, collected.navigation);
    };

    const save = async (testName: string) => {
      await collectMetrics();
      const metricsDir = path.join(process.cwd(), 'test-results', 'metrics');
      if (!fs.existsSync(metricsDir)) {
        fs.mkdirSync(metricsDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${testName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.json`;
      fs.writeFileSync(
        path.join(metricsDir, filename),
        JSON.stringify({ webVitals, navigationTiming, collectedAt: new Date().toISOString() }, null, 2)
      );
    };

    await use({ webVitals, navigationTiming, save });
  },

  /**
   * Network monitor fixture.
   *
   * Tracks all HTTP requests, WebSocket connections, and failed requests.
   * Saves a summary JSON to test-results/network/.
   */
  networkMonitor: async ({ page }, use) => {
    const requests: NetworkRequestEntry[] = [];
    const webSockets: WebSocketEntry[] = [];
    const failedRequests: NetworkRequestEntry[] = [];
    const wsMap = new Map<string, WebSocketEntry>();

    // Track HTTP requests
    page.on('request', (request) => {
      const entry: NetworkRequestEntry = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        startTime: Date.now(),
        failed: false,
      };
      requests.push(entry);
    });

    page.on('response', (response) => {
      const url = response.url();
      const req = requests.find(r => r.url === url && r.status === undefined);
      if (req) {
        req.status = response.status();
        req.duration = Date.now() - req.startTime;
      }
    });

    page.on('requestfailed', (request) => {
      const entry: NetworkRequestEntry = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        startTime: Date.now(),
        failed: true,
        failureText: request.failure()?.errorText,
      };
      failedRequests.push(entry);
    });

    // Track WebSocket connections via page console (ws:// URLs in requests)
    page.on('request', (request) => {
      if (request.url().startsWith('ws://') || request.url().startsWith('wss://')) {
        const wsEntry: WebSocketEntry = {
          url: request.url(),
          connectedAt: Date.now(),
          messagesSent: 0,
          messagesReceived: 0,
        };
        wsMap.set(request.url(), wsEntry);
        webSockets.push(wsEntry);
      }
    });

    const save = async (testName: string) => {
      const networkDir = path.join(process.cwd(), 'test-results', 'network');
      if (!fs.existsSync(networkDir)) {
        fs.mkdirSync(networkDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${testName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.json`;
      fs.writeFileSync(
        path.join(networkDir, filename),
        JSON.stringify({
          summary: {
            totalRequests: requests.length,
            failedRequests: failedRequests.length,
            webSocketConnections: webSockets.length,
          },
          requests: requests.slice(0, 100), // Cap at 100 to avoid huge files
          failedRequests,
          webSockets,
          collectedAt: new Date().toISOString(),
        }, null, 2)
      );
    };

    await use({ requests, webSockets, failedRequests, save });
  },

  /**
   * Console analyzer fixture.
   *
   * Extends the consoleLogs fixture to categorize logs by severity,
   * detect Nostr-specific log patterns, and produce a structured report.
   */
  consoleAnalyzer: async ({ consoleLogs }, use) => {
    const nostrPrefixes = [
      '[AccountStateService]',
      '[Profile Loading]',
      '[Cache]',
      '[SubscriptionCache]',
      '[RelayService]',
      '[MediaPlayer]',
    ];

    const categorize = (): ConsoleAnalysisResult => {
      const errors: ConsoleLogEntry[] = [];
      const warnings: ConsoleLogEntry[] = [];
      const nostrLogs: ConsoleLogEntry[] = [];
      const angularLogs: ConsoleLogEntry[] = [];
      const networkLogs: ConsoleLogEntry[] = [];
      const debugLogs: ConsoleLogEntry[] = [];

      for (const log of consoleLogs) {
        // Categorize by type
        if (log.type === 'error' || log.type === 'pageerror') {
          errors.push(log);
        } else if (log.type === 'warning') {
          warnings.push(log);
        }

        // Categorize by content
        if (nostrPrefixes.some(prefix => log.text.includes(prefix))) {
          nostrLogs.push(log);
        } else if (log.text.includes('Angular') || log.text.includes('NG0') || log.text.includes('ExpressionChanged')) {
          angularLogs.push(log);
        } else if (log.type === 'requestfailed' || log.text.includes('net::') || log.text.includes('ERR_')) {
          networkLogs.push(log);
        } else if (log.type === 'log' || log.type === 'debug') {
          debugLogs.push(log);
        }
      }

      return {
        totalLogs: consoleLogs.length,
        errors,
        warnings,
        nostrLogs,
        angularLogs,
        networkLogs,
        debugLogs,
        categorySummary: {
          errors: errors.length,
          warnings: warnings.length,
          nostr: nostrLogs.length,
          angular: angularLogs.length,
          network: networkLogs.length,
          debug: debugLogs.length,
        },
        save: async (testName: string) => {
          const reportsDir = path.join(process.cwd(), 'test-results', 'reports');
          if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `console-analysis-${testName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.json`;
          const result = categorize();
          fs.writeFileSync(
            path.join(reportsDir, filename),
            JSON.stringify({
              totalLogs: result.totalLogs,
              categorySummary: result.categorySummary,
              errors: result.errors,
              warnings: result.warnings,
              nostrLogs: result.nostrLogs.slice(0, 50),
              angularLogs: result.angularLogs,
              networkLogs: result.networkLogs,
              collectedAt: new Date().toISOString(),
            }, null, 2)
          );
        },
      };
    };

    // Use a proxy that re-categorizes on access so it always has fresh data
    const result = categorize();
    await use(result);
  },

  /**
   * Memory monitor fixture.
   *
   * Captures performance.memory (Chrome only) at test start and end,
   * computes memory delta, and flags potential memory leaks if growth
   * exceeds a threshold (50MB).
   */
  memoryMonitor: async ({ page }, use) => {
    const LEAK_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50MB
    const snapshots: MemorySnapshot[] = [];

    const capture = async (): Promise<MemorySnapshot | null> => {
      const memory = await page.evaluate(() => {
        const perf = performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
        if (!perf.memory) return null;
        return {
          usedJSHeapSize: perf.memory.usedJSHeapSize,
          totalJSHeapSize: perf.memory.totalJSHeapSize,
          jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
        };
      });

      if (!memory) return null;

      const snapshot: MemorySnapshot = {
        timestamp: Date.now(),
        ...memory,
      };
      snapshots.push(snapshot);
      return snapshot;
    };

    const getDelta = () => {
      if (snapshots.length < 2) return null;
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const deltaMB = (last.usedJSHeapSize - first.usedJSHeapSize) / (1024 * 1024);
      return {
        startMB: first.usedJSHeapSize / (1024 * 1024),
        endMB: last.usedJSHeapSize / (1024 * 1024),
        deltaMB,
        potentialLeak: (last.usedJSHeapSize - first.usedJSHeapSize) > LEAK_THRESHOLD_BYTES,
      };
    };

    const save = async (testName: string) => {
      const metricsDir = path.join(process.cwd(), 'test-results', 'metrics');
      if (!fs.existsSync(metricsDir)) {
        fs.mkdirSync(metricsDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `memory-${testName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.json`;
      const delta = getDelta();
      fs.writeFileSync(
        path.join(metricsDir, filename),
        JSON.stringify({
          snapshots,
          delta,
          collectedAt: new Date().toISOString(),
        }, null, 2)
      );
    };

    // Capture initial snapshot
    await capture();

    await use({ snapshots, capture, getDelta, save });
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
   * Generate a test keypair for testing using nostr-tools.
   *
   * Delegates to `TestAuthHelper.getTestKeypair()` which uses
   * `generateSecretKey()` and `getPublicKey()` from `nostr-tools/pure`
   * to create a cryptographically random keypair.
   *
   * Note: The `seed` parameter is accepted for API compatibility but ignored.
   * Each call generates a fresh random keypair.
   *
   * @returns `{ pubkey, privkey }` — both as 64-character hex strings
   */
  static generateTestKeypair(_seed?: string): { pubkey: string; privkey: string } {
    const keypair = TestAuthHelper.getTestKeypair();
    return {
      privkey: keypair.privkeyHex,
      pubkey: keypair.pubkey,
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
