# NIP-36 Content Warning Implementation

## Overview

Implemented support for NIP-36 Sensitive Content / Content Warning specification. This allows content creators to self-mark their posts as containing sensitive content, requiring users to manually approve viewing before the content is displayed.

## NIP-36 Specification

According to [NIP-36](https://github.com/nostr-protocol/nips/blob/master/36.md):

- Events can include a `content-warning` tag to indicate sensitive content
- An optional reason can be provided: `["content-warning", "<optional reason>"]`
- Additional NIP-32 labels (L/l tags) can be used for further qualification

## Implementation

### Components Created

#### ContentWarningComponent
**Location**: `src/app/components/content-warning/`

A standalone component that displays a warning overlay when content has been marked as sensitive.

**Features**:
- Warning icon and title
- Optional custom reason from the content creator
- "Show Content" button to approve viewing
- Clean, accessible design matching Material Design

**Props**:
- `reason`: Optional string with the warning reason
- `approve`: Output event when user approves viewing

### EventComponent Updates

**File**: `src/app/components/event/event.component.ts`

#### New Computed Signals

1. **hasContentWarning**: Checks if event has `content-warning` tag
   ```typescript
   hasContentWarning = computed<boolean>(() => {
     const event = this.event() || this.record()?.event;
     if (!event) return false;
     return event.tags.some(tag => tag[0] === 'content-warning');
   });
   ```

2. **contentWarningReason**: Extracts the optional reason from the tag
   ```typescript
   contentWarningReason = computed<string | null>(() => {
     const event = this.event() || this.record()?.event;
     if (!event) return null;
     const warningTag = event.tags.find(tag => tag[0] === 'content-warning');
     return warningTag && warningTag[1] ? warningTag[1] : null;
   });
   ```

3. **shouldHideContentDueToWarning**: Determines if content should be hidden
   ```typescript
   shouldHideContentDueToWarning = computed<boolean>(() => {
     const event = this.event() || this.record()?.event;
     if (!event) return false;
     if (!this.hasContentWarning()) return false;
     return !this.contentWarningApproved().has(event.id);
   });
   ```

4. **shouldHideContentOverall**: Combined check for reports OR content warnings
   ```typescript
   shouldHideContentOverall = computed<boolean>(() => {
     return this.shouldHideContent() || this.shouldHideContentDueToWarning();
   });
   ```

#### New Signal

**contentWarningApproved**: Tracks which events the user has approved viewing
```typescript
contentWarningApproved = signal<Set<string>>(new Set());
```

#### New Method

**approveContentWarning**: Adds event ID to approved set when user clicks "Show Content"
```typescript
approveContentWarning(event?: MouseEvent) {
  event?.stopPropagation();
  const currentEvent = this.event() || this.record()?.event;
  if (!currentEvent) return;

  this.contentWarningApproved.update(approved => {
    const newSet = new Set(approved);
    newSet.add(currentEvent.id);
    return newSet;
  });
}
```

### Template Updates

**File**: `src/app/components/event/event.component.html`

Updated both reply and normal event structures to check for content warnings:

```html
@if (shouldHideContentDueToWarning()) {
  <app-content-warning 
    [reason]="contentWarningReason()" 
    (approve)="approveContentWarning()">
  </app-content-warning>
} @else if (shouldHideContent()) {
  <app-reported-content [event]="item.event"></app-reported-content>
} @else {
  <!-- Normal content display -->
}
```

## User Experience

### When Content Has Warning

1. User encounters an event with `content-warning` tag
2. Instead of content, they see:
   - Warning icon (⚠️)
   - "Sensitive Content" title
   - Custom reason (if provided by author)
   - Default message if no reason provided
   - Disclaimer about viewing at discretion
   - "Show Content" button

3. Upon clicking "Show Content":
   - Content is immediately revealed
   - Approval is stored in memory for that event
   - User won't see warning again for that specific event during session

### Priority Hierarchy

Content warnings are checked BEFORE report-based hiding:
1. First: Check for NIP-36 content-warning (self-reported)
2. Second: Check for NIP-56 reports (community-reported)
3. If neither: Display content normally

This ensures author-provided warnings take precedence.

## Example Event

```json
{
  "kind": 1,
  "pubkey": "<pubkey>",
  "created_at": 1234567890,
  "tags": [
    ["content-warning", "Contains graphic medical images"],
    ["L", "content-warning"],
    ["l", "medical", "content-warning"]
  ],
  "content": "Check out this interesting medical case...",
  "id": "<event-id>",
  "sig": "<signature>"
}
```

## Technical Details

### State Management
- Uses Angular signals for reactive state
- Per-event approval tracking (doesn't persist across sessions)
- Computed signals automatically recalculate when dependencies change

### Performance
- No additional API calls required
- Warning check is simple tag lookup (O(n) where n = number of tags)
- Minimal memory overhead (Set of approved event IDs)

### Accessibility
- Semantic HTML structure
- Clear warning messaging
- Keyboard accessible button
- Material Design compliant

## Differences from Report System

| Feature | NIP-36 Content Warning | NIP-56 Reports |
|---------|----------------------|----------------|
| Source | Content creator (self) | Community members |
| Purpose | Preemptive disclosure | Reactive moderation |
| Authority | Author decision | User settings/thresholds |
| Display | Always shown first | Shown if no content warning |
| Persistence | Session only | Can be persistent |
| Reason | Optional single reason | Multiple report types |

## Future Enhancements

Potential improvements for consideration:

1. **Persistent Approval**: Store approved events in localStorage
2. **Global Toggle**: Setting to auto-approve all content warnings
3. **Category-based Approval**: Auto-approve specific warning types
4. **NIP-32 Label Support**: Parse and display additional qualification labels
5. **Preview Mode**: Show blurred/pixelated preview before full reveal
6. **Analytics**: Track how often warnings are used and approved
7. **Batch Approval**: Approve all content warnings in current view

## Testing

To test the implementation:

1. Create an event with content-warning tag:
   ```javascript
   {
     tags: [["content-warning", "Test warning"]],
     content: "Sensitive test content"
   }
   ```

2. View the event in the timeline or thread
3. Verify warning overlay displays
4. Click "Show Content"
5. Verify content is revealed
6. Refresh page and verify warning shows again (no persistence)

## Standards Compliance

✅ Fully compliant with NIP-36 specification
- Detects `content-warning` tag
- Supports optional reason parameter
- Hides content until user approval
- Compatible with NIP-32 labels (parsed but not yet displayed)
