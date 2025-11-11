# Event Bus Implementation for Publish Notifications

## Summary

Implemented an event bus pattern to restore relay publishing notifications in the System tab without creating circular dependencies between services.

## Problem

Previously, relay publishing notifications were displayed by having `PublishService` directly inject and call `NotificationService`. This created a circular dependency:

```
NotificationService → AccountStateService → PublishService → NotificationService
```

To break this cycle, we removed the `NotificationService` dependency from `PublishService`, which eliminated the relay publishing notifications feature.

## Solution

Implemented a decoupled event bus pattern that allows `PublishService` to emit publishing events without knowing about `NotificationService`, and allows `NotificationService` to listen for these events without creating circular dependencies.

## Architecture

### 1. Event Bus Service (`publish-event-bus.service.ts`)

Central event broker that uses RxJS Subject/Observable pattern:

```typescript
type PublishEventType = 'started' | 'relay-result' | 'completed' | 'error';

interface PublishStartedEvent {
  type: 'started';
  event: Event;
  relayUrls: string[];
  timestamp: number;
}

interface PublishRelayResultEvent {
  type: 'relay-result';
  event: Event;
  relayUrl: string;
  success: boolean;
  error?: string;
  timestamp: number;
}

interface PublishCompletedEvent {
  type: 'completed';
  event: Event;
  relayResults: Map<string, { success: boolean; error?: string }>;
  success: boolean;
  timestamp: number;
}

interface PublishErrorEvent {
  type: 'error';
  event: Event;
  error: Error;
  timestamp: number;
}
```

**Key Methods:**
- `emit(event: PublishEventUnion)` - Publishers emit events to the bus
- `events: Observable<PublishEventUnion>` - Subscribe to all events
- `on(type: PublishEventType)` - Subscribe to specific event types

### 2. PublishService Updates

The service now emits events at key publishing milestones:

```typescript
async publish(event: Event, options: PublishOptions = {}): Promise<PublishResult> {
  // 1. Emit 'started' when publishing begins
  this.eventBus.emit({
    type: 'started',
    event,
    relayUrls,
    timestamp: Date.now(),
  });

  // 2. Emit 'relay-result' for each relay success/failure
  for (const relayUrl of relayUrls) {
    const publishPromise = this.pool.publish([relayUrl], event, perRelayTimeout)
      .then(() => {
        this.eventBus.emit({
          type: 'relay-result',
          event,
          relayUrl,
          success: true,
          timestamp: Date.now(),
        });
        return relayUrl;
      })
      .catch(error => {
        this.eventBus.emit({
          type: 'relay-result',
          event,
          relayUrl,
          success: false,
          error: error.message || 'Failed',
          timestamp: Date.now(),
        });
        throw error;
      });
  }

  // 3. Emit 'completed' when all relays finish
  this.eventBus.emit({
    type: 'completed',
    event,
    relayResults: result.relayResults,
    success: result.success,
    timestamp: Date.now(),
  });

  // 4. Emit 'error' on critical failures
  this.eventBus.emit({
    type: 'error',
    event,
    error: error instanceof Error ? error : new Error(String(error)),
    timestamp: Date.now(),
  });
}
```

### 3. NotificationService Updates

The service subscribes to event bus events and creates/updates notifications:

```typescript
constructor() {
  // Subscribe to publish events from event bus
  this.subscribeToPublishEvents();
}

private subscribeToPublishEvents(): void {
  // Handle publish started events
  this.eventBus.on('started').subscribe(event => {
    if (event.type === 'started') {
      this.handlePublishStarted(event.event, event.relayUrls);
    }
  });

  // Handle relay result events
  this.eventBus.on('relay-result').subscribe(event => {
    if (event.type === 'relay-result') {
      this.handleRelayResult(event.event.id, event.relayUrl, event.success, event.error);
    }
  });

  // Handle publish completed events
  this.eventBus.on('completed').subscribe(event => {
    if (event.type === 'completed') {
      this.handlePublishCompleted(event.event.id);
    }
  });

  // Handle publish error events
  this.eventBus.on('error').subscribe(event => {
    if (event.type === 'error') {
      this.handlePublishError(event.event.id, event.error);
    }
  });
}
```

**Event Handlers:**

1. **handlePublishStarted** - Creates a new relay publishing notification with all relays in 'pending' state
2. **handleRelayResult** - Updates the status of a specific relay to 'success' or 'failed'
3. **handlePublishCompleted** - Cleans up tracking when all relays complete
4. **handlePublishError** - Handles critical publishing errors

## UI Fix: System Tab Height

Fixed the System tab notifications having a fixed height constraint. Previously, all `.notification-item` elements had a fixed 110px height, but this was only needed for the Activity tab which uses virtual scrolling.

### Before

```scss
.notification-item {
  height: 110px; // Fixed height for virtual scrolling
  min-height: 110px;
  max-height: 110px;
}
```

This applied to ALL notification items, including those in the System tab.

### After

```scss
// Base notification item (no fixed height)
.notification-item {
  display: flex;
  align-items: flex-start;
  padding: 10px 10px;
  gap: 16px;
  // ... other properties
}

// Only apply fixed height to items inside virtual scroll viewport
.notification-viewport {
  .notification-item {
    height: 110px; // Fixed height for virtual scrolling
    min-height: 110px;
    max-height: 110px;
  }
}
```

Now:
- **Activity tab** (uses `cdk-virtual-scroll-viewport` with `[itemSize]="110"`) - Items have fixed 110px height for proper virtual scrolling
- **System tab** (uses regular `div.notification-list`) - Items have dynamic height based on content

## Benefits

1. **Decoupling** - PublishService and NotificationService no longer directly depend on each other
2. **No Circular Dependencies** - Event bus breaks the dependency cycle
3. **Extensibility** - Other services can subscribe to publish events without modifying PublishService
4. **Testability** - Services can be tested independently
5. **Clean Architecture** - Follows single responsibility and dependency inversion principles
6. **Proper UI** - System tab notifications can grow/shrink to fit content

## Files Modified

1. `src/app/services/publish-event-bus.service.ts` - NEW: Event bus service
2. `src/app/services/publish.service.ts` - Added event bus injection and event emission
3. `src/app/services/notification.service.ts` - Added event bus subscription and event handlers
4. `src/app/pages/notifications/notifications.component.scss` - Fixed System tab height constraints

## Testing

Relay publishing notifications now work correctly:
1. When publishing a note, a notification appears in the System tab
2. The notification shows all relays being published to
3. Each relay's status updates in real-time (pending → success/failed)
4. The notification completes when all relays finish
5. System tab notifications can be any height (no 110px constraint)
6. Activity tab notifications remain fixed at 110px for virtual scrolling
