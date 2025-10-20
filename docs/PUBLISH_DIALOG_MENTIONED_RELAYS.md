# Publish Dialog: Mentioned Users' Relays Option

## Overview

Enhanced the Publish Event dialog with a new **"Publish to mentioned"** checkbox option that allows users to explicitly opt-in to publishing events to all relays of all mentioned users (p-tags).

## User Experience

### When Does the Option Appear?

The "Mentioned Users' Relays" option **only appears when the event contains p-tags** (mentioned users). This includes:

- **Replies**: Events with `["p", "pubkey"]` tags for thread participants
- **Reactions**: Kind 7 events with author p-tag
- **Reposts**: Kind 6/16 events with original author p-tag
- **Custom events**: Any event with p-tags

If the event has **no p-tags**, the option is **hidden** from the UI.

### Default Behavior

The checkbox is **unchecked by default**:

- ✅ **User Control**: Users explicitly choose when to discover and publish to mentioned users' relays
- ✅ **Performance**: Avoids automatic relay discovery on dialog open
- ✅ **Transparency**: Shows relay count after discovery

### When Checkbox is Checked

1. **Relay Discovery Starts**:
   - Extracts all unique pubkeys from p-tags
   - Shows loading spinner
   - Fetches ALL relays for each mentioned user (no optimization)
   - Processes in batches of 20 for performance

2. **Relay Count Display**:
   - Shows total relay count
   - Shows number of mentioned users
   - Example: "45 relays from 3 users"

3. **Publishing Behavior**:
   - Publishes to account relays
   - Publishes to mentioned users' relays
   - Deduplicates relay URLs automatically

## Implementation Details

### TypeScript Changes

#### New Signals

```typescript
mentionedRelays = signal<string[]>([]);
loadingMentionedRelays = signal<boolean>(false);
```

#### New Methods

**`hasMentionedUsers(): boolean`**
- Checks if event has any p-tags
- Used to conditionally show the option

**`getMentionedPubkeys(): string[]`**
- Extracts all p-tags from event
- Returns unique pubkey array
- Works in both normal and custom mode

**`loadMentionedUsersRelays(): Promise<void>`**
- Triggered when checkbox is checked
- Sets loading state
- Calls `getAllRelaysForPubkeys()`
- Updates `mentionedRelays` signal

**`getAllRelaysForPubkeys(pubkeys: string[]): Promise<string[]>`**
- Processes pubkeys in batches of 20
- Uses `userRelaysService.getUserRelaysForPublishing()`
- Returns ALL relays (no optimization)
- Deduplicates URLs

#### Updated Methods

**`onOptionChange()`**
```typescript
if (option === 'mentioned' && checked) {
  this.loadMentionedUsersRelays();
}
```

**`getTargetRelays()`**
```typescript
if (selectedOptions.has('mentioned')) {
  allRelays.push(...this.mentionedRelays());
}
```

### HTML Template Changes

#### Conditional Rendering

```html
@for (option of publishOptions; track option.id) {
  @if (option.id !== 'mentioned' || hasMentionedUsers()) {
    <!-- Show option -->
  }
}
```

#### Loading Spinner

```html
@if (option.id === 'mentioned' && loadingMentionedRelays()) {
  <mat-spinner diameter="20"></mat-spinner>
}
```

#### Relay Count Display

```html
@if (option.id === 'mentioned' && !loadingMentionedRelays()) {
  <div class="relay-count">
    {{ mentionedRelays().length }} relay{{ mentionedRelays().length !== 1 ? 's' : '' }}
    from {{ getMentionedPubkeys().length }} user{{ getMentionedPubkeys().length !== 1 ? 's' : '' }}
  </div>
}
```

## User Scenarios

### Scenario 1: Replying in a Thread

1. User writes a reply to a post
2. Opens publish dialog
3. Sees "Mentioned Users' Relays" option (thread has p-tags)
4. Checks the box
5. Sees "Discovering relays..." with spinner
6. After discovery: "28 relays from 2 users"
7. Publishes to: Account relays + 28 mentioned relays
8. **Result**: Both original author and replied-to user receive the event

### Scenario 2: Liking a Post

1. User reacts to a post (kind 7)
2. Opens publish dialog
3. Sees "Mentioned Users' Relays" option (reaction has author p-tag)
4. Checks the box
5. Sees "12 relays from 1 user"
6. Publishes to: Account relays + 12 author relays
7. **Result**: Author sees the like on all their relays

### Scenario 3: Simple Post (No Mentions)

1. User creates a new post (kind 1, no p-tags)
2. Opens publish dialog
3. **Does NOT see** "Mentioned Users' Relays" option
4. Only sees: Account Relays, Additional Relays
5. Publishes to account relays only

### Scenario 4: Custom Event with P-Tags

1. User pastes custom event JSON with p-tags
2. Opens publish dialog
3. Sees "Mentioned Users' Relays" option
4. Checks the box
5. Relay discovery works from custom event's p-tags
6. Publishes to account + mentioned relays

## Performance Considerations

### Batching
- Processes users in batches of 20
- Prevents overwhelming the relay discovery system
- Parallel async operations within batches

### On-Demand Discovery
- **Only runs when checkbox is checked**
- Avoids unnecessary network calls
- User has full control

### Caching
- Uses `UserRelaysService` caching (5-minute TTL)
- Repeated discoveries within 5 minutes use cached data
- Subsequent publishes to same users are fast

### Loading Feedback
- Immediate spinner feedback
- Shows relay count after discovery
- User knows exactly what will happen

## Benefits

1. **User Control**: Explicit opt-in for relay discovery
2. **Transparency**: Shows relay count before publishing
3. **Performance**: On-demand discovery only
4. **Flexibility**: Works with any event type with p-tags
5. **Discoverability**: Users learn about relay distribution
6. **Thread Continuity**: Ensures thread participants receive events

## Comparison with Automatic Publishing

### Previous Approach (PublishService)
- ✅ Automatic: No user interaction required
- ✅ Always comprehensive: All p-tags included
- ❌ Hidden: User doesn't see relay distribution
- ❌ No control: Always publishes to mentioned relays

### New Dialog Option
- ✅ Transparent: User sees relay count
- ✅ Controlled: User chooses when to enable
- ✅ Educational: Shows how many relays/users
- ✅ Flexible: Can disable for specific events
- ❌ Manual: Requires checkbox interaction

## Best Practices

### When to Check the Box

**✅ Recommended**:
- Replying to someone in a thread
- Reacting to/liking someone's content
- Reposting someone's content
- Mentioning specific users

**⚠️ Optional**:
- Broadcasting announcements
- Publishing to specific relays only
- Testing/debugging events

### UI Guidance

The dialog description helps users understand:
> "Publish to all mentioned users' relays (p-tags)"

Consider adding tooltip:
> "Ensures all thread participants and mentioned users receive your event on their relays"

## Future Enhancements

Potential improvements:

1. **Auto-check for Replies**: Automatically check box for kind 1 events with e-tags
2. **Relay Preview**: Expand to show individual relay URLs before publishing
3. **User Selection**: Allow unchecking specific mentioned users
4. **Relay Deduplication Info**: Show how many relays overlap with account relays
5. **Remember Preference**: Store user's last choice in localStorage
6. **Batch Progress**: Show progress during relay discovery (X/Y users loaded)
7. **Relay Health**: Indicate which relays are online/offline

## Related Documentation

- [Publishing to Thread Participants' Relays](./PUBLISHING_TO_THREAD_PARTICIPANTS_RELAYS.md) - Backend implementation
- [UserRelaysService](../src/app/services/relays/user-relays.ts) - Relay discovery service
- [PublishService](../src/app/services/publish.service.ts) - Automatic mention handling

## Summary

This feature gives users **full transparency and control** over publishing to mentioned users' relays. By showing relay counts and requiring explicit opt-in, users understand exactly where their events will be published while maintaining the performance benefits of on-demand relay discovery.
