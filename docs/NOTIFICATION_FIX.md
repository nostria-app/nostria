# Fix: Relay Publishing Notifications Not Appearing

## Issue
When publishing events, no notification was appearing in the System notifications tab.

## Root Cause
The notification system was only integrated into `PublishService.publish()`, but most of the codebase was calling `accountRelay.publish()` directly, which bypasses the notification creation.

## Solution
Modified the `RelayServiceBase.publish()` method (which `AccountRelayService` inherits from) to create relay publishing notifications automatically using **lazy injection** to avoid circular dependencies.

### Circular Dependency Challenge

Initial attempt to inject `NotificationService` directly caused a circular dependency:
```
AccountRelayService → NotificationService → AccountStateService → DataService → AccountRelayService
```

### Solution: Dynamic Import + Lazy Injection

Used a combination of:
1. **Dynamic import**: Delays module loading until runtime
2. **Lazy injection via Injector**: Gets service instance only when needed
3. **Non-blocking**: Doesn't await notification creation

### Changes Made

**File: `src/app/services/relays/relay.ts`**

1. **Added Injector injection:**
   ```typescript
   import { inject, signal, Signal, Injector } from '@angular/core';
   
   protected injector = inject(Injector);
   ```

2. **Updated publish() method with lazy notification creation:**
   ```typescript
   // Lazy-load NotificationService to avoid circular dependency
   try {
     const { NotificationService } = await import('../notification.service');
     const notificationService = this.injector.get(NotificationService);
     
     // Create relay promises map for notification tracking
     const relayPromises = new Map<Promise<string>, string>();
     
     publishResults.forEach((promise, index) => {
       const relayUrl = urls[index];
       const wrappedPromise = promise
         .then(() => relayUrl)
         .catch((error: unknown) => {
           const errorMsg = error instanceof Error ? error.message : 'Failed';
           throw new Error(`${relayUrl}: ${errorMsg}`);
         });
       relayPromises.set(wrappedPromise, relayUrl);
     });

     // Create notification (non-blocking)
     notificationService.addRelayPublishingNotification(event, relayPromises)
       .catch(err => this.logger.warn('Failed to create publish notification', err));
   } catch (notifError) {
     // Gracefully handle if notification service unavailable
     this.logger.debug('Could not create publish notification', notifError);
   }
   ```

### How It Works Now

1. **Any publish call** (whether through `accountRelay.publish()`, `publishService.publish()`, or other relay services) now creates a notification
2. **Individual relay tracking**: Each relay gets its own promise in the notification
3. **Real-time updates**: As relays respond, the notification status updates automatically
4. **Retry capability**: Failed relays can be retried through the notification UI
5. **No circular dependency**: Dynamic import breaks the circular dependency chain
6. **Non-blocking**: Publish completes immediately; notification creation happens asynchronously

### Code Flow

```
User publishes event
   ↓
accountRelay.publish(event)  ← Most common path
   ↓
RelayServiceBase.publish()
   ↓
Pool publishes to all relays (returns promises)
   ↓
Dynamically import NotificationService (breaks circular dep)
   ↓
Lazy inject NotificationService via Injector
   ↓
Create Map<Promise, relayUrl> for each relay
   ↓
notificationService.addRelayPublishingNotification() (async, non-blocking)
   ↓
Notification appears in System tab with real-time status
```

## Testing

To verify the fix:

1. Create and publish any event (note, article, reaction, etc.)
2. Open Notifications page
3. Click on "System" tab
4. You should see a "Publishing Event" notification with:
   - Progress bar showing completion percentage
   - Individual relay status (pending/success/failed)
   - Real-time status updates as relays respond
   - Retry button if any relays fail

## Impact

This fix ensures that **all** event publishing operations create notifications, not just those that explicitly use `PublishService`. This means:

- Creating notes
- Publishing reactions
- Updating profile
- Publishing relay lists
- All other event types

...will now show relay publishing notifications in the System tab.

## Technical Details

### Why Dynamic Import?

Dynamic imports (`await import()`) are loaded at runtime, not at module load time. This breaks the circular dependency because:
- Module graph is built without the circular reference
- Service is loaded only when `publish()` is actually called
- By that time, all services are already instantiated

### Why Lazy Injection?

Using `injector.get()` instead of constructor injection:
- Delays dependency resolution until runtime
- Allows the dependency graph to be constructed without cycles
- Gets the already-instantiated singleton when needed

### Why Non-Blocking?

Not awaiting `addRelayPublishingNotification()`:
- Publish operation completes immediately
- Notification creation happens in background
- Failures in notification don't affect publish success
- Better performance and user experience
