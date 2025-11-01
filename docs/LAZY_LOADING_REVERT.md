# Lazy Loading Revert - Event Interactions

## Summary

Reverted the lazy loading implementation for event interactions due to compatibility issues with infinite scroll and dynamically rendered events. Kept the core optimization of consolidated queries.

## Issues Discovered

### 1. IntersectionObserver Not Triggering
- IntersectionObserver callback was only triggered during initial page load
- As users scrolled and new events were dynamically added, observers weren't being attached
- `ngAfterViewInit` only runs once per component instance
- Events rendered conditionally (`@if` in template) might not have DOM elements ready when lifecycle hook runs

### 2. Infinite Scroll Stopping at ~6 Days
- Users reported that continuous scrolling stopped loading older events after reaching ~6-day-old events
- This appeared to be an independent issue from the lazy loading implementation
- Related to the feed's scroll listener and loadMore functionality in feeds.component.ts

### 3. Template Reference Timing
- The `#eventCard` template reference was inside an `@else if (targetItem && item)` condition
- This meant the element might not exist when `ngAfterViewInit` was called
- Retry logic with setTimeout was attempted but added complexity without solving the root issue

## Technical Challenges

### Dynamic Component Rendering
Angular's component lifecycle hooks don't re-trigger for components that are added dynamically to the page after initial render. In an infinite scroll scenario:

1. Initial events get `ngAfterViewInit` called → observers attached ✓
2. User scrolls down → new events added to DOM
3. New events get `ngAfterViewInit` called → but with retry delays and timing issues ✗
4. No reliable way to ensure observer attachment for all dynamic events

### Conditional Rendering
```html
@if (isLoadingEvent()) {
  <!-- loading spinner -->
} @else if (targetItem && item) {
  <mat-card #eventCard>  <!-- This might not exist yet! -->
```

The conditional rendering meant we needed complex retry logic to wait for elements to be ready.

## Solution: Revert to Immediate Loading

### What Was Removed
- IntersectionObserver setup and configuration
- Visibility tracking signals (`_isVisible`, `_hasBeenVisible`)
- `intersectionObserver` property
- `eventCardRef` ViewChild reference
- `#eventCard` template reference
- `ngAfterViewInit` lifecycle hook
- `ngOnDestroy` cleanup hook
- Visibility-based loading effect
- All debug logging for IntersectionObserver

### What Was Kept
**The Core Optimization**: Consolidated query for interactions

Instead of 3 separate queries per event:
```typescript
// OLD: 3 queries
loadReactions()  // Query 1: kind 7
loadReposts()    // Query 2: kind 6
loadReports()    // Query 3: kind 1984
```

We still use 1 consolidated query:
```typescript
// NEW: 1 query
loadAllInteractions()  // Single query: kinds [7, 6, 1984]
```

This still provides significant performance improvement:
- **3x fewer relay subscriptions**
- **3x fewer network requests**
- **Faster initial load** due to parallel processing
- **Better relay performance** with consolidated filters

### Current Behavior

Events now load interactions immediately when the event component is created:

```typescript
constructor() {
  effect(() => {
    const event = this.event();
    if (!event) return;

    untracked(async () => {
      const record = this.data.toRecord(event);
      this.record.set(record);

      // Load interactions immediately for kind 1 events
      if (record.event.kind == kinds.ShortTextNote) {
        this.loadAllInteractions();  // ← Consolidated query
        this.loadZaps();
        this.loadQuotes();
      }
    });
  });
}
```

## Benefits of Current Approach

1. **Simplicity**: No complex lifecycle management or timing issues
2. **Reliability**: Works consistently with infinite scroll and dynamic rendering
3. **Performance**: Still maintains the 3-to-1 query reduction optimization
4. **Compatibility**: Works with all Angular rendering patterns (conditional, loops, etc.)
5. **Maintainability**: Easier to understand and debug

## Performance Impact

### Comparison

| Approach | Queries per Event | Initial Load | Complexity | Reliability |
|----------|------------------|--------------|------------|-------------|
| Original (3 queries) | 3 | Slow | Low | High |
| Lazy + 3 queries | 3 (deferred) | Fast | High | Low |
| **Immediate + 1 query** | **1** | **Medium** | **Low** | **High** |

### Why This Is Still Better Than Original

Even without lazy loading, we're still significantly better than the original implementation:

**Original**: 100 events × 3 queries = **300 relay queries**  
**Current**: 100 events × 1 query = **100 relay queries**

That's a **66% reduction** in relay queries while maintaining simplicity and reliability.

## Future Considerations

If lazy loading is desired in the future, consider:

1. **Virtual Scrolling**: Use Angular CDK's virtual scroll viewport
   - Only renders visible items
   - Built-in lifecycle management for dynamic items
   - Handles thousands of items efficiently

2. **Intersection Observer at Feed Level**: Implement observation at the parent feed component rather than individual event components
   - Single observer for all events
   - Load data before passing to event component
   - Event component receives pre-loaded data

3. **Pagination Instead of Infinite Scroll**: Load chunks of events with explicit pagination
   - Clearer boundaries for data loading
   - Easier to implement lazy loading per page
   - Better UX for returning to previous position

## Related Work

- Original optimization: `RELAY_QUERY_OPTIMIZATION.md`
- Consolidated queries: Changes to `event.ts`, `user-relay.ts`, `user-data.service.ts`
- Repost button fix: `repost-button.component.ts`

## Files Modified (Revert)

- `event.component.ts`: Removed IntersectionObserver, restored immediate loading
- `event.component.html`: Removed `#eventCard` template reference
- Kept all consolidated query logic intact
