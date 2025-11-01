# Lazy Loading Event Interactions with IntersectionObserver

## Summary

Implemented lazy loading for event interactions (reactions, reposts, reports, zaps, quotes) to only load data when events scroll into the user's viewport. This reduces initial relay queries and significantly improves performance for feeds with many events.

## Problem

Previously, the event component loaded all interactions immediately upon creation:
- Every event in the feed queried relays for reactions (kind 7), reposts (kind 6), reports (kind 1984)
- Events far down in the scroll view loaded data even though they weren't visible
- This created unnecessary relay traffic and slowed down initial page loads

## Solution

Implemented viewport-based lazy loading using the IntersectionObserver API:

1. **Visibility Tracking**: Added signals to track when events become visible
   - `_isVisible`: Current visibility state
   - `_hasBeenVisible`: Tracks if event was ever visible (prevents reload)

2. **IntersectionObserver**: Set up observer with 10% threshold
   - Triggers when event is 10% visible in viewport
   - Updates `_isVisible` signal when visibility changes

3. **Deferred Loading**: Modified constructor to only load interactions when visible
   - Initial effect sets up record but doesn't load interactions
   - Second effect watches visibility and loads interactions when event scrolls into view
   - Uses `_hasBeenVisible` flag to prevent reloading on scroll out/in

## Implementation Details

### Files Modified

**event.component.ts**:
- Added `AfterViewInit`, `AfterViewChecked`, `OnDestroy` lifecycle interfaces
- Added visibility tracking signals: `_isVisible`, `_hasBeenVisible`
- Added `intersectionObserver` property
- Added `eventCardRef` ViewChild reference
- Implemented `ngAfterViewInit()` to setup IntersectionObserver
- Implemented `ngOnDestroy()` to cleanup observer
- Split constructor effect into two:
  1. Record setup (immediate)
  2. Interaction loading (deferred until visible)

**event.component.html**:
- Added `#eventCard` template reference to main `<mat-card>` element

### Code Pattern

```typescript
// Constructor - split into two effects
constructor() {
  // Effect 1: Setup record immediately
  effect(() => {
    const event = this.event();
    if (!event) return;
    
    untracked(async () => {
      const record = this.data.toRecord(event);
      this.record.set(record);
      // Don't load interactions here anymore
    });
  });
  
  // Effect 2: Load interactions when visible
  effect(() => {
    const isVisible = this._isVisible();
    const hasBeenVisible = this._hasBeenVisible();
    const record = this.record();
    
    if (record && record.event.kind == kinds.ShortTextNote && isVisible && !hasBeenVisible) {
      this._hasBeenVisible.set(true);
      
      untracked(async () => {
        this.loadAllInteractions();
        this.loadZaps();
        this.loadQuotes();
      });
    }
  });
}

// Lifecycle: Setup observer
ngAfterViewInit() {
  this.intersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        this._isVisible.set(entry.isIntersecting);
      });
    },
    { threshold: 0.1 } // 10% visible triggers load
  );
  
  if (this.eventCardRef?.nativeElement) {
    this.intersectionObserver.observe(this.eventCardRef.nativeElement);
  }
}

// Lifecycle: Cleanup
ngOnDestroy() {
  if (this.intersectionObserver) {
    this.intersectionObserver.disconnect();
  }
}
```

## Benefits

1. **Reduced Initial Load**: Events outside viewport don't query relays
2. **Better Performance**: Fewer simultaneous relay subscriptions
3. **Improved UX**: Faster initial page load, smoother scrolling
4. **Resource Efficiency**: Only loads data for content user will see
5. **No Reloading**: `_hasBeenVisible` flag prevents redundant queries when scrolling

## Configuration

- **Threshold**: 0.1 (10% of event must be visible)
- **Load Trigger**: First time event becomes visible
- **Applies To**: Reactions, reposts, reports, zaps, quotes for kind 1 events (ShortTextNote)

## Related Work

This implementation follows the same pattern used in `content.component.ts` for lazy loading content previews. Both use IntersectionObserver with 10% threshold and track visibility states to prevent redundant loading.

## Technical Notes

- Uses Angular signals for reactive visibility tracking
- IntersectionObserver cleanup in `ngOnDestroy` prevents memory leaks
- Effect uses `untracked()` to prevent infinite loops
- Only applies to kind 1 (ShortTextNote) events
- Works in combination with the consolidated interaction query from previous optimization
