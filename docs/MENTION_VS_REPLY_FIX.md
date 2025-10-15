# Mention vs Reply Event Handling Fix

## Problem

Events with `e` tags marked as "mention" were incorrectly being displayed as replies. According to NIP-10, the marker (4th element of an `e` tag) can be:
- `root` - references the root of the thread
- `reply` - references the event being replied to
- `mention` - references an event being mentioned (not a reply)

Previously, any event with `e` tags was treated as a reply, which caused original posts that simply mentioned other events to be displayed with "replied to" headers.

## Example Event

The following event mentions another event but is NOT a reply:

```json
{
  "content": "A little birdie told me this might be one of the best conferences...",
  "kind": 1,
  "tags": [
    [
      "e",
      "2ce4e29e66ad4de8c2b677fbe16ba72fd8de2c31b95bae57435592d23e85c878",
      "wss://nos.lol",
      "mention"
    ],
    [
      "p",
      "1944e6c8fd88a9cc948310de5aee0886f49c3c5b69f96bdb79401dd41d77853a",
      "",
      "mention"
    ]
  ]
}
```

## Solution

### 1. Enhanced `getEventTags` Method

Updated the `getEventTags` method in `EventService` to:
- Separate `e` tags with "mention" markers from actual thread tags
- Only consider tags with "root" or "reply" markers, or unmarked tags as actual thread references
- Return separate arrays for mentions vs thread references

The logic now:
1. Filters all `e` tags into two groups:
   - `mentionTags`: Tags where marker (4th element) is "mention"
   - `threadTags`: All other `e` tags (marked as "root"/"reply" or unmarked)
2. Only processes `threadTags` when determining `rootId` and `replyId`
3. Collects all mention IDs separately in the `mentionIds` array

### 2. Enhanced `EventTags` Interface

Added `mentionIds` array to track event mentions separately from thread structure:
```typescript
export interface EventTags {
  author: string | null;
  rootId: string | null;
  replyId: string | null;
  pTags: string[];
  rootRelays: string[];
  replyRelays: string[];
  mentionIds: string[];  // NEW: IDs of mentioned events
}
```

### 3. Updated `isReply` Logic

Changed the `isReply` computed property in `EventComponent` to:
- Use `eventService.getEventTags()` to properly parse tags
- Check if the event has a `replyId` or `rootId` (actual thread references)
- Return `false` for events that only have mention tags

**Before:**
```typescript
isReply = computed<boolean>(() => {
  const event = this.event() || this.record()?.event;
  if (!event) return false;

  const eTags = event.tags.filter(tag => tag[0] === 'e');
  return eTags.length > 0; // Any e-tag = reply (WRONG!)
});
```

**After:**
```typescript
isReply = computed<boolean>(() => {
  const event = this.event() || this.record()?.event;
  if (!event) return false;

  const eventTags = this.eventService.getEventTags(event);
  
  // Only true if has rootId or replyId (actual thread participation)
  return !!(eventTags.rootId || eventTags.replyId);
});
```

## Test Cases

### Case 1: Event with only mention tags (Original Post)
```json
{
  "tags": [
    ["e", "abc123", "wss://relay.example.com", "mention"]
  ]
}
```
- `rootId`: `null`
- `replyId`: `null`
- `mentionIds`: `["abc123"]`
- `isReply()`: `false` ✅
- **Result**: Displays as original post, no "replied to" header

### Case 2: Event with reply tag (Actual Reply)
```json
{
  "tags": [
    ["e", "xyz789", "wss://relay.example.com", "reply"]
  ]
}
```
- `rootId`: `xyz789`
- `replyId`: `xyz789`
- `mentionIds`: `[]`
- `isReply()`: `true` ✅
- **Result**: Displays as reply with thread context

### Case 3: Event with root, reply, and mention tags
```json
{
  "tags": [
    ["e", "root123", "wss://relay.example.com", "root"],
    ["e", "parent456", "wss://relay.example.com", "reply"],
    ["e", "mention789", "wss://relay.example.com", "mention"]
  ]
}
```
- `rootId`: `root123`
- `replyId`: `parent456`
- `mentionIds`: `["mention789"]`
- `isReply()`: `true` ✅
- **Result**: Displays as threaded reply with full context

### Case 4: Event with unmarked e-tag (Positional Format)
```json
{
  "tags": [
    ["e", "abc123", "wss://relay.example.com"]
  ]
}
```
- `rootId`: `abc123`
- `replyId`: `abc123`
- `mentionIds`: `[]`
- `isReply()`: `true` ✅
- **Result**: Treated as reply using positional format (backward compatibility)

## NIP-10 Reference

According to [NIP-10](https://github.com/nostr-protocol/nips/blob/master/10.md), the marker (4th element) distinguishes:
- **Thread participation**: `root`, `reply`, or unmarked positional tags
- **Event mentions**: `mention` marker - references an event but is not part of the reply chain

This fix ensures we correctly distinguish between:
- **Reply**: Event is part of a thread conversation
- **Mention**: Event references another event but is not a reply

## Files Changed

1. `src/app/services/event.ts`
   - Enhanced `EventTags` interface with `mentionIds` field
   - Updated `getEventTags()` to separate mentions from thread tags
   - Removed unused import

2. `src/app/components/event/event.component.ts`
   - Updated `isReply` computed property to check for rootId/replyId instead of any e-tags

## Impact

- Events that only mention other events will now display correctly as original posts
- The "replied to" header will only appear for actual replies
- Thread context will only be shown for genuine thread participants
- Mentioned events can still be rendered as previews in the content component
- Backward compatibility maintained for unmarked positional e-tags

## Testing

Events with only "mention" markers should now:
- Display as standalone posts (no "replied to" header)
- Not show thread context in timeline view
- Still render the mentioned event as an embedded preview in the content (if supported)

Events with "root" or "reply" markers (or unmarked) should continue to work as before.
