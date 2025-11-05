# Article Comments Implementation

## Overview

This document describes the implementation of NIP-22 comment support for long-form articles (kind 30023) in Nostria. Articles are addressable events that use the `A` tag instead of the regular `E` tag for comments.

## Implementation Details

### Key Changes

#### 1. Article Component Updates (`src/app/pages/article/`)

**article.component.ts**
- Added `CommentsListComponent` import and added it to the component imports array
- The component now includes the comments list in its template

**article.component.html**
- Removed the standalone "Comment" button from the footer actions
- Added `<app-comments-list>` component after the footer section
- The comments section is displayed below the article content with proper spacing

**article.component.scss**
- Added `.article-comments` section with top margin and border
- Responsive styling for mobile devices

#### 2. Comments List Component Updates (`src/app/components/comments-list/`)

**comments-list.component.ts**
Enhanced to support both regular events and addressable events (articles):

- **`loadComments()` method**: Now detects if the event is addressable (kind >= 30000 and < 40000)
  - For addressable events: Queries comments using `#A` tag with format `kind:pubkey:d-tag`
  - For regular events: Queries comments using `#e` tag with event ID
  
- **`loadMoreComments()` method**: Same addressable event detection logic applied for pagination

#### 3. Comment Editor Dialog Updates (`src/app/components/comment-editor-dialog/`)

**comment-editor-dialog.component.ts**
Enhanced the `buildCommentEvent()` method to support addressable events:

- Detects if root event is addressable (kind >= 30000 and < 40000)
- For addressable events:
  - Uses `A` tag (uppercase) for root scope: `['A', 'kind:pubkey:d-tag', '', pubkey]`
  - Uses `a` tag (lowercase) for parent scope when creating top-level comments
- For regular events:
  - Uses `E` tag (uppercase) for root scope
  - Uses `e` tag (lowercase) for parent scope
- Properly handles both top-level comments and replies to comments

## NIP-22 Tag Structure for Articles

### Top-level Comment on an Article (kind 30023)
```json
{
  "kind": 1111,
  "content": "Great article!",
  "tags": [
    ["A", "30023:<author-pubkey>:<article-d-tag>", "<relay-hint>", "<author-pubkey>"],
    ["K", "30023"],
    ["P", "<author-pubkey>"],
    ["a", "30023:<author-pubkey>:<article-d-tag>", "<relay-hint>", "<author-pubkey>"],
    ["k", "30023"],
    ["p", "<author-pubkey>"]
  ]
}
```

### Reply to a Comment on an Article
```json
{
  "kind": 1111,
  "content": "Thanks for reading!",
  "tags": [
    ["A", "30023:<author-pubkey>:<article-d-tag>", "<relay-hint>", "<author-pubkey>"],
    ["K", "30023"],
    ["P", "<author-pubkey>"],
    ["e", "<parent-comment-id>", "<relay-hint>", "<parent-comment-pubkey>"],
    ["k", "1111"],
    ["p", "<parent-comment-pubkey>"]
  ]
}
```

## Addressable Events

Addressable events are identified by:
- **Kind range**: 30000 - 39999 (parameterized replaceable events)
- **Unique identifier**: Combination of `kind`, `pubkey`, and `d` tag value
- **A tag format**: `kind:pubkey:identifier`

Examples:
- Kind 30023: Long-form articles
- Kind 30024: Article drafts
- Kind 31922: Date-based calendar events
- Kind 31923: Time-based calendar events
- Kind 32100: Music playlists

## User Flow

1. User opens an article page (`/a/naddr1...`)
2. Article content is displayed with metadata and author information
3. Comments section appears below the article footer
4. User can:
   - Click "View Comments" to expand the comments section
   - Click "Add comment" button to create a new comment
   - Reply to existing comments
   - Load more comments via infinite scroll

5. When creating a comment:
   - Comment editor dialog opens
   - User writes plaintext comment
   - System constructs kind 1111 event with proper `A` tags for articles
   - Comment is signed and published to relays
   - Comments list refreshes to show the new comment

## Query Filters

### For Articles (Addressable Events)
```typescript
{
  kinds: [1111],
  '#A': ['30023:pubkey:d-tag'],
  limit: 30
}
```

### For Regular Events
```typescript
{
  kinds: [1111],
  '#e': ['event-id'],
  limit: 30
}
```

## Benefits

1. **Proper NIP-22 Compliance**: Uses correct tag structure for addressable events
2. **Unified Comments System**: Same UI components work for both regular and addressable events
3. **Efficient Querying**: Queries by the appropriate tag type (A vs E)
4. **Thread Continuity**: Comments remain linked to the article even if it's updated (replaceable event)
5. **Scalability**: Infinite scroll and pagination support

## Testing

To test the implementation:

1. Open any article page
2. Verify the comments section appears below the article
3. Click "View Comments" to expand
4. Click "Add comment" to create a comment
5. Verify the comment is published with correct `A` tags
6. Verify the comment appears in the list after publishing
7. Test replying to a comment
8. Test loading more comments (if available)

## Related Files

- `src/app/pages/article/article.component.ts`
- `src/app/pages/article/article.component.html`
- `src/app/pages/article/article.component.scss`
- `src/app/components/comments-list/comments-list.component.ts`
- `src/app/components/comment-editor-dialog/comment-editor-dialog.component.ts`
- `docs/NIP22_COMMENTS_IMPLEMENTATION.md`

## References

- [NIP-22: Comment](https://github.com/nostr-protocol/nips/blob/master/22.md)
- [NIP-01: Basic protocol flow description](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-23: Long-form Content](https://github.com/nostr-protocol/nips/blob/master/23.md)
