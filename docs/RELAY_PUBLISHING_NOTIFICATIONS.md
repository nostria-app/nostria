# Relay Publishing Notifications System

## Overview

This document describes the comprehensive relay publishing notification system that provides real-time status updates when publishing events to Nostr relays, including the ability to retry failed attempts.

## Architecture

### Components

1. **PublishService** (`src/app/services/publish.service.ts`)
   - Main service responsible for publishing events to relays
   - Creates relay publishing notifications with individual promise tracking
   - Handles timeout and error scenarios

2. **NotificationService** (`src/app/services/notification.service.ts`)
   - Manages all notifications (system and content)
   - Tracks relay promise status in real-time
   - Provides retry functionality for failed relays
   - Persists notifications to IndexedDB

3. **RelayPublishStatusComponent** (`src/app/components/relay-publish-status/`)
   - UI component that displays relay publishing status
   - Shows real-time progress with visual indicators
   - Provides retry button for failed relays

4. **NotificationsComponent** (`src/app/pages/notifications/`)
   - Main notifications page
   - Displays both system and content notifications
   - Integrates relay publish status component

## Features

### Real-Time Status Tracking

When an event is published, the system:

1. Creates individual promises for each relay
2. Generates a notification with pending status for all relays
3. Updates relay status in real-time as promises resolve/reject
4. Shows visual indicators:
   - ✓ Green checkmark for successful publishes
   - ⚠️ Orange pending indicator with spinning animation
   - ✗ Red error icon for failed publishes

### Progress Indicators

- **Progress bar** shows overall completion percentage
- **Status chips** display counts:
  - Success count (green)
  - Pending count (orange, only shown while pending)
  - Failed count (red, only shown if failures exist)
- **Individual relay items** show per-relay status with colored borders

### Error Handling

- Detailed error messages are captured and displayed
- Tooltip on failed relay icons shows the specific error
- Error messages appear below relay names in the UI
- Timeout handling (default 10 seconds)

### Retry Functionality

The retry system allows users to:

1. Click "RETRY X FAILED" button on notifications with failures
2. System resets failed relays to pending status
3. Attempts to republish only to failed relays
4. Updates status in real-time as retry completes

Implementation details:
- `NotificationService.retryFailedRelays()` method
- Takes a retry function parameter (typically `accountRelay.publishToRelay`)
- Processes each failed relay individually
- Updates notification status based on retry results

## Data Flow

```
1. User publishes event
   ↓
2. PublishService.publish()
   ↓
3. Create Map<Promise<string>, string> for relay tracking
   ↓
4. NotificationService.addRelayPublishingNotification()
   ↓
5. Create RelayPublishingNotification with pending promises
   ↓
6. Monitor each promise asynchronously
   ↓
7. Update notification status as promises resolve/reject
   ↓
8. Persist to IndexedDB for durability
   ↓
9. Display in UI with real-time updates
   ↓
10. (Optional) User clicks retry for failed relays
```

## Notification Structure

### RelayPublishingNotification Interface

```typescript
interface RelayPublishingNotification extends Notification {
  event: Event;                          // The event being published
  relayPromises?: RelayPublishPromise[]; // Array of relay status trackers
  complete: boolean;                     // Whether publishing is complete
}
```

### RelayPublishPromise Interface

```typescript
interface RelayPublishPromise {
  relayUrl: string;                      // URL of the relay
  status: 'pending' | 'success' | 'failed'; // Current status
  promise?: Promise<any>;                 // The actual promise (not persisted)
  error?: any;                           // Error details if failed
}
```

## Storage

Notifications are stored in IndexedDB with the following considerations:

- **Promise objects are NOT persisted** (they can't be serialized)
- Only metadata (status, error, relay URL) is stored
- Notifications are associated with the current account's pubkey
- Storage is updated whenever notification status changes

## UI Implementation

### Visual Design

- **Card-based layout** with Material Design components
- **Color-coded status indicators**:
  - Green: Success
  - Orange: Pending
  - Red: Failed
- **Animated elements**:
  - Spinning sync icon for pending operations
  - Smooth transitions for status changes
- **Responsive design** with scrollable relay list

### User Interactions

1. **View Details**: Click notification to see full relay status
2. **Retry Failed**: Click button to retry all failed relays
3. **View Event**: Click event ID link to view the published event
4. **Dismiss**: Standard notification dismiss actions

## Usage Examples

### Basic Publishing with Notification

```typescript
// In PublishService
const result = await publishService.publish(signedEvent, {
  timeout: 10000 // Optional timeout
});

// Notification is automatically created and tracked
```

### Retry Failed Relays

```typescript
// In NotificationsComponent
async onRetryPublish(notificationId: string): Promise<void> {
  await this.notificationService.retryFailedRelays(
    notificationId,
    (event, relayUrl) => this.accountRelay.publishToRelay(event, relayUrl)
  );
}
```

### Check Notification Status

```typescript
// Get all relay publishing notifications
const systemNotifications = computed(() => {
  return this.notificationService.notifications()
    .filter(n => n.type === NotificationType.RELAY_PUBLISHING)
    .sort((a, b) => b.timestamp - a.timestamp);
});
```

## Implementation Notes

### Why Individual Promises?

Instead of batch publishing, we create individual promises per relay to:
- Track per-relay status accurately
- Support selective retry of failed relays
- Provide detailed error messages
- Enable real-time UI updates

### Signal-Based Reactivity

The system uses Angular signals for:
- Automatic UI updates when status changes
- Efficient change detection
- Reactive computed values (counts, progress)

### Account-Specific Notifications

Notifications are associated with the account that created them:
- `recipientPubkey` field links notification to account
- Switching accounts loads appropriate notifications
- Prevents notification leakage between accounts

## Testing

To test the notification system:

1. Publish an event (create a note)
2. Open notifications page
3. Observe real-time status updates
4. Simulate failures by disconnecting from internet
5. Test retry functionality with failed relays

## Future Enhancements

Potential improvements:

1. **Notification Grouping**: Collapse multiple publish notifications
2. **Success Auto-Dismiss**: Automatically remove successful publishes after delay
3. **Relay Health Metrics**: Track relay reliability over time
4. **Priority Relay Publishing**: Publish to important relays first
5. **Notification Sounds**: Audio feedback for completion/failures
6. **Desktop Notifications**: Browser notifications for publish status

## Related Files

- `src/app/services/publish.service.ts`
- `src/app/services/notification.service.ts`
- `src/app/services/storage.service.ts`
- `src/app/components/relay-publish-status/relay-publish-status.component.ts`
- `src/app/components/relay-publish-status/relay-publish-status.component.html`
- `src/app/components/relay-publish-status/relay-publish-status.component.scss`
- `src/app/pages/notifications/notifications.component.ts`
- `src/app/pages/notifications/notifications.component.html`

## Troubleshooting

### Notifications Not Appearing

1. Check that `NotificationService.loadNotifications()` is called
2. Verify storage is initialized
3. Check browser console for errors

### Status Not Updating

1. Verify promises are being created correctly
2. Check that `updateRelayPromiseStatus()` is being called
3. Ensure signals are being used correctly in templates

### Retry Not Working

1. Verify retry function is passed correctly
2. Check that failed relays are being identified
3. Review console logs for retry errors
