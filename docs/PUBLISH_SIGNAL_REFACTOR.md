# Publish Signal Refactoring

## Problem

The application used a signal-based publishing pattern (`accountState.publish.set(event)`) that created circular dependencies between services:
- `AccountStateService` would set the `publish` signal
- `NostrService` would watch this signal with an `effect()`
- `NostrService` would sign and publish the event
- This created a circular dependency: AccountStateService → NostrService → AccountStateService

## Solution

Replaced the signal-based pattern with direct method calls using `PublishService`, eliminating circular dependencies while maintaining the same functionality.

### Architecture Changes

#### 1. New Method in PublishService

Added `signAndPublishAuto()` method that automatically detects the correct publishing strategy based on event type:

```typescript
async signAndPublishAuto(
  event: UnsignedEvent,
  signFn: (event: UnsignedEvent) => Promise<Event>,
  newlyFollowedPubkeys?: string[]
): Promise<PublishResult>
```

**Features:**
- Auto-detects if event is kind 3 (follow list) or other types
- For kind 3: publishes to newly followed users' relays
- For other events: publishes to mentioned users' relays
- Always uses all account relays (no optimization)

#### 2. AccountStateService Changes

**Removed:**
- `publish` signal
- `newlyFollowedPubkeys` signal

**Added:**
- `setSignFunction()` - Called by NostrService to provide signing capability
- `publishEvent()` - Private method that uses PublishService directly

**Updated methods:**
- `unfollowUser()` - Now calls `publishEvent()` directly
- `followPubkeys()` - Now calls `publishEvent()` with newly followed pubkeys
- `muteUser()` - Now calls `publishEvent()` directly

#### 3. NostrService Changes

**Removed:**
- `effect()` that watched `accountState.publish` signal (60+ lines)
- Signal clearing logic with `untracked()`

**Added:**
- Calls `accountState.setSignFunction()` in constructor to provide signing capability

#### 4. ReportingService Changes

**Updated methods:**
- `muteUser()` - Uses `publishService.signAndPublishAuto()` directly
- `unblockUser()` - Uses `publishService.signAndPublishAuto()` directly

#### 5. Component Changes

**report-dialog.component.ts:**
- `blockTarget()` - Uses `publishService.signAndPublishAuto()` directly

**profile-hover-card.component.ts:**
- `reportProfile()` - Uses `publishService.signAndPublishAuto()` directly

## Benefits

### 1. No Circular Dependencies
- Services have clear, unidirectional dependencies
- `AccountStateService` no longer needs to know about `NostrService`
- Signing function is injected, avoiding the circular reference

### 2. Cleaner Code
- Removed 60+ lines of effect-based logic
- More explicit publish calls - easier to understand
- No more signal state management for publishing

### 3. Better Error Handling
- Direct async/await instead of signal effects
- Easier to track errors through the call stack
- Can use try/catch at the call site

### 4. More Maintainable
- Publishing logic is centralized in `PublishService`
- Clear method signatures with documentation
- Easier to test (no effects to mock)

### 5. Type Safety
- Explicit method parameters instead of signal state
- TypeScript can track the flow better
- Auto-complete works better in IDEs

## Migration Pattern

**Old pattern:**
```typescript
// Set the signal
this.accountState.publish.set(event);
this.accountState.newlyFollowedPubkeys.set(pubkeys);
```

**New pattern:**
```typescript
// Direct method call
await this.publishService.signAndPublishAuto(
  event,
  (event) => this.nostrService.signEvent(event),
  newlyFollowedPubkeys // optional
);
```

## Files Changed

1. **publish.service.ts** - Added `signAndPublishAuto()` method
2. **account-state.service.ts** - Removed signals, added `publishEvent()` method
3. **nostr.service.ts** - Removed publish effect, added sign function injection
4. **reporting.service.ts** - Updated mute/unmute methods
5. **report-dialog.component.ts** - Updated block methods
6. **profile-hover-card.component.ts** - Updated report method

## Testing Recommendations

1. **Follow/Unfollow** - Verify events publish to correct relays
2. **Mute/Unmute** - Verify mute list updates publish correctly
3. **Reports** - Verify report events publish correctly
4. **Relay Distribution** - Verify newly followed users get notified
5. **Error Cases** - Verify errors are properly caught and displayed

## Backwards Compatibility

The `publish` and `newlyFollowedPubkeys` signals are commented out (not fully removed) in case rollback is needed. They can be safely deleted after testing confirms everything works.

## Future Improvements

Consider moving more publishing logic into `PublishService`:
- Direct publish methods for specific event types (follow, mute, report)
- Batch publishing support
- Retry logic for failed publishes
- Publishing queue for offline scenarios

## Known Limitations

### Relay Publishing Notifications Temporarily Disabled

The `NotificationService` was removed from `PublishService` to avoid a circular dependency:
```
NotificationService -> AccountStateService -> PublishService -> NotificationService
```

**Impact:** Relay publishing progress notifications are not currently shown to users.

**Future Solution:** Implement an event bus or observer pattern to decouple notifications from the publishing service:
- `PublishService` emits publish events to an event bus
- `NotificationService` subscribes to these events independently
- No direct dependency between the two services

