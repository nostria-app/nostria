# Drag and Drop Test Plan

## Test 1: Column Reordering Preserves State
1. Open the application at http://localhost:4200
2. Navigate to the feeds page
3. Scroll down in one of the columns to see some content
4. Drag and drop that column to a different position
5. **Expected Result**: The column should maintain its scroll position and content
6. **Look for in console**: Log messages showing optimized updateColumnOrder method being used

## Test 2: Column-Specific Refresh
1. Click the refresh button on one specific column
2. **Expected Result**: Only that column should refresh, others should remain unchanged
3. **Look for in console**: Log messages showing only the specific column being refreshed

## Console Logs to Watch For:
- `🔄 Column drop event: { previousIndex: X, currentIndex: Y }`
- `📋 Columns reordered: [column names and IDs]`
- `⚡ Using optimized updateColumnOrder method`
- `⚡ FeedsCollectionService: Updating column order for feed [feedId]`
- `🔄 FeedService: Updating column order for feed [feedId]`
- `✅ FeedService: Column order updated successfully without subscription changes`

For refresh testing:
- `🔄 Refreshing column: [column name] ([column id])`
- `🔄 FeedService: Refreshing column [columnId]`
- `✅ FeedService: Column [columnId] refreshed successfully`

## Success Criteria:
✅ Columns maintain scroll position during drag and drop
✅ Content doesn't reload during column reordering
✅ Only specific columns refresh when their refresh button is clicked
✅ Console shows optimized methods being used
✅ No unnecessary subscription changes during drag operations
