# Notes Feed Fix - Using Regional Default Accounts

## Issue
Articles were rendering with default accounts when `followingList.length === 0`, but notes (kind:1 events) were not rendering at all.

## Root Cause
The `Algorithms.getRecommendedUsers()` method and `FeedService` fallback logic did not have the same regional default account logic that was implemented for articles.

### Specific Problems:
1. **Algorithms.getRecommendedUsers()** - Only returned users with meaningful engagement metrics, returning empty array for new users with zero following
2. **FeedService.loadFollowingFeed()** - When `topEngagedUsers.length === 0`, it fell back directly to `followingList`, which was empty for new users
3. **FeedService.loadCustomFeed()** - Similar issue with empty following list fallback

## Solution

### 1. Updated `Algorithms.getRecommendedUsers()` 
**File**: `src/app/services/algorithms.ts`

Added fallback logic to return regional default accounts when:
- No candidates found (no users with meaningful engagement)
- AND following list is empty

```typescript
// If no candidates found (new user with no metrics), use regional default accounts
if (allCandidates.length === 0) {
  const following = this.accountState.followingList();
  
  if (following.length === 0) {
    const account = this.accountState.account();
    const region = account?.region || 'us';
    const defaultAccounts = this.regionService.getDefaultAccountsForRegion(region);
    
    console.log(`Using ${defaultAccounts.length} default accounts for notes (region: ${region})`);
    
    // Create minimal metrics for default accounts
    const defaultMetrics: UserMetric[] = defaultAccounts.map(pubkey => ({
      pubkey,
      viewed: 0,
      profileClicks: 0,
      // ... other metric fields ...
      engagementScore: 1,
      finalScore: 1,
    }));
    
    return defaultMetrics.slice(0, limit);
  }
}
```

**Purpose**: Ensures `getRecommendedUsers()` returns default accounts for notes feed, matching the behavior of `getRecommendedUsersForArticles()`.

### 2. Updated `FeedService.loadFollowingFeed()` Fallback
**File**: `src/app/services/feed.service.ts`

Added RegionService injection:
```typescript
private readonly regionService = inject(RegionService);
```

Updated fallback logic when `topEngagedUsers.length === 0`:
```typescript
if (topEngagedUsers.length === 0) {
  this.logger.warn('No engaged users found, falling back to recent following');
  // Fallback to users from following list
  let followingList = this.accountState.followingList();
  
  // If following list is empty, use regional default accounts
  if (followingList.length === 0) {
    const account = this.accountState.account();
    const region = account?.region || 'us';
    followingList = this.regionService.getDefaultAccountsForRegion(region);
    this.logger.debug(`Using ${followingList.length} default accounts for notes (region: ${region})`);
  } else {
    this.logger.debug(`Following list size: ${followingList.length}`);
  }

  // For articles, use more users since articles are rarer
  const fallbackCount = isArticlesFeed ? 25 : 10;
  const fallbackUsers = [...followingList].slice(-fallbackCount).reverse();

  this.logger.debug(`Using ${fallbackUsers.length} fallback users`);
  await this.fetchEventsFromUsers(fallbackUsers, feedData);
  return;
}
```

**Purpose**: Ensures the second-level fallback (when algorithms return no users) also uses regional defaults instead of empty array.

### 3. Updated `FeedService.loadCustomFeed()` Fallback
**File**: `src/app/services/feed.service.ts`

Similar update for custom feeds:
```typescript
if (pubkeysArray.length === 0) {
  this.logger.warn('No pubkeys found for custom feed, falling back to following');
  // Fallback to following if no custom users are specified
  let followingList = this.accountState.followingList();
  
  // If following list is empty, use regional default accounts
  if (followingList.length === 0) {
    const account = this.accountState.account();
    const region = account?.region || 'us';
    followingList = this.regionService.getDefaultAccountsForRegion(region);
    this.logger.debug(`Using ${followingList.length} default accounts for custom feed (region: ${region})`);
  }
  
  const fallbackUsers = [...followingList].slice(-10).reverse();
  await this.fetchEventsFromUsers(fallbackUsers, feedData);
  return;
}
```

**Purpose**: Ensures custom feeds also show content from default accounts when following list is empty.

## Flow for New Users (Zero Following)

### Before Fix:
1. User loads feed → `getRecommendedUsers()` returns `[]` (no metrics)
2. FeedService sees empty array → falls back to `followingList` which is also `[]`
3. **Result**: Zero notes rendered ❌

### After Fix:
1. User loads feed → `getRecommendedUsers()` checks following list
2. Following list is empty → returns 10 default accounts from user's region
3. If algorithms somehow still return `[]`, FeedService fallback also uses regional defaults
4. **Result**: Notes from 15 default accounts rendered ✅

## Consistency Across Feed Types

| Feed Type | Algorithm Method | Fallback Location | Default Accounts |
|-----------|-----------------|-------------------|------------------|
| Articles (kind:30023) | `getRecommendedUsersForArticles()` | Within algorithm | ✅ Yes |
| Notes (kind:1) | `getRecommendedUsers()` | Within algorithm | ✅ Yes (NOW) |
| Following Feed | Both methods above | FeedService fallback | ✅ Yes (NOW) |
| Custom Feed | N/A | FeedService fallback | ✅ Yes (NOW) |

## Files Modified
1. `src/app/services/algorithms.ts` - Added regional defaults to `getRecommendedUsers()`
2. `src/app/services/feed.service.ts` - Updated fallback logic in `loadFollowingFeed()` and `loadCustomFeed()`

## Testing Checklist
- [ ] Verify notes render with zero following (should show content from 15 default accounts)
- [ ] Verify articles still render correctly (regression test)
- [ ] Verify custom feeds work with zero following
- [ ] Check console logs for "Using X default accounts for notes (region: Y)"
- [ ] Test in different regions (eu, us, af, sa, as) to ensure different defaults
- [ ] Verify behavior after following users (should switch from defaults to real following)

## Related Documentation
- See `FOLLOWSET_REFACTOR_COMPLETION.md` for the broader context of moving followset to People component
- Regional default accounts defined in `RegionService.defaultAccountsByRegion`
