# Metrics System Account Isolation Issue

## Problem Identified

The metrics system currently stores engagement data globally rather than per-account, causing data contamination when switching between accounts.

## Root Cause

### Current Storage Structure
- **Metrics Key**: `{tracked_user_pubkey}::metric`
- **Storage**: Global IndexedDB `info` store
- **No Account Context**: Metrics don't know which account recorded them

Example:
```typescript
// In storage.service.ts
async saveInfo(key: string, type: 'user' | 'relay' | 'metric', data: Record<string, any>)
// key = pubkey of tracked user (NOT the current account)
// Composite key = "tracked_pubkey::metric"
```

### What Gets Shared Across Accounts
1. **Engagement Scores** - Views, likes, replies, reposts for each user
2. **Time Spent** - How long you've viewed content from each user
3. **Interaction Timestamps** - When you last interacted with each user
4. **Profile Clicks** - How many times you've visited a user's profile

## Impact on Algorithm Page

### Current Behavior
When you switch accounts on the Algorithm page:
1. ✅ Following list updates correctly (account-specific)
2. ✅ Favorites update correctly (account-specific via FavoritesService)
3. ❌ **Metrics remain global** (shared across all accounts)
4. ❌ **Engagement scores are contaminated** with data from all accounts
5. ❌ **Recommended users are based on multi-account data**

### Example Scenario
```
Account A (Alice):
- Engages heavily with @bob (100 views, 20 likes)
- Follows @bob
- Algorithm shows @bob with high engagement

Switch to Account B (Bob):
- Has NEVER interacted with @bob
- Doesn't follow @bob
- Algorithm STILL shows engagement data from Account A
- If Account B follows @bob, metrics start at 100 views/20 likes (wrong!)
```

## Comparison with Correctly Implemented Services

### FavoritesService ✅ (Correct Implementation)
```typescript
// favorites.service.ts
private favoritesData = signal<FavoritesData>({}); 
// Type: Record<accountPubkey, string[]>

readonly favorites = computed(() => {
  const currentPubkey = this.accountState.pubkey();
  const data = this.favoritesData();
  return data[currentPubkey] || []; // ✅ Account-specific
});
```

### Metrics Service ❌ (Current Implementation)
```typescript
// metrics.ts
async getMetrics(): Promise<UserMetric[]> {
  const records = await this.storage.getInfoByType('metric');
  // ❌ Returns ALL metrics globally, no filtering by account
  return records.map(record => this.mapRecordToMetric(record));
}
```

## Required Solution

### Option 1: Per-Account Metrics Storage (Recommended)
Store metrics with account context in the key:

```typescript
// New composite key structure
const metricsKey = `${currentAccountPubkey}:${trackedUserPubkey}`;
await this.storage.saveInfo(metricsKey, 'metric', data);

// Storage: "alice_pubkey:bob_pubkey::metric"
```

**Pros:**
- Clean separation of account data
- No data contamination
- Each account has independent engagement history
- Better privacy

**Cons:**
- Requires migration of existing metrics data
- Breaking change to storage format

### Option 2: Filter at Query Time
Keep current storage but filter by account:

```typescript
// Add account_pubkey field to metric data
async getMetrics(): Promise<UserMetric[]> {
  const currentPubkey = this.accountState.pubkey();
  const records = await this.storage.getInfoByType('metric');
  return records
    .filter(r => r.account_pubkey === currentPubkey)
    .map(record => this.mapRecordToMetric(record));
}
```

**Pros:**
- Simpler migration path
- Can add account field without changing keys

**Cons:**
- All accounts' metrics loaded into memory even if filtered
- Less efficient
- Still need to migrate existing data

## Implementation Plan

### Phase 1: Add Account Context
1. Update `UserMetric` interface to include `accountPubkey`
2. Update `Metrics.updateMetric()` to include current account
3. Update `Metrics.saveMetric()` to store account context

### Phase 2: Update Storage Keys
1. Modify composite key generation:
   ```typescript
   private generateMetricsKey(accountPubkey: string, trackedPubkey: string): string {
     return `${accountPubkey}:${trackedPubkey}`;
   }
   ```

### Phase 3: Migration Strategy
1. Create migration function to:
   - Load existing metrics
   - Assign them to current account (or prompt user)
   - Re-save with new key structure
2. Add version flag to detect old data format
3. Run migration on first load after update

### Phase 4: Update All Metrics Methods
Update these methods to be account-aware:
- `getMetrics()` - Filter by current account
- `getUserMetric()` - Include account in query
- `getUserMetrics()` - Include account in query
- `updateMetric()` - Include account in storage key
- `queryMetrics()` - Filter by account
- `resetUserMetrics()` - Only reset for current account
- `resetAllMetrics()` - Only reset for current account (or add confirmation)

### Phase 5: Update Algorithms Service
All algorithm methods that use metrics will automatically benefit from account-specific data:
- `calculateProfileViewed()`
- `getRecommendedUsers()`
- `calculateContentAffinity()`
- `getDeclineingEngagementUsers()`
- `getRecommendedUsersForArticles()`

## Testing Plan

1. **Account Isolation Test**
   - Track engagement on Account A
   - Switch to Account B
   - Verify metrics are empty for same users
   - Track different engagement on Account B
   - Switch back to Account A
   - Verify Account A metrics unchanged

2. **Migration Test**
   - Create metrics with old format
   - Run migration
   - Verify all metrics assigned correctly
   - Verify new metrics use new format

3. **Algorithm Test**
   - Verify recommended users differ per account
   - Verify engagement scores are account-specific
   - Verify favorites + metrics work together correctly

## Files That Need Changes

1. **src/app/interfaces/metrics.ts** - Add `accountPubkey` to `UserMetric`
2. **src/app/services/metrics.ts** - Update all methods
3. **src/app/services/algorithms.ts** - May need minor updates
4. **src/app/pages/settings/algorithm/algorithm.ts** - Already reactive to account changes ✅
5. **Migration service** - New file for data migration

## Backward Compatibility

To maintain existing data:
1. Detect old format metrics (no account context)
2. Prompt user on first load: "Assign existing metrics to current account?"
3. If declined, archive old metrics
4. If accepted, migrate to new format with current account
5. Add version marker to prevent re-migration

## Priority

**HIGH** - This is a privacy and data integrity issue. Users expect their engagement data to be account-specific.
