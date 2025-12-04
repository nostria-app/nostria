# How to Test the Zap Split Feature

## Prerequisites
1. Have the app running locally: `npm start`
2. Be logged in with a Nostr account
3. Find a note to quote

## Testing Steps

### Step 1: Quote a Note
1. Navigate to any note in your feed
2. Click the repost button (repeat icon)
3. Select "Quote" from the menu
4. The note editor dialog should open with quote context shown

### Step 2: Access Zap Split Option
1. In the note editor, look at the bottom toolbar
2. Click the "⚙️ Advanced Options" button
3. The advanced options panel should expand
4. Scroll to the bottom to find "Enable Zap Split" toggle
5. **Important**: The option should ONLY appear if:
   - ✅ You're quoting a note (quote context is shown)
   - ✅ You're logged in (have a Nostr account)

### Step 3: Enable and Configure Zap Split
1. Toggle "Enable Zap Split" to ON
2. Two sliders should appear:
   - **Original Author** slider (default: 90%)
   - **You (Quoter)** slider (default: 10%)
3. Try adjusting the "Original Author" slider:
   - Drag it to 80%
   - The "You (Quoter)" slider should auto-update to 20%
4. Try adjusting the "You (Quoter)" slider:
   - Drag it to 30%
   - The "Original Author" slider should auto-update to 70%
5. Verify the percentages always sum to 100%

### Step 4: Verify UI Elements
Check that all UI elements are present:
- [ ] Toggle switch (purple when ON, gray when OFF)
- [ ] Two sliders with tick marks
- [ ] Percentage displays (e.g., "90%") next to each slider
- [ ] Labels: "Original Author" and "You (Quoter)"
- [ ] Hint text explaining NIP-57 automatic splitting

### Step 5: Publish the Quote
1. Add some commentary text in the editor
2. Click the "Publish" button
3. The quote should publish successfully
4. No errors should appear

### Step 6: Verify Tags (Advanced)
To verify the zap tags were added correctly:

1. After publishing, the app should navigate to the published quote
2. Open browser developer console (F12)
3. Find the event object in the console or network tab
4. Look for tags in the event JSON
5. You should see tags like:
```json
{
  "tags": [
    ["q", "<quote_id>", "", "<original_author_pubkey>"],
    ["p", "<original_author_pubkey>"],
    ["zap", "<original_author_pubkey>", "", "90"],
    ["zap", "<your_pubkey>", "", "10"]
  ]
}
```

### Expected Behavior

#### When NOT Quoting
- ❌ Zap split option should NOT appear
- Only other advanced options visible (Upload Original, Client Tag, etc.)

#### When Quoting but NOT Logged In
- ❌ Zap split option should NOT appear
- App should prompt to log in if attempting to publish

#### When Quoting AND Logged In
- ✅ Zap split option SHOULD appear
- Toggle starts in OFF position
- Sliders hidden until toggle is enabled

#### With Toggle Disabled
- Sliders are hidden
- No zap tags added to the published event
- Quote publishes normally without split

#### With Toggle Enabled
- Sliders are visible
- Default shows 90/10 split
- Sliders are linked (changing one updates the other)
- Percentages always sum to 100%
- Zap tags are added to the published event

### Common Issues & Solutions

#### Issue: Zap split option doesn't appear
**Check**:
- Are you quoting a note? (Quote context should be visible at top)
- Are you logged in? (Profile icon should show your account)
- Did you click "Advanced Options"?

#### Issue: Percentages don't sum to 100%
**This should never happen** - if it does, it's a bug. The sliders are linked.

#### Issue: Can't adjust sliders
**Check**:
- Is the toggle enabled (purple, not gray)?
- Try clicking directly on the slider track

#### Issue: Quote publishes but no zap tags
**Check**:
- Was the toggle enabled when you clicked publish?
- View the event JSON to confirm tags are missing
- Report as a bug if toggle was ON but tags are missing

### Manual Tag Verification

If you want to manually verify the tags without using developer tools:

1. After publishing, copy the note ID (nevent or note1...)
2. Use a Nostr event viewer like:
   - https://nostr.band
   - https://nostrrr.com
   - Any other Nostr client
3. Paste the note ID
4. Look at the raw event JSON
5. Check for "zap" tags in the tags array

### Test Cases

#### Test Case 1: Default Split
1. Quote a note
2. Enable zap split
3. Don't adjust sliders (keep 90/10)
4. Publish
5. **Expected**: Tags show 90% to original author, 10% to you

#### Test Case 2: Custom Split
1. Quote a note
2. Enable zap split
3. Adjust to 80/20
4. Publish
5. **Expected**: Tags show 80% to original author, 20% to you

#### Test Case 3: Extreme Split (100/0)
1. Quote a note
2. Enable zap split
3. Adjust to 100/0 (all to original author)
4. Publish
5. **Expected**: Only one zap tag (for original author at 100%)

#### Test Case 4: Extreme Split (0/100)
1. Quote a note
2. Enable zap split
3. Adjust to 0/100 (all to you)
4. Publish
5. **Expected**: Only one zap tag (for you at 100%)

#### Test Case 5: Toggle Off
1. Quote a note
2. Enable zap split
3. Adjust sliders
4. Disable toggle
5. Publish
6. **Expected**: No zap tags in the event

### Success Criteria

The feature is working correctly if:
- ✅ Option appears only when quoting AND logged in
- ✅ Toggle enables/disables the feature
- ✅ Sliders are linked (sum to 100%)
- ✅ Default is 90/10 (90% original, 10% quoter)
- ✅ Percentages display in real-time
- ✅ Zap tags are added when enabled
- ✅ Tags have correct format per NIP-57
- ✅ Zero-weight tags are excluded
- ✅ Quote publishes successfully
- ✅ No errors in console

### Troubleshooting

If something doesn't work:
1. Check browser console for errors
2. Verify you're on the latest code
3. Clear browser cache
4. Restart the dev server
5. Try in incognito mode
6. Report the issue with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser console errors
   - Screenshots if possible

### What Happens Next

After you publish a quote with zap split enabled:

1. **The Event**: Published to Nostr relays with zap tags
2. **Visibility**: Anyone can see the quote (normal note)
3. **The Tags**: Embedded in the event JSON (invisible to most users)
4. **Zapping**: When someone zaps your quote:
   - Their NIP-57 wallet reads the zap tags
   - Calculates the split automatically
   - Sends payments to both recipients
   - You and the original author both receive sats

### NIP-57 Compatible Wallets

For the zap split to work, the sender must use a NIP-57 Appendix G compatible wallet. Examples:
- Alby
- Zeus
- Mutiny
- Other wallets implementing NIP-57 splits

### Questions?

If you have questions about the feature:
1. Check `docs/zap-split-feature.md` for details
2. Check `docs/zap-split-ui-mockup.md` for UI specs
3. Check `docs/zap-split-security.md` for security info
4. Ask in the project Discord/Telegram

## Automated Testing (Optional)

If you want to write automated tests:

```typescript
describe('Zap Split Feature', () => {
  it('should show zap split option when quoting', () => {
    // Test that option appears when isQuote() && currentPubkey()
  });
  
  it('should hide zap split option when not quoting', () => {
    // Test that option is hidden when !isQuote()
  });
  
  it('should link sliders to maintain 100% total', () => {
    // Test that changing one slider updates the other
  });
  
  it('should add zap tags when enabled', () => {
    // Test that buildTags() includes zap tags
  });
  
  it('should skip zero-weight tags', () => {
    // Test that 0% recipients don't get tags
  });
});
```

## Done! 🎉

You've successfully tested the zap split feature. If everything works as described above, the feature is ready to use!
