/**
 * Console Log Analyzer
 *
 * Categorizes captured console logs into: errors, warnings, Nostr relay
 * messages, Angular lifecycle events, network issues, and application
 * debug logs. Provides pattern matching for known Nostr log prefixes,
 * error classification, report generation, and assertion helpers.
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Console log entry matching the shape captured by fixtures.ts
 */
export interface ConsoleLogEntry {
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
 * Structured data extracted from a Nostr-specific log message
 */
export interface NostrLogData {
  prefix: string;
  relayUrl?: string;
  eventKind?: number;
  subscriptionId?: string;
  messageType?: 'REQ' | 'EVENT' | 'EOSE' | 'NOTICE' | 'CLOSE' | 'OK' | 'AUTH';
  rawText: string;
}

/**
 * Error classification result
 */
export interface ClassifiedError {
  entry: ConsoleLogEntry;
  isExpected: boolean;
  category: 'relay' | 'network' | 'angular' | 'runtime' | 'resource' | 'unknown';
  reason: string;
}

/**
 * Console analysis report
 */
export interface ConsoleAnalysisReport {
  totalLogCount: number;
  countByType: Record<string, number>;
  top10MostFrequent: { message: string; count: number }[];
  uniqueErrors: string[];
  relayConnectionStats: {
    successCount: number;
    failureCount: number;
    relayUrls: string[];
  };
  warnings: string[];
  nostrLogSummary: {
    total: number;
    byPrefix: Record<string, number>;
    byMessageType: Record<string, number>;
  };
  classifiedErrors: ClassifiedError[];
  potentialIssues: string[];
  generatedAt: string;
}

/**
 * Known Nostr log prefixes to match against console output.
 */
const NOSTR_LOG_PREFIXES = [
  '[AccountStateService]',
  '[Profile Loading]',
  '[Cache]',
  '[SubscriptionCache]',
  '[RelayService]',
  '[MediaPlayer]',
  '[EventService]',
  '[ContactService]',
  '[FeedService]',
  '[NotificationService]',
  '[DraftService]',
];

/**
 * Patterns for Nostr relay protocol messages
 */
const RELAY_MESSAGE_PATTERNS: { pattern: RegExp; type: NostrLogData['messageType'] }[] = [
  { pattern: /\bREQ\b/, type: 'REQ' },
  { pattern: /\bEVENT\b/, type: 'EVENT' },
  { pattern: /\bEOSE\b/, type: 'EOSE' },
  { pattern: /\bNOTICE\b/, type: 'NOTICE' },
  { pattern: /\bCLOSE\b/, type: 'CLOSE' },
  { pattern: /\bOK\b/, type: 'OK' },
  { pattern: /\bAUTH\b/, type: 'AUTH' },
];

/**
 * Patterns for expected errors (not bugs)
 */
const EXPECTED_ERROR_PATTERNS: { pattern: RegExp; category: ClassifiedError['category']; reason: string }[] = [
  { pattern: /relay.*connection.*refused/i, category: 'relay', reason: 'Relay connection refused (relay may be offline)' },
  { pattern: /wss?:\/\/.*refused/i, category: 'relay', reason: 'WebSocket connection refused' },
  { pattern: /wss?:\/\/.*timeout/i, category: 'relay', reason: 'WebSocket connection timeout' },
  { pattern: /wss?:\/\/.*ECONNREFUSED/i, category: 'relay', reason: 'Relay ECONNREFUSED' },
  { pattern: /404.*profile.*image/i, category: 'resource', reason: 'Missing profile image (expected for test accounts)' },
  { pattern: /404.*avatar/i, category: 'resource', reason: 'Missing avatar image' },
  { pattern: /404.*banner/i, category: 'resource', reason: 'Missing banner image' },
  { pattern: /net::ERR_NAME_NOT_RESOLVED/i, category: 'network', reason: 'DNS resolution failed (may be expected for some relays)' },
  { pattern: /net::ERR_CONNECTION_REFUSED/i, category: 'network', reason: 'Connection refused (server not running)' },
  { pattern: /NOTICE.*rate.?limit/i, category: 'relay', reason: 'Relay rate limiting' },
  { pattern: /NOTICE.*too many/i, category: 'relay', reason: 'Too many connections/subscriptions' },
];

/**
 * Patterns for unexpected errors (potential bugs)
 */
const UNEXPECTED_ERROR_PATTERNS: { pattern: RegExp; category: ClassifiedError['category']; reason: string }[] = [
  { pattern: /TypeError/i, category: 'runtime', reason: 'TypeError — potential code bug' },
  { pattern: /ReferenceError/i, category: 'runtime', reason: 'ReferenceError — undefined variable' },
  { pattern: /SyntaxError/i, category: 'runtime', reason: 'SyntaxError — malformed code' },
  { pattern: /RangeError/i, category: 'runtime', reason: 'RangeError — value out of range' },
  { pattern: /unhandled.*promise.*rejection/i, category: 'runtime', reason: 'Unhandled promise rejection' },
  { pattern: /NG0\d+/i, category: 'angular', reason: 'Angular framework error' },
  { pattern: /ExpressionChangedAfterItHasBeenChecked/i, category: 'angular', reason: 'Angular change detection error' },
  { pattern: /Uncaught.*Error/i, category: 'runtime', reason: 'Uncaught error' },
  { pattern: /Angular.*error/i, category: 'angular', reason: 'Angular error' },
];

/**
 * ConsoleAnalyzer — categorizes and analyzes captured console logs.
 *
 * @example
 * ```ts
 * const analyzer = new ConsoleAnalyzer(consoleLogs);
 * const report = analyzer.generateReport();
 * await analyzer.saveReport('my-test');
 * ```
 */
export class ConsoleAnalyzer {
  private readonly logs: ConsoleLogEntry[];

  constructor(logs: ConsoleLogEntry[]) {
    this.logs = logs;
  }

  /**
   * Categorize all logs into buckets.
   */
  categorize(): {
    errors: ConsoleLogEntry[];
    warnings: ConsoleLogEntry[];
    nostrLogs: ConsoleLogEntry[];
    angularLogs: ConsoleLogEntry[];
    networkLogs: ConsoleLogEntry[];
    debugLogs: ConsoleLogEntry[];
  } {
    const errors: ConsoleLogEntry[] = [];
    const warnings: ConsoleLogEntry[] = [];
    const nostrLogs: ConsoleLogEntry[] = [];
    const angularLogs: ConsoleLogEntry[] = [];
    const networkLogs: ConsoleLogEntry[] = [];
    const debugLogs: ConsoleLogEntry[] = [];

    for (const log of this.logs) {
      if (log.type === 'error' || log.type === 'pageerror') {
        errors.push(log);
      } else if (log.type === 'warning') {
        warnings.push(log);
      }

      if (this.isNostrLog(log)) {
        nostrLogs.push(log);
      } else if (this.isAngularLog(log)) {
        angularLogs.push(log);
      } else if (this.isNetworkLog(log)) {
        networkLogs.push(log);
      } else if (log.type === 'log' || log.type === 'debug') {
        debugLogs.push(log);
      }
    }

    return { errors, warnings, nostrLogs, angularLogs, networkLogs, debugLogs };
  }

  /**
   * Extract structured data from Nostr-specific log messages.
   */
  extractNostrData(log: ConsoleLogEntry): NostrLogData | null {
    const matchedPrefix = NOSTR_LOG_PREFIXES.find(prefix => log.text.includes(prefix));
    if (!matchedPrefix && !this.isRelayMessage(log)) return null;

    const data: NostrLogData = {
      prefix: matchedPrefix || 'relay',
      rawText: log.text,
    };

    // Extract relay URL (wss://... or ws://...)
    const relayMatch = log.text.match(/wss?:\/\/[^\s,)"']+/);
    if (relayMatch) {
      data.relayUrl = relayMatch[0];
    }

    // Extract event kind
    const kindMatch = log.text.match(/kind[:\s]+(\d+)/i);
    if (kindMatch) {
      data.eventKind = parseInt(kindMatch[1], 10);
    }

    // Extract subscription ID
    const subMatch = log.text.match(/sub[:\s]+["']?([a-zA-Z0-9_-]+)["']?/i) ||
                     log.text.match(/subscription[:\s]+["']?([a-zA-Z0-9_-]+)["']?/i);
    if (subMatch) {
      data.subscriptionId = subMatch[1];
    }

    // Detect relay message type
    for (const { pattern, type } of RELAY_MESSAGE_PATTERNS) {
      if (pattern.test(log.text)) {
        data.messageType = type;
        break;
      }
    }

    return data;
  }

  /**
   * Classify an error as expected or unexpected.
   */
  classifyError(log: ConsoleLogEntry): ClassifiedError {
    // Check expected patterns first
    for (const { pattern, category, reason } of EXPECTED_ERROR_PATTERNS) {
      if (pattern.test(log.text)) {
        return { entry: log, isExpected: true, category, reason };
      }
    }

    // Check unexpected patterns
    for (const { pattern, category, reason } of UNEXPECTED_ERROR_PATTERNS) {
      if (pattern.test(log.text)) {
        return { entry: log, isExpected: false, category, reason };
      }
    }

    // Default: unexpected unknown error
    return {
      entry: log,
      isExpected: false,
      category: 'unknown',
      reason: 'Unclassified error',
    };
  }

  /**
   * Generate a comprehensive JSON analysis report.
   */
  generateReport(): ConsoleAnalysisReport {
    const { errors, warnings, nostrLogs } = this.categorize();

    // Count by type
    const countByType: Record<string, number> = {};
    for (const log of this.logs) {
      countByType[log.type] = (countByType[log.type] || 0) + 1;
    }

    // Top 10 most frequent messages
    const messageCounts = new Map<string, number>();
    for (const log of this.logs) {
      // Normalize the message by removing timestamps and dynamic values
      const normalized = log.text.replace(/\d{4}-\d{2}-\d{2}T[\d:.Z]+/g, '<timestamp>')
        .replace(/[0-9a-f]{64}/gi, '<hex64>')
        .replace(/\d+/g, '<n>');
      messageCounts.set(normalized, (messageCounts.get(normalized) || 0) + 1);
    }
    const top10MostFrequent = Array.from(messageCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => ({ message, count }));

    // Unique errors
    const uniqueErrors = [...new Set(errors.map(e => e.text))];

    // Relay connection stats
    const relayUrls = new Set<string>();
    let successCount = 0;
    let failureCount = 0;
    for (const log of nostrLogs) {
      const data = this.extractNostrData(log);
      if (data?.relayUrl) {
        relayUrls.add(data.relayUrl);
      }
      if (/connect.*success|connected/i.test(log.text)) successCount++;
      if (/connect.*fail|connection.*refused|connection.*error/i.test(log.text)) failureCount++;
    }

    // Nostr log summary
    const byPrefix: Record<string, number> = {};
    const byMessageType: Record<string, number> = {};
    for (const log of nostrLogs) {
      const data = this.extractNostrData(log);
      if (data) {
        byPrefix[data.prefix] = (byPrefix[data.prefix] || 0) + 1;
        if (data.messageType) {
          byMessageType[data.messageType] = (byMessageType[data.messageType] || 0) + 1;
        }
      }
    }

    // Classify all errors
    const classifiedErrors = errors.map(e => this.classifyError(e));

    // Potential issues
    const potentialIssues: string[] = [];
    const unexpectedErrors = classifiedErrors.filter(e => !e.isExpected);
    if (unexpectedErrors.length > 0) {
      potentialIssues.push(`${unexpectedErrors.length} unexpected error(s) detected`);
    }
    if (failureCount > successCount && failureCount > 0) {
      potentialIssues.push('More relay connection failures than successes');
    }
    const angularErrors = classifiedErrors.filter(e => e.category === 'angular');
    if (angularErrors.length > 0) {
      potentialIssues.push(`${angularErrors.length} Angular framework error(s)`);
    }

    return {
      totalLogCount: this.logs.length,
      countByType,
      top10MostFrequent,
      uniqueErrors,
      relayConnectionStats: {
        successCount,
        failureCount,
        relayUrls: [...relayUrls],
      },
      warnings: [...new Set(warnings.map(w => w.text))],
      nostrLogSummary: {
        total: nostrLogs.length,
        byPrefix,
        byMessageType,
      },
      classifiedErrors,
      potentialIssues,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Save the console analysis report to test-results/reports/.
   */
  async saveReport(testName?: string): Promise<string> {
    const reportsDir = path.join(process.cwd(), 'test-results', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = testName ? `${testName.replace(/[^a-zA-Z0-9]/g, '-')}-` : '';
    const filename = `console-analysis-${prefix}${timestamp}.json`;
    const filepath = path.join(reportsDir, filename);

    const report = this.generateReport();
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    return filepath;
  }

  // --- Private helpers ---

  private isNostrLog(log: ConsoleLogEntry): boolean {
    return NOSTR_LOG_PREFIXES.some(prefix => log.text.includes(prefix)) || this.isRelayMessage(log);
  }

  private isRelayMessage(log: ConsoleLogEntry): boolean {
    return RELAY_MESSAGE_PATTERNS.some(({ pattern }) => pattern.test(log.text)) ||
      /wss?:\/\//i.test(log.text);
  }

  private isAngularLog(log: ConsoleLogEntry): boolean {
    return /Angular|NG0\d+|ExpressionChanged|zone\.js|@angular/i.test(log.text);
  }

  private isNetworkLog(log: ConsoleLogEntry): boolean {
    return log.type === 'requestfailed' ||
      /net::|ERR_|fetch.*fail|XHR.*fail/i.test(log.text);
  }
}

// ============================================================
// Console Log Assertion Helpers
// ============================================================

/**
 * Assert that there are no unexpected errors in the console logs.
 *
 * Expected errors (relay connection failures, missing images, etc.)
 * are ignored. Only unexpected errors (TypeError, Angular errors,
 * unhandled rejections) cause assertion failure.
 *
 * @throws Error if any unexpected errors are found
 */
export function expectNoUnexpectedErrors(logs: ConsoleLogEntry[]): void {
  const analyzer = new ConsoleAnalyzer(logs);
  const { errors } = analyzer.categorize();
  const classified = errors.map(e => analyzer.classifyError(e));
  const unexpected = classified.filter(e => !e.isExpected);

  if (unexpected.length > 0) {
    const messages = unexpected.map(e =>
      `[${e.category}] ${e.reason}: ${e.entry.text.slice(0, 200)}`
    ).join('\n  ');
    throw new Error(
      `Found ${unexpected.length} unexpected console error(s):\n  ${messages}`
    );
  }
}

/**
 * Assert that relay connections were established.
 *
 * Checks that at least `minCount` relay-related log entries exist,
 * indicating the app attempted to connect to relays.
 *
 * @param logs - Console log entries
 * @param minCount - Minimum number of relay log entries expected (default 1)
 * @throws Error if fewer than minCount relay logs are found
 */
export function expectRelayConnections(logs: ConsoleLogEntry[], minCount = 1): void {
  const analyzer = new ConsoleAnalyzer(logs);
  const { nostrLogs } = analyzer.categorize();
  const relayLogs = nostrLogs.filter(l =>
    /wss?:\/\//i.test(l.text) || /relay/i.test(l.text)
  );

  if (relayLogs.length < minCount) {
    throw new Error(
      `Expected at least ${minCount} relay connection log(s), found ${relayLogs.length}`
    );
  }
}

/**
 * Assert that there are no Angular framework errors in the console.
 *
 * Checks for NG0xxx error codes, ExpressionChangedAfterItHasBeenChecked,
 * and other Angular-specific errors.
 *
 * @throws Error if any Angular errors are found
 */
export function expectNoAngularErrors(logs: ConsoleLogEntry[]): void {
  const analyzer = new ConsoleAnalyzer(logs);
  const { errors } = analyzer.categorize();
  const angularErrors = errors.filter(e =>
    /NG0\d+|ExpressionChanged|Angular.*error/i.test(e.text)
  );

  if (angularErrors.length > 0) {
    const messages = angularErrors.map(e => e.text.slice(0, 200)).join('\n  ');
    throw new Error(
      `Found ${angularErrors.length} Angular error(s):\n  ${messages}`
    );
  }
}
