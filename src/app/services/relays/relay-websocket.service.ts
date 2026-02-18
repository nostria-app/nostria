import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import { LoggerService } from '../logger.service';
import { UtilitiesService } from '../utilities.service';
import { RelayBlockService } from './relay-block.service';

type RelayWebSocketEventHandler = ((event: Event) => void) | null;
type RelayMessageEventHandler = ((event: MessageEvent) => void) | null;

class RelayTrackingWebSocket implements WebSocket {
  static CONNECTING = WebSocket.CONNECTING;
  static OPEN = WebSocket.OPEN;
  static CLOSING = WebSocket.CLOSING;
  static CLOSED = WebSocket.CLOSED;

  static configure(
    relayBlock: RelayBlockService,
    utilities: UtilitiesService,
    logger: LoggerService,
  ): void {
    RelayTrackingWebSocket.relayBlock = relayBlock;
    RelayTrackingWebSocket.utilities = utilities;
    RelayTrackingWebSocket.logger = logger;
  }

  private static relayBlock?: RelayBlockService;
  private static utilities?: UtilitiesService;
  private static logger?: LoggerService;

  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;

  private socket!: WebSocket;
  private opened = false;

  onopen: RelayWebSocketEventHandler = null;
  onclose: RelayWebSocketEventHandler = null;
  onerror: RelayWebSocketEventHandler = null;
  onmessage: RelayMessageEventHandler = null;

  constructor(url: string | URL, protocols?: string | string[]) {
    // Check if this relay URL is already blocked before creating a real WebSocket.
    // When nostr-tools' AbstractRelay.reconnect() creates a new WebSocket for a blocked relay,
    // throwing here causes connect() to reject without triggering handleHardClose(),
    // which stops the infinite reconnection loop.
    const relayBlock = RelayTrackingWebSocket.relayBlock;
    if (relayBlock) {
      const normalizedUrl = RelayTrackingWebSocket.normalizeRelayUrl(url.toString());
      if (relayBlock.isBlocked(normalizedUrl)) {
        RelayTrackingWebSocket.logger?.debug('[RelayWebSocket] Blocking reconnection attempt to blocked relay', {
          relay: normalizedUrl,
        });
        throw new Error(`Relay ${normalizedUrl} is blocked, skipping connection`);
      }
    }

    this.socket = protocols ? new WebSocket(url, protocols) : new WebSocket(url);

    this.socket.onopen = (event) => {
      this.opened = true;
      this.markConnectionSuccess();
      this.onopen?.(event);
    };

    this.socket.onerror = (event) => {
      if (!this.opened) {
        const reason = (event as ErrorEvent).message || 'websocket error';
        this.blockForConnectionFailure(reason);
      }
      this.onerror?.(event);
    };

    this.socket.onclose = (event) => {
      if (!this.opened) {
        const reason = event.reason || 'websocket closed';
        this.blockForConnectionFailure(reason);
      }
      this.onclose?.(event);
    };

    this.socket.onmessage = (event) => {
      this.onmessage?.(event);
    };
  }

  get url(): string {
    return this.socket.url;
  }

  get readyState(): number {
    return this.socket.readyState;
  }

  get bufferedAmount(): number {
    return this.socket.bufferedAmount;
  }

  get extensions(): string {
    return this.socket.extensions;
  }

  get protocol(): string {
    return this.socket.protocol;
  }

  get binaryType(): BinaryType {
    return this.socket.binaryType;
  }

  set binaryType(type: BinaryType) {
    this.socket.binaryType = type;
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.socket.send(data);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.socket.addEventListener(type, listener, options);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    this.socket.removeEventListener(type, listener, options);
  }

  dispatchEvent(event: Event): boolean {
    return this.socket.dispatchEvent(event);
  }

  private blockForConnectionFailure(reason: string): void {
    const utilities = RelayTrackingWebSocket.utilities;
    const relayBlock = RelayTrackingWebSocket.relayBlock;

    if (!utilities || !relayBlock) {
      return;
    }

    const normalizedUrl = RelayTrackingWebSocket.normalizeRelayUrl(this.socket.url);
    relayBlock.recordFailure(normalizedUrl, reason, false);
    RelayTrackingWebSocket.logger?.debug('[RelayWebSocket] Recorded relay connection failure', {
      relay: normalizedUrl,
      reason,
    });
  }

  private markConnectionSuccess(): void {
    const utilities = RelayTrackingWebSocket.utilities;
    const relayBlock = RelayTrackingWebSocket.relayBlock;

    if (!utilities || !relayBlock) {
      return;
    }

    const normalizedUrl = RelayTrackingWebSocket.normalizeRelayUrl(this.socket.url);
    relayBlock.recordSuccess(normalizedUrl);
  }

  private static normalizeRelayUrl(url: string): string {
    const utilities = RelayTrackingWebSocket.utilities;
    if (!utilities) {
      return url;
    }

    const normalized = utilities.normalizeRelayUrl(url);
    if (normalized) {
      return normalized;
    }

    if (!url.startsWith('wss://')) {
      return url;
    }

    try {
      const parsedUrl = new URL(url);
      return `wss://${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ''}/`;
    } catch {
      return url;
    }
  }
}

@Injectable({
  providedIn: 'root',
})
export class RelayWebSocketService {
  private readonly relayBlock = inject(RelayBlockService);
  private readonly utilities = inject(UtilitiesService);
  private readonly logger = inject(LoggerService);
  private readonly platformId = inject(PLATFORM_ID);
  private initialized = false;

  initialize(): void {
    if (this.initialized) {
      return;
    }

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    RelayTrackingWebSocket.configure(this.relayBlock, this.utilities, this.logger);
    useWebSocketImplementation(RelayTrackingWebSocket);
    this.initialized = true;
  }
}
