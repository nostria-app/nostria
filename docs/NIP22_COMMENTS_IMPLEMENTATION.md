# NIP-22 Comment System Implementation

## Overview

This document describes the implementation of NIP-22 (Comment) support in Nostria. NIP-22 defines a standardized way to add threaded comments to any type of Nostr event, excluding kind 1 (short text notes) which use NIP-10 for threading.

## Specification

NIP-22 defines comments as kind 1111 events with specific tag structure:

- **Root scope tags (uppercase)**: Define what the comment thread is about
  - `A` - Addressable event reference (kind:pubkey:d-tag)
  - `E` - Event ID reference
  - `I` - External identity reference (URLs, hashtags, etc.)
  - `K` - Kind of root event
  - `P` - Pubkey of root event author

- **Parent scope tags (lowercase)**: Define the immediate parent being replied to
  - `a` - Parent addressable event
  - `e` - Parent event ID
  - `i` - Parent external identity
  - `k` - Kind of parent event/comment
  - `p` - Pubkey of parent author

## Implementation

### Components Created

#### 1. CommentComponent (`src/app/components/comment/`)
Displays a single NIP-22 comment with:
- Event header (author, timestamp)
- Comment content (plaintext only, no formatting per NIP-22)
- Actions (reply, menu)
- Parsing of NIP-22 tag structure (A/a, E/e, I/i, K/k, P/p tags)

**Key Features:**
- Parses and stores comment tag structure
- Distinguishes between top-level comments and replies
- Supports nested display via `nested` input

#### 2. CommentsListComponent (`src/app/components/comments-list/`)
Manages the comments section for an event:
- Displays comment count
- Toggleable expand/collapse
- Fetches comments for a given event
- Add comment button
- Loading and empty states

**Key Features:**
- Queries for kind 1111 events that reference the parent event
- Filters by E/e tags matching the event ID
- Sorts comments chronologically (oldest first)
- Integrates with EventService for comment creation

### Integration Points

#### Event Types Updated
The following event type components now display NIP-22 comments:

1. **PhotoEventComponent** (kind 20)
   - `src/app/components/event-types/photo-event.component.*`

2. **VideoEventComponent** (kinds 21, 22)
   - `src/app/components/event-types/video-event.component.*`

3. **PlaylistEventComponent** (kind 32100)
   - `src/app/components/event-types/playlist-event.component.*`

Each component includes `<app-comments-list [event]="event()">` at the end of their template.

#### Reply Button Enhancement
The ReplyButtonComponent (`src/app/components/event/reply-button/`) was updated to:
- Use NIP-10 replies for kind 1 (short text notes)
- Use NIP-22 comments for all other event kinds
- Determine behavior based on `event().kind === kinds.ShortTextNote`

### Service Updates

#### EventService (`src/app/services/event.ts`)
Added `createComment()` method:
```typescript
createComment(rootEvent: Event): void
```

This method is called when creating a comment on non-kind-1 events. Currently logs to console - needs full implementation with a specialized comment editor dialog that:
- Constructs proper NIP-22 tag structure
- Handles both root and parent references
- Sets K/k tags with event kinds
- Sets P/p tags with author pubkeys
- Validates plaintext content (no HTML/Markdown)

### Data Flow

1. User views event (photo, video, playlist, etc.)
2. CommentsListComponent displays comment count
3. User expands comments section
4. Component queries DataService for kind 1111 events with matching E/e tags
5. Comments are displayed chronologically
6. User can add comment via button
7. EventService.createComment() is called
8. Comment dialog opens (to be implemented)
9. User writes plaintext comment
10. System constructs kind 1111 event with proper tags:
    - `E` tag with event ID
    - `K` tag with root event kind
    - `P` tag with root author pubkey
    - `e` tag same as E (for top-level)
    - `k` tag same as K (for top-level)
    - `p` tag same as P (for top-level)
11. Event is signed and published
12. CommentsListComponent refreshes to show new comment

## Tag Structure Examples

### Top-level comment on a photo (kind 20):
```json
{
  "kind": 1111,
  "content": "Beautiful photo!",
  "tags": [
    ["E", "<photo-event-id>", "<relay-hint>", "<photo-author-pubkey>"],
    ["K", "20"],
    ["P", "<photo-author-pubkey>"],
    ["e", "<photo-event-id>", "<relay-hint>", "<photo-author-pubkey>"],
    ["k", "20"],
    ["p", "<photo-author-pubkey>"]
  ]
}
```

### Reply to a comment:
```json
{
  "kind": 1111,
  "content": "Thanks! This was taken at sunrise.",
  "tags": [
    ["E", "<photo-event-id>", "<relay-hint>", "<photo-author-pubkey>"],
    ["K", "20"],
    ["P", "<photo-author-pubkey>"],
    ["e", "<parent-comment-id>", "<relay-hint>", "<parent-comment-author>"],
    ["k", "1111"],
    ["p", "<parent-comment-author>"]
  ]
}
```

## Remaining Work

### High Priority
1. **Comment Editor Dialog**: Create a specialized dialog for composing NIP-22 comments
   - Plaintext-only input (enforce NIP-22 spec)
   - Proper tag construction (A/E/I, K, P and lowercase variants)
   - Handle both top-level and reply comments
   - Support for addressable events (A/a tags)

2. **Reply to Comments**: Enable replying to individual comments
   - Update CommentComponent reply button
   - Pass parent comment context to createComment()
   - Construct proper parent tags (e, k, p)

3. **Comment Threading**: Display nested comment structure
   - Build comment tree from flat list
   - Visual indentation for nested comments
   - "Show more replies" for deep threads

### Medium Priority
4. **External Identity Support**: Implement I/i tag support
   - Comments on URLs, hashtags, geohashes
   - External content preview

5. **Performance Optimization**:
   - Cache comment queries
   - Pagination for large comment threads
   - Virtual scrolling for long lists

6. **Real-time Updates**:
   - Subscribe to new comments via WebSocket
   - Auto-refresh on new comment published

### Low Priority
7. **Comment Reactions**: Support reactions to comments
8. **Comment Reporting**: Integrate with reporting system
9. **Comment Search**: Search within comment threads

## Testing Considerations

- Test with different event kinds (20, 21, 22, 32100, etc.)
- Test top-level comments vs. nested replies
- Test with addressable vs. regular events
- Test comment creation and display
- Test with no comments (empty state)
- Test with many comments (performance)
- Verify NIP-22 tag structure is correct
- Test relay hint propagation
- Test with multiple accounts

## Related NIPs

- **NIP-10**: Event threading for kind 1 notes
- **NIP-22**: Comments (this implementation)
- **NIP-73**: External identity references (I/i tags)
- **NIP-21**: nostr: URI scheme (for mentions in comments)

## Files Modified/Created

### Created:
- `src/app/components/comment/comment.component.ts`
- `src/app/components/comment/comment.component.html`
- `src/app/components/comment/comment.component.scss`
- `src/app/components/comments-list/comments-list.component.ts`
- `src/app/components/comments-list/comments-list.component.html`
- `src/app/components/comments-list/comments-list.component.scss`

### Modified:
- `src/app/components/event-types/photo-event.component.ts`
- `src/app/components/event-types/photo-event.component.html`
- `src/app/components/event-types/video-event.component.ts`
- `src/app/components/event-types/video-event.component.html`
- `src/app/components/event-types/playlist-event.component.ts`
- `src/app/components/event-types/playlist-event.component.html`
- `src/app/components/event/reply-button/reply-button.component.ts`
- `src/app/services/event.ts`

## References

- [NIP-22 Specification](https://github.com/nostr-protocol/nips/blob/master/22.md)
