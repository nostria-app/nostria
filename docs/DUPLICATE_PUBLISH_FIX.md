# Duplicate Note Publishing Fix

## Problem

Users reported that notes were sometimes published twice, creating two different events with:
- Same content
- Different timestamps
- Different event IDs

## Root Cause Analysis

The issue was caused by a **race condition in the publish button handler**:

### Race Condition Flow
1. User double-clicks "Publish" button rapidly
2. **First click**: `canPublish()` returns `true` → starts async `publishNote()`
3. **Second click** (milliseconds later): `canPublish()` still returns `true` because `isPublishing` hasn't been set yet
4. Both async operations proceed independently, creating two separate events

### Why It Happened
```typescript
async publishNote(): Promise<void> {
  if (!this.canPublish()) return;  // ← Both clicks pass this check
  
  this.isPublishing.set(true);      // ← Set happens AFTER the check
  // ... async operations that create new events with different timestamps
}
```

The problem: There was a small time window between checking `canPublish()` and setting `isPublishing.set(true)` where a second click could slip through.

## Solution Implemented

### Three-Layer Defense

#### 1. Immediate Guard Flag (`publishInitiated`)
Added a new signal `publishInitiated` that is set **immediately** when the method is called:

```typescript
private publishInitiated = signal(false);

async publishNote(): Promise<void> {
  // CRITICAL: Guard against double-click/double-submit
  if (this.publishInitiated()) {
    console.warn('[NoteEditorDialog] Publish already initiated, ignoring duplicate call');
    return;
  }
  
  this.publishInitiated.set(true);
  
  // Double-check canPublish and isPublishing
  if (!this.canPublish() || this.isPublishing()) {
    this.publishInitiated.set(false);
    return;
  }

  this.isPublishing.set(true);
  // ... rest of the method
}
```

#### 2. Enhanced Button Disabled Logic
Updated the template to be more defensive:

```html
<!-- Before -->
<button (click)="publishNote()" [disabled]="!canPublish()">

<!-- After -->
<button (click)="publishNote()" [disabled]="!canPublish() || isPublishing()">
```

This ensures the button is disabled as soon as `isPublishing` becomes `true`.

#### 3. Proper Cleanup in Finally Block
Ensured both flags are reset in the finally block:

```typescript
finally {
  this.isPublishing.set(false);
  this.publishInitiated.set(false);  // Reset guard flag
}
```

## Files Changed

1. `src/app/components/note-editor-dialog/note-editor-dialog.component.ts`
   - Added `publishInitiated` signal
   - Enhanced `publishNote()` method with immediate guard
   - Updated finally block to reset both flags

2. `src/app/components/note-editor-dialog/note-editor-dialog.component.html`
   - Updated publish button disabled condition to include `isPublishing()`

## Testing Recommendations

1. **Double-click test**: Rapidly click the publish button multiple times
2. **Keyboard spam test**: Tab to button and rapidly press Enter/Space
3. **Network delay test**: Test with slow network to increase race condition window
4. **PoW test**: Test with Proof-of-Work enabled (longer async operations)
5. **Check console**: Should see warning message if duplicate publish is attempted

## Prevention

This fix prevents duplicate publishing through:
- **Synchronous guard**: `publishInitiated` is checked and set synchronously before any async operations
- **Defense in depth**: Multiple layers of protection (guard flag + disabled state)
- **Proper cleanup**: Both flags reset in finally block, even if errors occur
- **Warning logging**: Console warning when duplicate attempts are detected

## Related Code

- NostrService.signAndPublish() - Signs and publishes events
- PublishService.publish() - Handles relay distribution
- Account state effects - May trigger additional publishes (separate concern)
