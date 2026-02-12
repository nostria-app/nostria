/**
 * WebSocket Monitor Utility
 *
 * Intercepts WebSocket connections via CDP (Chrome DevTools Protocol)
 * using page.context().newCDPSession(page), logs all WebSocket frames
 * (sent/received), and categorizes Nostr protocol messages
 * (REQ, EVENT, EOSE, NOTICE, CLOSE, OK, AUTH, COUNT).
 *
 * Also tracks:
 * - Relay connection lifecycle (connect, disconnect, reconnect)
 * - Subscription management (REQ/CLOSE pairs, orphaned subscriptions)
 * - Event delivery counts per subscription
 */
import type { Page, CDPSession } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Nostr message types per NIP-01 and extensions.
 */
export type NostrMessageType = 'REQ' | 'EVENT' | 'EOSE' | 'NOTICE' | 'CLOSE' | 'OK' | 'AUTH' | 'COUNT' | 'UNKNOWN';

/**
 * A captured WebSocket frame.
 */
export interface WebSocketFrame {
  timestamp: number;
  direction: 'sent' | 'received';
  relayUrl: string;
  rawData: string;
  nostrType?: NostrMessageType;
  subscriptionId?: string;
  eventKind?: number;
  parsed?: unknown;
}

/**
 * Relay connection tracking entry.
 */
export interface RelayConnection {
  url: string;
  connectedAt?: number;
  disconnectedAt?: number;
  duration?: number;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
  reconnectCount: number;
  framesSent: number;
  framesReceived: number;
}

/**
 * Nostr subscription tracking entry.
 */
export interface SubscriptionTracker {
  id: string;
  relayUrl: string;
  createdAt: number;
  closedAt?: number;
  filters: unknown[];
  eventsReceived: number;
  eoseReceived: boolean;
  orphaned: boolean; // REQ without corresponding CLOSE
}

/**
 * WebSocket monitor summary report.
 */
export interface WebSocketMonitorReport {
  collectedAt: string;
  totalFramesSent: number;
  totalFramesReceived: number;
  relayConnections: RelayConnection[];
  subscriptions: SubscriptionTracker[];
  orphanedSubscriptions: SubscriptionTracker[];
  messageTypeBreakdown: Record<NostrMessageType, number>;
  eventKindBreakdown: Record<number, number>;
  errors: string[];
  frames: WebSocketFrame[]; // Capped to prevent huge files
}

/**
 * WebSocket monitor that uses CDP to intercept WebSocket traffic.
 *
 * @example
 * ```ts
 * const monitor = new WebSocketMonitor();
 * await monitor.attach(page);
 * // ... run test ...
 * const report = monitor.getReport();
 * await monitor.saveReport('test-name');
 * await monitor.detach();
 * ```
 */
export class WebSocketMonitor {
  private cdpSession: CDPSession | null = null;
  private frames: WebSocketFrame[] = [];
  private relayConnections = new Map<string, RelayConnection>();
  private subscriptions = new Map<string, SubscriptionTracker>();
  private requestIdToUrl = new Map<string, string>();
  private errors: string[] = [];

  /**
   * Attach to a page via CDP to intercept WebSocket traffic.
   */
  async attach(page: Page): Promise<void> {
    try {
      const context = page.context();
      this.cdpSession = await context.newCDPSession(page);

      // Enable network domain for WebSocket events
      await this.cdpSession.send('Network.enable');

      // Track WebSocket creation
      this.cdpSession.on('Network.webSocketCreated', (params: { requestId: string; url: string }) => {
        this.requestIdToUrl.set(params.requestId, params.url);
        this.trackRelayConnection(params.url, 'connecting');
      });

      // Track WebSocket handshake response
      this.cdpSession.on('Network.webSocketHandshakeResponseReceived', (params: { requestId: string }) => {
        const url = this.requestIdToUrl.get(params.requestId);
        if (url) {
          this.trackRelayConnection(url, 'connected');
        }
      });

      // Track WebSocket frames sent
      this.cdpSession.on('Network.webSocketFrameSent', (params: {
        requestId: string;
        timestamp: number;
        response: { payloadData: string };
      }) => {
        const url = this.requestIdToUrl.get(params.requestId) || 'unknown';
        this.handleFrame(url, 'sent', params.response.payloadData, params.timestamp);
      });

      // Track WebSocket frames received
      this.cdpSession.on('Network.webSocketFrameReceived', (params: {
        requestId: string;
        timestamp: number;
        response: { payloadData: string };
      }) => {
        const url = this.requestIdToUrl.get(params.requestId) || 'unknown';
        this.handleFrame(url, 'received', params.response.payloadData, params.timestamp);
      });

      // Track WebSocket errors
      this.cdpSession.on('Network.webSocketFrameError', (params: {
        requestId: string;
        errorMessage: string;
      }) => {
        const url = this.requestIdToUrl.get(params.requestId) || 'unknown';
        this.errors.push(`WebSocket error on ${url}: ${params.errorMessage}`);
        this.trackRelayConnection(url, 'error', params.errorMessage);
      });

      // Track WebSocket closed
      this.cdpSession.on('Network.webSocketClosed', (params: { requestId: string }) => {
        const url = this.requestIdToUrl.get(params.requestId);
        if (url) {
          this.trackRelayConnection(url, 'disconnected');
        }
      });
    } catch (err) {
      this.errors.push(`Failed to attach CDP session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Detach the CDP session.
   */
  async detach(): Promise<void> {
    if (this.cdpSession) {
      try {
        await this.cdpSession.detach();
      } catch {
        // Session may already be detached
      }
      this.cdpSession = null;
    }
  }

  /**
   * Track relay connection state changes.
   */
  private trackRelayConnection(url: string, status: RelayConnection['status'], errorMessage?: string): void {
    const existing = this.relayConnections.get(url);
    if (existing) {
      if (status === 'connected') {
        existing.connectedAt = Date.now();
        existing.status = 'connected';
        if (existing.disconnectedAt) {
          existing.reconnectCount++;
        }
      } else if (status === 'disconnected') {
        existing.disconnectedAt = Date.now();
        existing.status = 'disconnected';
        if (existing.connectedAt) {
          existing.duration = existing.disconnectedAt - existing.connectedAt;
        }
      } else if (status === 'error') {
        existing.status = 'error';
        existing.errorMessage = errorMessage;
      } else {
        existing.status = status;
      }
    } else {
      this.relayConnections.set(url, {
        url,
        connectedAt: status === 'connected' ? Date.now() : undefined,
        status,
        errorMessage,
        reconnectCount: 0,
        framesSent: 0,
        framesReceived: 0,
      });
    }
  }

  /**
   * Parse and handle a WebSocket frame.
   */
  private handleFrame(relayUrl: string, direction: 'sent' | 'received', rawData: string, timestamp: number): void {
    const frame: WebSocketFrame = {
      timestamp: timestamp * 1000, // CDP timestamps are in seconds
      direction,
      relayUrl,
      rawData: rawData.length > 2000 ? rawData.substring(0, 2000) + '...' : rawData,
    };

    // Update relay frame counts
    const relay = this.relayConnections.get(relayUrl);
    if (relay) {
      if (direction === 'sent') relay.framesSent++;
      else relay.framesReceived++;
    }

    // Try to parse as Nostr JSON
    try {
      const parsed = JSON.parse(rawData);
      if (Array.isArray(parsed) && parsed.length >= 1) {
        frame.parsed = parsed;
        const msgType = parsed[0] as string;
        frame.nostrType = this.classifyNostrMessage(msgType);

        // Extract details based on message type
        switch (frame.nostrType) {
          case 'REQ':
            if (parsed.length >= 3) {
              frame.subscriptionId = parsed[1];
              this.trackSubscription(parsed[1], relayUrl, parsed.slice(2));
            }
            break;
          case 'CLOSE':
            if (parsed.length >= 2) {
              frame.subscriptionId = parsed[1];
              this.closeSubscription(parsed[1]);
            }
            break;
          case 'EVENT':
            if (direction === 'received' && parsed.length >= 3) {
              frame.subscriptionId = parsed[1];
              const event = parsed[2];
              if (event && typeof event === 'object' && 'kind' in event) {
                frame.eventKind = event.kind;
              }
              this.countSubscriptionEvent(parsed[1]);
            }
            break;
          case 'EOSE':
            if (parsed.length >= 2) {
              frame.subscriptionId = parsed[1];
              this.markEose(parsed[1]);
            }
            break;
        }
      }
    } catch {
      // Not valid JSON, might be binary or other data
      frame.nostrType = 'UNKNOWN';
    }

    this.frames.push(frame);
  }

  /**
   * Classify a Nostr message type string.
   */
  private classifyNostrMessage(type: string): NostrMessageType {
    const known: NostrMessageType[] = ['REQ', 'EVENT', 'EOSE', 'NOTICE', 'CLOSE', 'OK', 'AUTH', 'COUNT'];
    return known.includes(type as NostrMessageType) ? (type as NostrMessageType) : 'UNKNOWN';
  }

  /**
   * Track a new subscription (REQ).
   */
  private trackSubscription(id: string, relayUrl: string, filters: unknown[]): void {
    this.subscriptions.set(`${relayUrl}:${id}`, {
      id,
      relayUrl,
      createdAt: Date.now(),
      filters,
      eventsReceived: 0,
      eoseReceived: false,
      orphaned: true, // Will be set to false when CLOSE is received
    });
  }

  /**
   * Close a subscription (CLOSE).
   */
  private closeSubscription(id: string): void {
    for (const [key, sub] of this.subscriptions) {
      if (sub.id === id && sub.orphaned) {
        sub.closedAt = Date.now();
        sub.orphaned = false;
        break;
      }
    }
  }

  /**
   * Count an event received for a subscription.
   */
  private countSubscriptionEvent(subscriptionId: string): void {
    for (const [, sub] of this.subscriptions) {
      if (sub.id === subscriptionId && !sub.closedAt) {
        sub.eventsReceived++;
        break;
      }
    }
  }

  /**
   * Mark EOSE received for a subscription.
   */
  private markEose(subscriptionId: string): void {
    for (const [, sub] of this.subscriptions) {
      if (sub.id === subscriptionId && !sub.eoseReceived) {
        sub.eoseReceived = true;
        break;
      }
    }
  }

  /**
   * Get all relay connections.
   */
  getRelayConnections(): RelayConnection[] {
    return Array.from(this.relayConnections.values());
  }

  /**
   * Get all subscriptions.
   */
  getSubscriptions(): SubscriptionTracker[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Get orphaned subscriptions (REQ without CLOSE).
   */
  getOrphanedSubscriptions(): SubscriptionTracker[] {
    return this.getSubscriptions().filter(s => s.orphaned);
  }

  /**
   * Get message type breakdown.
   */
  getMessageTypeBreakdown(): Record<NostrMessageType, number> {
    const breakdown: Record<string, number> = {};
    for (const frame of this.frames) {
      const type = frame.nostrType || 'UNKNOWN';
      breakdown[type] = (breakdown[type] || 0) + 1;
    }
    return breakdown as Record<NostrMessageType, number>;
  }

  /**
   * Get event kind breakdown.
   */
  getEventKindBreakdown(): Record<number, number> {
    const breakdown: Record<number, number> = {};
    for (const frame of this.frames) {
      if (frame.eventKind !== undefined) {
        breakdown[frame.eventKind] = (breakdown[frame.eventKind] || 0) + 1;
      }
    }
    return breakdown;
  }

  /**
   * Generate the full monitoring report.
   */
  getReport(): WebSocketMonitorReport {
    const sentFrames = this.frames.filter(f => f.direction === 'sent');
    const receivedFrames = this.frames.filter(f => f.direction === 'received');

    return {
      collectedAt: new Date().toISOString(),
      totalFramesSent: sentFrames.length,
      totalFramesReceived: receivedFrames.length,
      relayConnections: this.getRelayConnections(),
      subscriptions: this.getSubscriptions(),
      orphanedSubscriptions: this.getOrphanedSubscriptions(),
      messageTypeBreakdown: this.getMessageTypeBreakdown(),
      eventKindBreakdown: this.getEventKindBreakdown(),
      errors: this.errors,
      frames: this.frames.slice(0, 500), // Cap at 500 frames
    };
  }

  /**
   * Save the monitoring report to disk.
   */
  async saveReport(testName: string): Promise<string> {
    const networkDir = path.join(process.cwd(), 'test-results', 'network');
    if (!fs.existsSync(networkDir)) {
      fs.mkdirSync(networkDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ws-monitor-${testName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.json`;
    const filepath = path.join(networkDir, filename);

    const report = this.getReport();
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

    return filepath;
  }

  /**
   * Reset all collected data.
   */
  reset(): void {
    this.frames = [];
    this.relayConnections.clear();
    this.subscriptions.clear();
    this.requestIdToUrl.clear();
    this.errors = [];
  }
}
