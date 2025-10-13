# Scroll Flickering Fix

**Date**: October 13, 2025  
**Issue**: UI flickering and rapid log spam when scrolling to bottom of feed columns  
**Component**: `feeds.component.ts`

## Problem Description

When users scrolled to the bottom of a feed column to load more content, the UI would flicker and logs showed rapid repeated calls to load more content (every 40-50ms):

```
[DEBUG] Loading more content for column: notes
[DEBUG] Loading more content for column: notes
[DEBUG] Loading more content for column: notes
... (repeating hundreds of times)
```

This created a feedback loop causing performance degradation and poor UX.

## Root Causes

### 1. Broken Guard Logic (Critical)

The guard condition in `loadMoreForColumn()` method had completely inverted logic:

```typescript
// ❌ BEFORE - Broken logic
const isLoading = this.feedService.getColumnLoadingState(columnId);
const hasMore = this.feedService.getColumnHasMore(columnId);

if (!isLoading || !hasMore || isLoading() || !hasMore()) {
  return;
}
```

**Problems:**
- Checked both the signal reference AND its value in a confusing way
- The condition would pass when it should block, allowing multiple loads
- Unclear variable naming made the bug hard to spot

### 2. Missing Throttling (Critical)

The scroll event listener had **zero throttling/debouncing**:

```typescript
// ❌ BEFORE - No throttling
const scrollListener = () => {
  const scrollTop = columnElement.scrollTop;
  // ... check if at bottom
  if (scrolledToBottom) {
    this.loadMoreForColumn(column.id);
  }
};
```

**Problems:**
- Fired on every single pixel of scroll movement
- Could trigger 100+ times per second during scrolling
- Even with guards in `feedService`, the component-level calls were overwhelming

## Solution

### 1. Fixed Guard Logic

```typescript
// ✅ AFTER - Correct logic with clear naming
const isLoadingSignal = this.feedService.getColumnLoadingState(columnId);
const hasMoreSignal = this.feedService.getColumnHasMore(columnId);

// Guard: Ensure signals exist
if (!isLoadingSignal || !hasMoreSignal) {
  this.logger.warn(`Cannot load more for column ${columnId}: loading state signals not found`);
  return;
}

// Guard: Don't load if already loading or no more data available
if (isLoadingSignal() || !hasMoreSignal()) {
  return;
}
```

**Improvements:**
- Clear variable names (`isLoadingSignal` vs `isLoading`)
- Separate checks for signal existence vs. signal value
- Proper comments explaining each guard
- Early return prevents unnecessary processing

### 2. Added Throttling

```typescript
// ✅ AFTER - Throttled scroll handler
let lastScrollCheck = 0;
const THROTTLE_MS = 300; // Only check every 300ms

const scrollListener = () => {
  const now = Date.now();
  
  // Throttle: Only process scroll events every 300ms
  if (now - lastScrollCheck < THROTTLE_MS) {
    return;
  }
  lastScrollCheck = now;

  // ... rest of scroll handling
};
```

**Benefits:**
- Maximum 3-4 checks per second instead of 100+
- Still responsive enough for good UX (300ms is imperceptible)
- Closure-based throttling (no external library needed)
- Per-column throttling prevents cross-column interference

## Technical Details

### Why Both Fixes Were Needed

1. **FeedService** already had guards in `loadMoreEvents()` - they work correctly
2. **Component level** was calling `loadMoreEvents()` too frequently
3. Even with service-level guards, the sheer volume of calls caused:
   - Excessive logging
   - Unnecessary promise chain creation
   - Signal reads on every scroll pixel
   - UI re-renders from signal reads

### Throttling Strategy

We use **simple timestamp-based throttling** instead of debouncing because:

- **Throttling** = Guarantee execution at regular intervals (better for scroll)
- **Debouncing** = Wait for quiet period (better for search input)
- For scroll-to-load, we want consistent checks while scrolling, not just at the end

## Testing Recommendations

1. **Scroll Performance**: Scroll rapidly to bottom multiple times
2. **Log Monitoring**: Verify "Loading more content" appears at most once per 300ms
3. **Loading States**: Check that loading spinner appears/disappears correctly
4. **Edge Cases**: 
   - No more content available
   - Network delays
   - Multiple columns simultaneously

## Related Files

- `src/app/pages/feeds/feeds.component.ts` - Fixed scroll listener setup
- `src/app/services/feed.service.ts` - Contains service-level guards (unchanged)

## Prevention

To avoid similar issues in the future:

1. **Always throttle/debounce scroll handlers**
2. **Use descriptive signal names** (e.g., `isLoadingSignal` not `isLoading`)
3. **Separate existence checks from value checks** for signals
4. **Add debug logging** to track event frequency during development
5. **Monitor logs** for repeated patterns indicating runaway loops
