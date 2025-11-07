# People Component Scroll Restoration Fix

## Problem

When navigating away from the People page and returning, the scroll position would restore to a position much lower than where the user last left off. This made the scroll restoration feature unreliable and confusing.

## Root Cause

The issue was caused by how the Angular CDK Virtual Scroll Viewport handles scroll position restoration:

1. **Virtual scroll viewports need time to render**: The viewport needs to calculate its content size and render the virtual items before it can accurately scroll to a position.

2. **Using `scrollToOffset()` is unreliable**: When using pixel-based offset scrolling, the virtual scroll viewport can misinterpret the position, especially if:
   - The viewport hasn't fully initialized
   - The item size has changed (e.g., user switched view modes)
   - The content hasn't been measured yet

3. **Timing issues**: Restoring too quickly (100ms delay) didn't give the viewport enough time to fully initialize, causing incorrect scroll positioning.

## Solution

The fix involves three key improvements:

### 1. Increased Initialization Delay
Changed from 100ms to 300ms to ensure the virtual scroll viewport is fully initialized before attempting to restore scroll position.

### 2. Convert Offset to Index
Instead of directly using `scrollToOffset()`, we now:
- Calculate the item index from the saved pixel offset
- Use `scrollToIndex()` which is more reliable for virtual scroll viewports
- This ensures the viewport properly renders content at the target position

### 3. Force Viewport Size Check
Call `checkViewportSize()` before scrolling to ensure the viewport has measured its content properly.

### 4. Enhanced Debug Logging
Added comprehensive logging to track:
- Saved position (offset)
- Calculated target index
- Current item size
- Viewport size
- Data length

This makes it easier to diagnose issues in the future.

## Code Changes

### ngAfterViewInit (Restore)
```typescript
ngAfterViewInit(): void {
  setTimeout(() => {
    const pubkey = this.accountState.pubkey();
    if (pubkey && this.viewport) {
      const savedPosition = this.accountLocalState.getPeopleScrollPosition(pubkey);
      if (savedPosition !== undefined && savedPosition > 0) {
        this.viewport.checkViewportSize();
        
        const dataLength = this.sortedPeople().length;
        const itemSize = this.itemSize();
        const targetIndex = Math.floor(savedPosition / itemSize);
        
        setTimeout(() => {
          if (this.viewport && targetIndex < dataLength) {
            this.viewport.scrollToIndex(targetIndex, 'auto');
          }
        }, 100);
      }
    }
  }, 300);
}
```

### ngOnDestroy (Save)
```typescript
ngOnDestroy(): void {
  const pubkey = this.accountState.pubkey();
  if (pubkey && this.viewport) {
    const currentOffset = this.viewport.measureScrollOffset();
    const itemSize = this.itemSize();
    const currentIndex = Math.floor(currentOffset / itemSize);
    
    this.logger.debug('Saved scroll position:', {
      offset: currentOffset,
      index: currentIndex,
      itemSize
    });
    
    this.accountLocalState.setPeopleScrollPosition(pubkey, currentOffset);
  }
}
```

## Testing

To verify the fix:

1. Scroll down the People page to any position
2. Navigate to a different page
3. Return to the People page
4. Verify the scroll position is restored to approximately where you left off
5. Check the browser console for debug logs showing the restoration details

## Future Improvements

Consider storing the **index** instead of the pixel offset in the future, as this would be more robust across different view modes and screen sizes. However, the current solution maintains backward compatibility with existing saved positions.
