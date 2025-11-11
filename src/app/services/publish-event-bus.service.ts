import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { Event } from 'nostr-tools';

/**
 * Types of publish events that can be emitted
 */
export type PublishEventType = 'started' | 'relay-result' | 'completed' | 'error';

/**
 * Base publish event structure
 */
export interface PublishEvent {
  type: PublishEventType;
  event: Event;
  timestamp: number;
}

/**
 * Event emitted when publishing starts
 */
export interface PublishStartedEvent extends PublishEvent {
  type: 'started';
  relayUrls: string[];
}

/**
 * Event emitted for each relay result (success or failure)
 */
export interface PublishRelayResultEvent extends PublishEvent {
  type: 'relay-result';
  relayUrl: string;
  success: boolean;
  error?: string;
}

/**
 * Event emitted when all publishing is complete
 */
export interface PublishCompletedEvent extends PublishEvent {
  type: 'completed';
  relayResults: Map<string, { success: boolean; error?: string }>;
  success: boolean; // Overall success if at least one relay succeeded
}

/**
 * Event emitted when a critical publishing error occurs
 */
export interface PublishErrorEvent extends PublishEvent {
  type: 'error';
  error: Error;
}

/**
 * Union type of all publish events
 */
export type PublishEventUnion =
  | PublishStartedEvent
  | PublishRelayResultEvent
  | PublishCompletedEvent
  | PublishErrorEvent;

/**
 * Event bus for publishing events.
 * Decouples PublishService from NotificationService to avoid circular dependencies.
 * 
 * Usage:
 * - PublishService emits events as publishing progresses
 * - NotificationService subscribes to these events to create notifications
 * - No direct dependency between the two services
 */
@Injectable({
  providedIn: 'root',
})
export class PublishEventBus {
  private events$ = new Subject<PublishEventUnion>();

  /**
   * Emit a publish event
   */
  emit(event: PublishEventUnion): void {
    this.events$.next(event);
  }

  /**
   * Subscribe to all publish events
   */
  get events(): Observable<PublishEventUnion> {
    return this.events$.asObservable();
  }

  /**
   * Subscribe to specific event types
   */
  on(type: PublishEventType): Observable<PublishEventUnion> {
    return new Observable(observer => {
      const subscription = this.events$.subscribe(event => {
        if (event.type === type) {
          observer.next(event);
        }
      });
      return () => subscription.unsubscribe();
    });
  }
}
