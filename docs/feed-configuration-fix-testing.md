# Testing Guide: Feed Configuration Fix

This document provides step-by-step testing instructions to verify that the feed configuration reset bug has been fixed.

## Background

The bug was causing user's custom feed configurations to be reset to defaults when:
1. Users had an empty feed array (intentionally deleted all feeds)
2. Users switched between accounts

## Pre-requisites for Testing

1. Build and run the application locally
2. Have access to browser developer tools (for localStorage inspection)
3. Have at least two test accounts (pubkeys) ready

## Test Scenarios

### Scenario 1: First-Time User (Should Get Defaults)

**Steps:**
1. Clear all localStorage data for the application
2. Log in with a new account (Account A)
3. Check the feeds

**Expected Result:**
- ✅ User should see default feeds (For You, Following, Discover, Articles)
- ✅ Feeds should be saved to localStorage under the account's pubkey

**Verification:**
```javascript
// In browser console
localStorage.getItem('nostria-feeds')
// Should show default feeds for Account A's pubkey
```

---

### Scenario 2: Returning User with Custom Feeds (Should Keep Configuration)

**Steps:**
1. Using Account A from Scenario 1
2. Customize feeds (add/remove/reorder columns)
3. Note the custom configuration
4. Log out and log back in with the same account

**Expected Result:**
- ✅ User should see their custom feed configuration
- ✅ NO reset to defaults should occur

**Verification:**
```javascript
// In browser console before logout
const feedsBefore = JSON.parse(localStorage.getItem('nostria-feeds'));
console.log(feedsBefore);

// After login
const feedsAfter = JSON.parse(localStorage.getItem('nostria-feeds'));
console.log(feedsAfter);
// feedsBefore and feedsAfter should be identical for Account A
```

---

### Scenario 3: User Deletes All Feeds (Should Keep Empty List)

**Steps:**
1. Using Account A with custom feeds
2. Delete all feeds one by one using the UI
3. Verify the feed list is empty
4. Log out and log back in

**Expected Result:**
- ✅ Feed list should remain empty (NOT reset to defaults)
- ✅ localStorage should contain an empty array for this pubkey

**Verification:**
```javascript
// In browser console after login
const feeds = JSON.parse(localStorage.getItem('nostria-feeds'));
console.log(feeds); 
// Should show empty array [] for Account A's pubkey
```

---

### Scenario 4: Multi-Account Support (Each Account Maintains Own Configuration)

**Steps:**
1. Log in with Account A (has custom feeds)
2. Note Account A's feed configuration
3. Log out and log in with Account B (new account)
4. Note Account B gets default feeds
5. Customize Account B's feeds differently from Account A
6. Log out and log back in to Account A

**Expected Result:**
- ✅ Account A should still have its original custom configuration
- ✅ Account B should have its own different configuration
- ✅ Switching between accounts should NOT reset either account's feeds

**Verification:**
```javascript
// In browser console
const feeds = JSON.parse(localStorage.getItem('nostria-feeds'));
console.log(feeds);
// Should show:
// {
//   "pubkeyA": [custom feeds for A],
//   "pubkeyB": [custom feeds for B]
// }
```

---

### Scenario 5: Manual Reset Still Works

**Steps:**
1. Using Account A with custom feeds
2. Navigate to Settings/Feeds menu
3. Select "Reset to Defaults" option
4. Confirm the reset

**Expected Result:**
- ✅ Feeds should be reset to defaults
- ✅ Reset should only affect the current account

**Verification:**
- After reset, verify default feeds are shown
- If you have Account B with custom feeds, switch to it and verify B's feeds are unchanged

---

### Scenario 6: Error Handling (localStorage Corruption)

**Steps:**
1. Manually corrupt localStorage data:
```javascript
localStorage.setItem('nostria-feeds', 'invalid json');
```
2. Refresh the page
3. Log in

**Expected Result:**
- ✅ Application should not crash
- ✅ Should fallback to default feeds
- ✅ Error should be logged to console

**Verification:**
- Check browser console for error message
- Verify default feeds are displayed
- Verify localStorage is repaired with valid data

---

## Automated Testing (Future Enhancement)

Consider adding these unit tests to `feed.service.spec.ts`:

```typescript
describe('getFeedsFromStorage', () => {
  it('should return null when feedsByAccount is null', () => {
    // Test implementation
  });

  it('should return null when pubkey is not in feedsByAccount', () => {
    // Test implementation
  });

  it('should return empty array when user deleted all feeds', () => {
    // Test implementation
  });

  it('should return stored feeds for existing user', () => {
    // Test implementation
  });
});

describe('loadFeeds', () => {
  it('should initialize defaults for new users', async () => {
    // Test implementation
  });

  it('should load stored feeds for returning users', async () => {
    // Test implementation
  });

  it('should preserve empty array for users who deleted all feeds', async () => {
    // Test implementation
  });
});
```

## Regression Testing

Before marking this fix as complete, verify that:

1. ✅ All existing functionality still works
2. ✅ Feed subscription and data loading works correctly
3. ✅ Column drag-and-drop reordering works
4. ✅ Adding/removing columns works
5. ✅ Feed switching works
6. ✅ No console errors appear during normal operation

## Known Limitations

None identified. The fix is backward compatible with existing localStorage data.

## Rollback Plan

If issues are discovered:

1. Revert the changes in `feed.service.ts`
2. Clear localStorage for affected users
3. Users will need to reconfigure their feeds

## Success Criteria

This fix is considered successful when:

- ✅ All 6 test scenarios pass
- ✅ No new console errors are introduced
- ✅ No user reports of feed configuration resets
- ✅ Existing functionality remains intact
