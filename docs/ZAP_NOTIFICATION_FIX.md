# Zap Notification Fix - Missing Zaps in Notification History

## Issue Description

Zap notifications were not appearing correctly in the notification history, particularly zaps received on notes/comments. When users checked their notifications, many zaps they had received (visible when viewing individual notes) were missing from the activity feed.

## Root Causes

### 1. **Incorrect Author Pubkey Extraction**

**The Bug:**
```typescript
// OLD CODE (INCORRECT)
authorPubkey: event.pubkey,  // This is the LNURL service's pubkey, NOT the zapper!
```

In a zap receipt (kind 9735):
- `event.pubkey` is the **Lightning node's/LNURL service's pubkey** that issued the receipt
- The actual **zapper's pubkey** is inside the `description` tag (which contains the zap request kind 9734)

**The Impact:**
- All zap notifications showed the LNURL service as the author instead of the actual person who zapped
- Notification IDs were generated using the LNURL service pubkey, causing potential collisions
- Users couldn't see who actually zapped them

**The Fix:**
```typescript
// NEW CODE (CORRECT)
const descriptionTag = event.tags.find(tag => tag[0] === 'description');
let zapperPubkey = event.pubkey; // Fallback to LNURL service pubkey

if (descriptionTag && descriptionTag[1]) {
  try {
    const zapRequest = JSON.parse(descriptionTag[1]);
    if (zapRequest && zapRequest.pubkey) {
      zapperPubkey = zapRequest.pubkey; // This is the actual zapper
    }
  } catch (err) {
    this.logger.warn('Failed to parse zap request description', err);
  }
}

authorPubkey: zapperPubkey, // Use the actual zapper's pubkey
```

### 2. **Insufficient Query Limit**

**The Bug:**
```typescript
// OLD CODE
limit: 50,  // Only fetches 50 most recent zaps
```

**The Impact:**
- If a user received more than 50 zaps since the last check, older zaps would be missed
- Popular posts with many zaps would only show the first 50 in notifications

**The Fix:**
```typescript
// NEW CODE
limit: 100,  // Increased limit to catch more zaps
```

While still not unlimited (to avoid performance issues), this doubles the window and should catch most cases.

### 3. **Non-Unique Notification IDs**

**The Bug:**
```typescript
// OLD CODE
id: `content-${data.type}-${data.authorPubkey}-${data.timestamp}`
```

**The Impact:**
- Multiple zaps from the same person in the same second would have identical IDs
- Notifications with identical IDs would overwrite each other
- This was especially problematic since `authorPubkey` was the LNURL service pubkey (same for all zaps)

**The Fix:**
```typescript
// NEW CODE
const notificationId = data.eventId 
  ? `content-${data.type}-${data.eventId}`  // Use unique event ID
  : `content-${data.type}-${data.authorPubkey}-${data.timestamp}`; // Fallback
```

Now each zap notification uses the zap receipt's unique event ID, guaranteeing no collisions.

### 4. **Missing Zapped Event Context**

**Enhancement:**
We now extract and store which specific event/note was zapped:

```typescript
// Extract the event that was zapped (if any)
const eTag = zapRequest.tags?.find((t: string[]) => t[0] === 'e');
if (eTag && eTag[1]) {
  zapRequestEventId = eTag[1];
}

// Store in metadata
metadata: {
  zapAmount,
  zappedEventId: zapRequestEventId, // Store which event was zapped
}
```

This allows the UI to potentially show context like "John zapped your note about Bitcoin" instead of just "John zapped you".

## Zap Receipt Structure (NIP-57)

Understanding the structure is key to the fix:

```json
{
  "kind": 9735,
  "pubkey": "lnurl-service-pubkey-here",  // NOT the zapper!
  "created_at": 1697800000,
  "tags": [
    ["p", "recipient-pubkey-here"],  // Person receiving the zap
    ["e", "note-id-here"],           // Note being zapped (optional)
    ["bolt11", "lnbc..."],           // Lightning invoice
    ["description", "{\"kind\":9734,\"pubkey\":\"actual-zapper-pubkey\",\"tags\":[[\"e\",\"note-id\"],[\"p\",\"recipient\"]],...]"}
  ],
  "content": "",
  "id": "zap-receipt-id",
  "sig": "..."
}
```

**Key Points:**
1. **`pubkey`**: LNURL service that issued the receipt
2. **`#p` tag**: Recipient of the zap (YOU if you received it)
3. **`#e` tag**: Event that was zapped (present if zapping a note)
4. **`description` tag**: Contains the original zap request (kind 9734) which has:
   - The **actual zapper's pubkey** (`zapRequest.pubkey`)
   - The **event being zapped** (`zapRequest.tags` with `#e`)
   - The **zap amount** in the `#amount` tag

## Query Pattern

The notification service correctly queries:
```typescript
{
  kinds: [9735],      // Zap receipts
  '#p': [pubkey],     // Where you're the recipient
  since: timestamp,   // Since last check
  limit: 100          // Fetch up to 100 recent zaps
}
```

This finds:
- ✅ Zaps sent directly to your profile
- ✅ Zaps sent to your notes/comments
- ✅ All zaps where you're the recipient

It does NOT require separate queries for:
- Profile zaps vs note zaps (both have `#p` pointing to you)
- Different types of content (the `#p` tag is always the recipient)

## Files Modified

### `content-notification.service.ts`

**Method: `checkForZaps()`**

Changes:
1. Increased limit from 50 to 100
2. Parse `description` tag to extract actual zapper's pubkey
3. Extract zapped event ID from zap request
4. Store zapped event ID in metadata
5. Use actual zapper's pubkey instead of LNURL service pubkey

**Method: `createContentNotification()`**

Changes:
1. Updated metadata type to include `zappedEventId?: string`
2. Changed notification ID generation to use event ID when available
3. This ensures unique IDs for all notifications

## Testing Recommendations

### 1. **Multiple Zaps Test**
- Create a note that receives many zaps (>50)
- Wait for notification check to run
- Verify all zaps appear in notification history
- If not all appear, may need to increase limit further or implement pagination

### 2. **Rapid Zaps Test**
- Have someone send multiple zaps quickly (same second)
- Verify each zap creates a separate notification
- Check that notification IDs are unique

### 3. **Profile vs Note Zaps**
- Receive zaps directly on profile
- Receive zaps on different notes
- Verify all appear in notifications correctly
- Check that the zapped event context is stored when applicable

### 4. **Author Display Test**
- Check that notification shows the actual zapper's profile
- Verify it's NOT showing a Lightning service account
- Test with different Lightning providers (different LNURL services)

### 5. **Historical Zaps Test**
- Check notifications after app restart
- Verify the `since` timestamp mechanism works
- Ensure zaps aren't duplicated on subsequent checks

## Future Improvements

1. **Pagination**: Implement cursor-based pagination to fetch ALL zaps, not just first 100
   ```typescript
   // Could use 'until' parameter to fetch older zaps
   let allZaps = [];
   let until = null;
   while (true) {
     const batch = await getMany({ ..., until, limit: 100 });
     if (batch.length === 0) break;
     allZaps.push(...batch);
     until = batch[batch.length - 1].created_at;
   }
   ```

2. **Better Amount Parsing**: Use a proper bolt11 decoder library instead of regex
   ```typescript
   import { decode } from 'bolt11';
   const decoded = decode(bolt11);
   const amountMsats = decoded.millisatoshis;
   ```

3. **Zap Request Validation**: Validate the zap request signature to prevent fake zaps
   ```typescript
   import { verifyEvent } from 'nostr-tools';
   if (!verifyEvent(zapRequest)) {
     this.logger.warn('Invalid zap request signature');
     continue;
   }
   ```

4. **Rich Notification Context**: Use the `zappedEventId` to show note preview
   ```typescript
   if (metadata.zappedEventId) {
     const zappedEvent = await storage.getEvent(metadata.zappedEventId);
     notification.message = `Zapped: "${zappedEvent.content.substring(0, 50)}..."`;
   }
   ```

5. **Notification Grouping**: Group multiple zaps from same person or on same note
   ```typescript
   // "Alice and 4 others zapped your note"
   // Instead of 5 separate notifications
   ```

6. **Zap Amount in UI**: Display the actual amount more prominently
   ```typescript
   // Current: "Zapped you" with optional amount
   // Better: "⚡ 1,000 sats from Alice" with Bitcoin orange styling
   ```

## Related NIPs

- **NIP-57**: Lightning Zaps (kind 9734 request, kind 9735 receipt)
- **NIP-01**: Basic event structure and signing
- **BOLT-11**: Lightning invoice format

## Performance Considerations

**Query Cost:**
- 1 query per notification check
- Fetches up to 100 events
- Parses JSON in description tag for each event

**Optimization Opportunities:**
- Cache parsed zap requests if checking frequently
- Use relay-side filtering if available
- Consider batch processing for high-volume accounts

**Storage Impact:**
- Each zap notification ~500 bytes
- 100 zaps = ~50 KB
- 1000 zaps = ~500 KB (reasonable for IndexedDB)

## Known Limitations

1. **100 zap limit**: Extremely popular posts with >100 zaps since last check will miss older zaps
2. **No deduplication**: If zap receipt is duplicated across relays, might create duplicate notifications (though unique event IDs should prevent this)
3. **LNURL service pubkey fallback**: If description parsing fails, falls back to LNURL service pubkey (suboptimal but prevents crashes)
4. **Amount parsing**: Regex-based bolt11 parsing is fragile and might miss amounts in non-standard formats

## Migration Notes

**No database migration required** - the fix is in the parsing logic, not the schema. However:

1. **Existing notifications**: Notifications created before this fix will still show incorrect author pubkeys
2. **Clearing recommended**: Users may want to clear old notifications to avoid confusion
3. **Notification IDs**: New ID format means previously seen zaps might reappear (but with correct author)

To clear old notifications:
```typescript
// In notification service or settings page
await this.notificationService.clearNotifications();
```

## Debug Logging

The fix includes comprehensive logging:

```typescript
this.logger.debug(`Found ${events.length} zap events`);
this.logger.warn('Failed to parse zap request description', err);
```

To debug zap notification issues:
1. Open DevTools console
2. Look for messages like "Found X zap events"
3. Check for parsing warnings
4. Verify the `authorPubkey` in the notification object

## Conclusion

This fix addresses the core issue of missing/incorrect zap notifications by:
1. ✅ Extracting the actual zapper's pubkey from the zap request
2. ✅ Increasing query limit to catch more zaps
3. ✅ Using unique event IDs for notification deduplication
4. ✅ Storing zapped event context for future UI enhancements

Users should now see all their zaps correctly in the notification history, with proper attribution to the actual person who zapped them.
