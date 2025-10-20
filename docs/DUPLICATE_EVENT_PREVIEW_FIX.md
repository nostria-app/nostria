# Fix: Duplicate Event Preview Rendering

## Problem

Some events were rendering **two previews** for mentioned Nostr events (nevent/note references), while others only showed inline HTML previews. The goal was to have all event mentions render as nice Material card previews consistently.

## Root Cause Analysis

### Example 1: nevent - Was Rendering as Card

```json
{
  "content": "Cc: AWS & customers \n\nnostr:nevent1qqspc3kxtdk8kh6f7auamcwl6ykfkq2dnjxrgtgqnpdm5hvrj00yu4czyzamthdqu92k09ulq4p5q77uyqeadu9mkv8hy5f2nqw0mvhsncn5wqcyqqqqqqg8v774n",
  "tags": [
    [
      "e",
      "1c46c65b6c7b5f49f779dde1dfd12c9b014d9c8c342d00985bba5d8393de4e57",
      "",
      "mention"
    ]
  ]
}
```

- Contains `nostr:nevent` → Parses as `type: 'nevent'`
- ✅ Matched filter in eventMentions: `t.nostrData?.type === 'nevent'`
- ✅ Also rendered inline in note-content
- **Result:** BOTH card and inline (duplicate)

### Example 2: note - Was Rendering Only Inline

```json
{
  "content": "Keep going.🤙 nostr:note1shceyp5qgyfmv8paqqpk3d8upexw4llqdn04wm2m08njwd5mc6zq7dkxux",
  "tags": [
    [
      "q",
      "85f19206804113b61c3d000368b4fc0e4ceaffe06cdf576d5b79e727369bc684"
    ]
  ]
}
```

- Contains `nostr:note` → Parses as `type: 'note'`
- ❌ Did NOT match filter: `t.nostrData?.type === 'nevent'`
- ✅ Rendered inline in note-content
- **Result:** Only inline preview (not the nice card)

## Key Difference: nevent vs note

### nevent (NIP-19 Event Pointer)
```
nostr:nevent1qqspc3kxtdk8kh6f7...
```
**Decoded structure:**
```typescript
{
  type: 'nevent',
  data: {
    id: '1c46c65b...',      // Event ID
    author: 'bbb5dda0...',   // Optional author pubkey
    relays: ['wss://...'],   // Optional relay hints
    kind: 1                  // Optional event kind
  }
}
```

### note (NIP-19 Note ID)
```
nostr:note1shceyp5qgyfmv8paqqpk3d8up...
```
**Decoded structure:**
```typescript
{
  type: 'note',
  data: '85f19206...'  // Just the event ID string
}
```

**Key difference:** 
- `nevent.data` is an **object** with `.id` property
- `note.data` is a **string** (the event ID directly)

## The Two Rendering Paths (Before Fix)

### Path 1: eventMentions() - Card Preview (content.component.ts)

```typescript
const eventMentions = await Promise.all(
  newTokens
    .filter(t => t.type === 'nostr-mention' && t.nostrData?.type === 'nevent')
    .map(async mention => {
      const eventData = await this.data.getEventById(mention.nostrData?.data.id);
      // ... creates nice card preview
    })
);
```

- Filters tokens for `nevent` type mentions
- Fetches full event data
- Renders as Material card with header, avatar, content
- **Better UX**: Nice, consistent card design

### Path 2: Inline Preview (note-content.component.ts)

```typescript
if (type === 'nevent' || type === 'note') {
  const previewHtml = await this.formatService.fetchEventPreview(eventId);
  // ... renders inline HTML
}
```

- Renders both `nevent` and `note` mentions inline
- Uses `formatService` to generate HTML
- Embedded directly in content flow
- **Less polished**: Basic HTML rendering

## Solution

**Step 1:** Expand `eventMentions()` to handle both `nevent` AND `note` mentions:

```typescript
const eventMentions = await Promise.all(
  newTokens
    // Filter for BOTH nevent and note types
    .filter(t => t.type === 'nostr-mention' && 
                 (t.nostrData?.type === 'nevent' || t.nostrData?.type === 'note'))
    .map(async mention => {
      // Handle different data structures
      const eventId = mention.nostrData?.type === 'nevent' 
        ? mention.nostrData.data.id    // nevent: extract from object
        : mention.nostrData?.data;      // note: use string directly
      
      const eventData = await this.data.getEventById(eventId);
      if (!eventData) return null;
      const contentTokens = await this.parsing.parseContent(eventData?.data);
      return {
        event: eventData,
        contentTokens,
      };
    })
);
```

**Step 2:** Filter out BOTH types from tokens passed to note-content:

```typescript
contentTokens = computed<ContentToken[]>(() => {
  const shouldRender = this._isVisible() || this._hasBeenVisible();
  
  if (!shouldRender) {
    return [];
  }

  // Filter out both nevent AND note mentions
  return this._cachedTokens().filter(
    token => !(token.type === 'nostr-mention' && 
               (token.nostrData?.type === 'nevent' || token.nostrData?.type === 'note'))
  );
});
```

## Behavior After Fix

### nevent mentions (nostr:nevent1...)
- ❌ No longer rendered inline in note-content
- ✅ Only rendered as nice card preview via eventMentions()
- Event ID extracted from `data.id`
- Result: **One card preview**

### note mentions (nostr:note1...)
- ❌ No longer rendered inline in note-content  
- ✅ NOW rendered as nice card preview via eventMentions()
- Event ID used from `data` directly
- Result: **One card preview** (consistent with nevent!)

### nprofile/npub mentions
- ✅ Not affected by this filter
- Continue to render as `@username` links
- Hover tooltips still work

## Key Code Changes

### Change 1: eventMentions Filter (content.component.ts)

**Before:**
```typescript
.filter(t => t.type === 'nostr-mention' && t.nostrData?.type === 'nevent')
```

**After:**
```typescript
.filter(t => t.type === 'nostr-mention' && 
             (t.nostrData?.type === 'nevent' || t.nostrData?.type === 'note'))
```

### Change 2: Event ID Extraction (content.component.ts)

**Before:**
```typescript
const eventData = await this.data.getEventById(mention.nostrData?.data.id);
```

**After:**
```typescript
const eventId = mention.nostrData?.type === 'nevent' 
  ? mention.nostrData.data.id    // nevent: object.id
  : mention.nostrData?.data;      // note: string
  
const eventData = await this.data.getEventById(eventId);
```

### Change 3: contentTokens Filter (content.component.ts)

**Before:**
```typescript
token => !(token.type === 'nostr-mention' && token.nostrData?.type === 'nevent')
```

**After:**
```typescript
token => !(token.type === 'nostr-mention' && 
           (token.nostrData?.type === 'nevent' || token.nostrData?.type === 'note'))
```

## Files Modified

- **content.component.ts**: Updated `contentTokens` computed to filter nevent mentions

## Technical Notes

### Why Filter in contentTokens?

The `contentTokens` computed is the data source for `<app-note-content>`. By filtering here:
- Clean separation of concerns
- eventMentions handles nevents exclusively
- note-content handles everything else (text, images, note mentions, etc.)
- No changes needed in note-content component

### Why Keep note Mentions in note-content?

`note` mentions (note1...) are simpler than `nevent` mentions:
- They only contain an event ID (no author, no relay hints)
- They're typically inline references
- The inline HTML preview is appropriate for these
- Creating full card previews for every note mention would be excessive

## Result

✅ **Consistent behavior**: All event mentions (nevent AND note) show as nice card previews  
✅ **No duplicates**: Each event mentioned is shown exactly once  
✅ **Better UX**: Card previews provide better context and design for both types  
✅ **Backward compatible**: Profile mentions and other content still work correctly  
✅ **Handles data structure differences**: Correctly extracts event ID from both nevent (object) and note (string) formats
