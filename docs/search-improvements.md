# Search UI and Web of Trust Improvements

## Summary

This document describes the improvements made to the search functionality in Nostria, including the addition of a dedicated search menu item and integration of Web of Trust (WoT) scoring to improve search result relevance.

## Changes Made

### 1. Main Navigation Menu (`src/app/app.ts`)

Added a new "Search" menu item to the main navigation sidebar:
- **Label**: "Search"
- **Icon**: `manage_search` (Material icon)
- **Path**: `/search`
- **Position**: Between "Discover" and "People" menu items
- **Authentication**: Not required (accessible to all users)

This change addresses the requirement to provide direct access to the advanced search UI without requiring users to first perform a quick search and then click "Advanced Search".

### 2. Command Palette (`src/app/components/command-palette-dialog/command-palette-dialog.component.ts`)

Added a new command to the Command Palette (Ctrl+K):
- **ID**: `nav-search`
- **Label**: "Open Advanced Search"
- **Icon**: `manage_search`
- **Keywords**: search, advanced search, find, lookup, query
- **Action**: Navigate to `/search`

This allows users to quickly access the advanced search page via keyboard shortcut.

### 3. Search Service (`src/app/services/search.service.ts`)

#### Extended Interface
```typescript
export interface SearchResultProfile extends NostrRecord {
  source: 'following' | 'cached' | 'remote';
  wotRank?: number; // Web of Trust rank score
}
```

#### New Method: `enrichWithWoTScoresAndSort()`
This method implements the Web of Trust scoring and sorting logic:

1. **Batch Fetching**: Uses `TrustService.fetchMetricsBatch()` to efficiently retrieve WoT metrics for all profiles in a single batch operation
2. **Enrichment**: Adds the WoT rank score to each search result profile
3. **Sorting**: Applies a smart sorting algorithm:
   - **Primary**: Profiles with WoT rank scores are sorted by rank (lower is better - rank 1 is most trusted)
   - **Secondary**: Profiles without WoT scores are sorted by source priority (following > cached > remote)
4. **Graceful Degradation**: If WoT is disabled or metrics are unavailable, falls back to unsorted results

#### Updated Search Flows

**Local Search Flow**:
```
User enters query
  ↓
Search local profiles (following + cached)
  ↓
Enrich with WoT scores and sort
  ↓
Display results
  ↓
Background: Search remote relays
  ↓
Merge and re-sort all results with WoT scores
```

**Remote Search Flow**:
When remote results arrive, they are merged with existing results and the entire result set is re-enriched and re-sorted to maintain proper WoT ranking order.

## Technical Details

### Web of Trust Integration

The implementation leverages the existing `TrustService` which:
- Fetches NIP-85 Web of Trust data from configured relays
- Provides batch fetching for efficiency
- Caches metrics to avoid redundant relay queries
- Returns trust metrics including rank, followers, post count, zap amounts, and more

### Sorting Algorithm

The sorting algorithm prioritizes search results as follows:

1. **Profiles with WoT rank** (sorted by rank, ascending)
   - Rank 1 = Highest trust
   - Rank 100 = Lower trust
   
2. **Profiles without WoT rank** (sorted by source)
   - Following (people you follow)
   - Cached (previously seen profiles)
   - Remote (newly discovered profiles)

This ensures that:
- High-trust profiles appear first, helping combat fake accounts
- Users' followed profiles still appear prominently if they have good WoT scores
- Remote profiles from search relays are ranked appropriately based on WoT data

### Performance Considerations

- **Batch Fetching**: All WoT metrics are fetched in a single batch operation to minimize relay queries
- **Caching**: The `TrustService` maintains an in-memory cache to avoid repeated relay lookups
- **Async Processing**: WoT enrichment happens asynchronously to avoid blocking the UI
- **Progressive Enhancement**: Results are shown immediately, then re-sorted when WoT data becomes available

## User Benefits

1. **Easier Access**: Users can now access advanced search directly from the main menu or command palette
2. **Better Results**: Search results are sorted by Web of Trust scores, showing more trustworthy profiles first
3. **Reduced Spam**: Fake accounts and spam profiles (which typically have low or no WoT scores) appear lower in results
4. **Familiar Interface**: Integration is seamless and doesn't change the existing search experience

## Testing Instructions

### Manual Testing

1. **Menu Item Test**:
   - Open the application
   - Open the sidebar navigation menu
   - Verify "Search" appears between "Discover" and "People"
   - Click on "Search" - should navigate to `/search`

2. **Command Palette Test**:
   - Press `Ctrl+K` (or `Cmd+K` on Mac) to open command palette
   - Type "search" or "advanced"
   - Verify "Open Advanced Search" command appears
   - Select the command - should navigate to `/search`

3. **Quick Search with WoT Sorting**:
   - Open the quick search (click search icon or press `/`)
   - Enter a common name (e.g., "jack", "alice", "bob")
   - Observe the results:
     - If WoT is enabled, profiles should be sorted with higher-trust profiles first
     - Profiles from people you follow should still appear prominently if they have good WoT scores
     - Remote profiles should be properly ranked based on WoT data

4. **WoT Disabled Test**:
   - Disable Web of Trust in settings (if applicable)
   - Perform a search
   - Results should still appear but sorted by source priority (following > cached > remote)

### Browser Console Debugging

You can monitor WoT enrichment in the browser console:
- Look for log messages like: `"Enriched X profiles with WoT scores"`
- Check for any error messages related to WoT fetching

### Expected Behavior

- Search results should appear quickly (local results first)
- Remote results should merge in after a brief delay
- If WoT is enabled, results should re-sort when WoT data becomes available
- No errors should appear in the console

## Future Enhancements

Potential improvements for future iterations:

1. **Visual WoT Indicators**: Show WoT rank badges or trust indicators on profile cards
2. **WoT Filtering**: Allow users to filter results by minimum WoT rank
3. **Custom Sorting**: Let users choose between WoT sorting and other criteria
4. **WoT Status**: Show whether WoT data is being loaded or if it's unavailable
5. **Performance Metrics**: Track and display WoT enrichment time in debug mode

## Related Files

- `src/app/app.ts` - Main navigation menu
- `src/app/components/command-palette-dialog/command-palette-dialog.component.ts` - Command palette
- `src/app/services/search.service.ts` - Search logic with WoT integration
- `src/app/services/trust.service.ts` - Web of Trust service (existing)
- `src/app/components/search-results/search-results.component.ts` - Search results UI
- `src/app/pages/search/search.component.ts` - Advanced search page

## Architecture Alignment

This implementation follows the Nostria architecture principles:

- **Services**: Business logic is kept in services (`SearchService`, `TrustService`)
- **Signals**: Reactive state management using Angular signals
- **Performance**: Batch operations and caching for efficiency
- **User Experience**: Progressive enhancement without blocking the UI
- **Error Handling**: Graceful fallbacks when WoT is unavailable
