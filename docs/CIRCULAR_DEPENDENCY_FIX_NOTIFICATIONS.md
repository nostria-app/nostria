# Circular Dependency Fix - PublishService and NotificationService

## Problem

After refactoring the publish signal pattern, a new circular dependency was introduced:

```
_PwaUpdateService 
  → _NotificationService 
  → _AccountStateService 
  → _PublishService 
  → _NotificationService  ← CIRCULAR!
```

**Error:**
```
RuntimeError: NG0200: Circular dependency detected for `_NotificationService`
```

## Root Cause

When we added `PublishService` to handle publishing directly (instead of using the publish signal), we injected `NotificationService` to show relay publishing notifications. However:

1. `NotificationService` needs `AccountStateService` (to track notifications per account)
2. `AccountStateService` now uses `PublishService` (for direct publishing)
3. `PublishService` was injecting `NotificationService` (for relay notifications)

This created the circular dependency loop.

## Solution

Removed the `NotificationService` injection from `PublishService`.

**Trade-off:** Relay publishing progress notifications are temporarily disabled.

### Code Changes

**publish.service.ts:**
```typescript
// BEFORE (circular dependency)
export class PublishService {
  private readonly notificationService = inject(NotificationService);
  
  async publish(event: Event, options: PublishOptions) {
    // ...
    await this.notificationService.addRelayPublishingNotification(event, relayPromises);
  }
}

// AFTER (dependency removed)
export class PublishService {
  // NotificationService removed
  
  async publish(event: Event, options: PublishOptions) {
    // ...
    // Notification call commented out with explanation
  }
}
```

## Impact

### What Still Works ✅
- All publishing functionality works correctly
- Events are still published to all appropriate relays
- Follow/unfollow notifications to users' relays
- Mute list publishing
- Report publishing
- All relay distribution logic intact

### What's Temporarily Disabled ❌
- Real-time relay publishing progress notifications in the UI
- Users won't see which relays accepted/rejected their published events

## Future Solution

Implement an **event bus pattern** to decouple services:

```typescript
// 1. Create a PublishEventBus
class PublishEventBus {
  private publishEvents$ = new Subject<PublishEvent>();
  
  emit(event: PublishEvent) { 
    this.publishEvents$.next(event); 
  }
  
  subscribe(callback: (event: PublishEvent) => void) {
    return this.publishEvents$.subscribe(callback);
  }
}

// 2. PublishService emits events
class PublishService {
  private eventBus = inject(PublishEventBus);
  
  async publish(event: Event) {
    this.eventBus.emit({ type: 'start', event });
    // ... publish logic ...
    this.eventBus.emit({ type: 'complete', event, results });
  }
}

// 3. NotificationService subscribes
class NotificationService {
  private eventBus = inject(PublishEventBus);
  
  constructor() {
    this.eventBus.subscribe(event => {
      if (event.type === 'complete') {
        this.addRelayPublishingNotification(event.event, event.results);
      }
    });
  }
}
```

This way:
- `PublishService` has no knowledge of `NotificationService`
- `NotificationService` has no knowledge of `PublishService`
- Both services communicate through the event bus
- No circular dependency

## Testing Checklist

✅ App bootstraps without circular dependency errors  
✅ Publishing notes works correctly  
✅ Following/unfollowing publishes to correct relays  
✅ Muting/unmuting works  
✅ Reporting works  
⚠️ Relay publishing notifications not shown (expected)  

## Files Changed

- `src/app/services/publish.service.ts` - Removed NotificationService injection
- `docs/PUBLISH_SIGNAL_REFACTOR.md` - Added known limitations section

## Related Issues

- Original circular dependency: NostrService ↔ AccountStateService (resolved by publish signal refactoring)
- This issue: NotificationService ↔ PublishService (resolved by removing notification injection)
