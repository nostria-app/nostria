# Remove Default Accounts Functionality

## Summary
Removed the regional default accounts fallback feature from the application. When users are not following anyone, the algorithms and feeds now return empty results instead of suggesting default accounts based on region.

## Changes Made

### 1. algorithms.ts
Updated three methods to return empty arrays when the user has no following:

**`calculateProfileViewed()`**
- Removed: Regional default accounts fallback
- Changed: Returns empty array `[]` when `following.length === 0`
- Removed: `regionService.getDefaultAccountsForRegion()` call

**`getRecommendedUsers()`**
- Removed: Regional default accounts fallback with metrics generation
- Changed: Returns empty array `[]` when `allCandidates.length === 0`
- Removed: Complex fallback logic that created minimal metrics for default accounts

**`getRecommendedUsersForArticles()`**
- Removed: Regional default accounts fallback
- Changed: Returns empty array `[]` when `following.length === 0`
- Removed: `regionService.getDefaultAccountsForRegion()` call

### 2. feed.service.ts
Updated feed loading logic in two locations:

**Notes/Articles Feed Loading**
- Removed: Regional default accounts fallback
- Changed: Returns early with debug message when `followingList.length === 0`
- Changed: `let followingList` to `const followingList` (no longer reassigned)

**Custom Feed Loading**
- Removed: Regional default accounts fallback
- Changed: Returns early with debug message when `followingList.length === 0`
- Changed: `let followingList` to `const followingList` (no longer reassigned)

## Behavior Changes

### Before
- New users with no following would see content from regional default accounts
- Empty following lists would be replaced with ~15 default accounts per region
- Users always had some content to view, even without following anyone

### After
- New users with no following see no content
- Empty following lists result in empty feeds
- Users must actively follow accounts to see content
- Cleaner separation: no implicit follows or suggestions

## Benefits
1. **Explicit User Control**: Users explicitly choose who to follow
2. **No Hidden Suggestions**: No implicit content from accounts users didn't choose
3. **Cleaner Onboarding**: Forces users to understand the follow model
4. **Predictable Behavior**: Following list directly determines content visibility
5. **Code Simplification**: Removed regional account management complexity

## Migration Notes
- The `RegionService.getDefaultAccountsForRegion()` method still exists but is no longer used
- The `defaultAccountsByRegion` map in `RegionService` can be removed in a future cleanup
- No data migration needed as this only affects algorithm behavior

## Testing Recommendations
1. Test new user experience with empty following list
2. Verify feeds show empty state when not following anyone
3. Confirm adding follows populates feeds correctly
4. Test that regional settings don't affect feed content anymore

## Related Files
- `src/app/services/algorithms.ts` - Algorithm logic
- `src/app/services/feed.service.ts` - Feed loading logic
- `src/app/services/region.service.ts` - Region service (unchanged but unused)
