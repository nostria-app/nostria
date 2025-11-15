# Fix: Like Appearing on Newly Posted Reply

## Issue Description

When a user likes a post and then replies to it, the like from the original post incorrectly appears on the newly created reply. The issue resolves itself after a page reload, indicating a state management problem rather than a data persistence issue.

## Root Cause Analysis

The problem was identified in the `EventComponent` (`src/app/components/event/event.component.ts`) and its handling of the IntersectionObserver lifecycle:

### The Issue

1. **Component Reuse**: When navigating to a new event (like a newly posted reply), Angular reuses the same `EventComponent` instance for performance
2. **Observer Persistence**: The `IntersectionObserver` was created once in `ngAfterViewInit()` and never recreated when the event changed
3. **State Contamination**: When the event changed:
   - The `hasLoadedInteractions` flag was reset to `false`
   - But the old event's interaction data (reactions, reposts, etc.) remained in the component signals
   - The IntersectionObserver was still observing the same DOM element
4. **Race Condition**: When the new event became visible, the observer would trigger, but the component might still have the old event's interaction data

### Why It Happened

The EventComponent uses an IntersectionObserver for lazy loading of interactions to improve performance. However, the observer setup had the following issues:

- **No cleanup when event changes**: The observer continued watching the same element even when showing a different event
- **No state reset**: Interaction signals (reactions, reposts, zaps, etc.) were not cleared when the event changed
- **Timing issue**: The observer could trigger before the new event's state was fully initialized

## Solution

The fix involves three key changes to ensure each event loads and displays its own interactions independently:

### 1. Clear Interaction State on Event Change

When the event input changes, explicitly clear all interaction-related signals:

```typescript
// CRITICAL: Clear all interaction state when event changes
// This prevents interactions from the previous event being displayed on the new event
this.reactions.set({ events: [], data: new Map() });
this.reposts.set([]);
this.reports.set({ events: [], data: new Map() });
this.zaps.set([]);
this.quotes.set([]);
```

### 2. Recreate IntersectionObserver on Event Change

When the event changes and an observer already exists, recreate it:

```typescript
// Recreate IntersectionObserver if it exists
// This ensures we observe the correct event when component is reused
if (this.intersectionObserver) {
  this.setupIntersectionObserver();
}
```

### 3. Extract Observer Setup into Reusable Method

Create a dedicated method that handles both cleanup and creation:

```typescript
private setupIntersectionObserver(): void {
  // Clean up existing observer if present
  if (this.intersectionObserver) {
    this.intersectionObserver.disconnect();
    this.intersectionObserver = undefined;
  }

  // Create new observer with proper event ID tracking
  // ... (observer creation code)
}
```

## Benefits

1. **Prevents State Contamination**: Each event starts with a clean slate of interactions
2. **Proper Observer Lifecycle**: Observer is recreated when the component is reused for a different event
3. **Maintains Performance**: Still uses lazy loading via IntersectionObserver
4. **Race Condition Prevention**: Event ID is captured and validated before loading interactions

## Testing

### Manual Verification Steps

1. Open a post in the application
2. Like the post (the like counter should increment)
3. Click reply and create a new reply
4. After posting, navigate to the new reply

**Expected Result**: The new reply should show 0 likes, not inherit the like from the parent post

**Before Fix**: The reply incorrectly displayed the parent's like count

**After Fix**: The reply correctly shows its own (empty) interaction state

### Security Check

- CodeQL security scan: **0 alerts**
- No security vulnerabilities introduced

## Files Modified

- `src/app/components/event/event.component.ts`:
  - Lines 437-444: Clear interaction state on event change
  - Lines 449-452: Recreate observer on event change
  - Lines 531-591: Extract observer setup into reusable method

## Related Code Patterns

This fix demonstrates an important pattern for Angular components that:
- Use component reuse for performance
- Load data asynchronously based on inputs
- Use external APIs like IntersectionObserver

**Key Principle**: When an input changes and the component is reused, ensure:
1. Previous state is cleared
2. External observers/subscriptions are recreated or updated
3. Async operations validate the current input before updating state
