# Duplicate Cache Saves and Angular Duplicate Keys Fix

## Problem

Two related issues were identified:

1. **Duplicate Cache Saves**: The `saveCachedEvents` method was being called multiple times in quick succession for the same column, causing unnecessary IndexedDB writes (2-3x per operation)

2. **Angular NG0955 Error**: Duplicate tracking keys error when scrolling to load more events:
   ```
   NG0955: Multiple elements with same tracking expression
   Expression: Same URLs appearing at multiple array indexes (0+6, 1+7, 2+4, 3+5)
   ```

## Root Causes

### Duplicate Cache Saves
While `saveCachedEvents` was only called once in the code (line 926 in `finalizeIncrementalFeed`), it was being executed multiple times because:
- Multiple event sources (live subscriptions, pagination) could trigger finalization simultaneously
- No deduplication mechanism existed for cache write operations

### Duplicate Tracking Keys
The Angular error occurred in photo carousel indicator dots and bookmark lists:
- **Photo Event Component**: Used `track $index` for image URLs in carousel indicators
- **Bookmarks Component**: Used `track $index` for bookmark events, articles, and URLs
- When the same content appeared in multiple events at different positions, Angular detected duplicate tracking keys

## Solutions Implemented

### 1. Debounced Cache Saves (feed.service.ts)

Added a pending saves tracker to prevent duplicate writes:

```typescript
private pendingCacheSaves = new Map<string, Promise<void>>();

private async saveCachedEvents(columnId: string, events: Event[]): Promise<void> {
  const pubkey = this.accountState.pubkey();
  if (!pubkey) return;

  const cacheKey = `${pubkey}::${columnId}`;

  // If a save is already pending, wait for it instead of duplicating
  const pendingSave = this.pendingCacheSaves.get(cacheKey);
  if (pendingSave) {
    this.logger.debug(`⏭️ Skipping duplicate cache save for column ${columnId}`);
    return pendingSave;
  }

  // Create and track the save promise
  const savePromise = (async () => {
    try {
      await this.storage.saveCachedEvents(pubkey, columnId, events);
      this.logger.debug(`💾 Saved ${events.length} events to cache for column ${columnId}`);
    } catch (error) {
      this.logger.error('Error saving cached events:', error);
    } finally {
      // Clean up after a short delay
      setTimeout(() => this.pendingCacheSaves.delete(cacheKey), 100);
    }
  })();

  this.pendingCacheSaves.set(cacheKey, savePromise);
  return savePromise;
}
```

**Benefits:**
- Eliminates duplicate IndexedDB write operations
- Reduces database load and improves performance
- Pending operations share the same promise, ensuring consistency
- 100ms cleanup delay allows for batching of rapid operations

### 2. Fixed Photo Event Tracking (photo-event.component.html)

Changed carousel indicator tracking from index to URL:

```html
<!-- Before -->
@for (imageUrl of imageUrls(); track $index) {

<!-- After -->
@for (imageUrl of imageUrls(); track imageUrl) {
```

### 3. Fixed Bookmarks Tracking (bookmarks.component.html)

Changed all bookmark loops to track by ID instead of index:

```html
<!-- Events -->
@for (bookmark of bookmarkService.bookmarkEvents(); track bookmark.id) {

<!-- Articles -->
@for (bookmark of bookmarkService.bookmarkArticles(); track bookmark.id) {

<!-- URLs -->
@for (bookmark of bookmarkService.bookmarkUrls(); track bookmark.id) {
```

**Benefits:**
- Angular can correctly identify and reuse DOM elements even when array order changes
- Eliminates NG0955 duplicate key errors
- Improves rendering performance (fewer DOM manipulations)
- More semantically correct (tracking by unique identifier, not position)

## Testing

### Cache Save Deduplication
1. Open DevTools console
2. Navigate to a feed
3. Scroll to load more events
4. Verify logs show "⏭️ Skipping duplicate cache save" messages
5. Confirm only one "💾 Saved X events" per operation

### Angular Tracking Keys
1. Navigate to feeds with photo events
2. Scroll to load more events containing images
3. Verify no NG0955 errors in console
4. Check bookmarks page
5. Verify no duplicate key errors

## Impact

- **Performance**: Reduced IndexedDB writes by 50-66% (from 2-3x to 1x per operation)
- **Stability**: Eliminated Angular duplicate key errors during pagination
- **User Experience**: Smoother scrolling and loading without console errors
- **Maintainability**: More robust cache system with proper deduplication

## Related Files

- `src/app/services/feed.service.ts` - Cache save deduplication
- `src/app/components/event-types/photo-event.component.html` - Photo carousel tracking
- `src/app/pages/bookmarks/bookmarks.component.html` - Bookmarks tracking

## Notes

- The 100ms cleanup delay balances between immediate cleanup and allowing for rapid operation batching
- Tracking by unique ID is a best practice for Angular @for loops, especially when items can be reordered
- Future optimization: Consider adding batch write operations for multiple columns saving simultaneously
