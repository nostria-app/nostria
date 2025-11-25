# Article Reactions and Reposts Support

## Overview
This implementation adds support for reactions (likes) and reposts of articles in accordance with Nostr NIP-18 and NIP-25 specifications.

## Changes Made

### 1. Reaction Button Component
Created a new standalone `ReactionButtonComponent` at `src/app/components/event/reaction-button/` that:
- Provides a reusable like/unlike button for any event type
- Supports both 'icon' and 'full' view modes
- Implements optimistic UI updates for instant feedback
- Loads reactions independently or accepts them from parent components to avoid duplicate queries
- Follows the same pattern as the existing `RepostButtonComponent`

### 2. Article Display Integration
Updated `ArticleDisplayComponent` to include the reaction button:
- Added import for `ReactionButtonComponent`
- Added the reaction button to the article actions toolbar
- Positioned it alongside the existing repost button for consistency

### 3. Reaction Service Enhancement
Enhanced `ReactionService` to comply with NIP-25:
- Added support for 'a' tag (coordinates) for addressable events
- Detects parameterized replaceable events (kinds 30000-39999) including articles (kind 30023)
- Constructs 'a' tag in the format: `kind:pubkey:d-tag`
- Maintains existing 'e', 'p', and 'k' tags for all reactions

## NIP Compliance

### NIP-25: Reactions
The implementation follows NIP-25 specification for reactions:
- ✅ Uses kind 7 for reactions
- ✅ Content set to '+' for likes
- ✅ Includes 'e' tag with the event ID
- ✅ Includes 'p' tag with the event author's pubkey
- ✅ Includes 'k' tag with the stringified kind number
- ✅ Includes 'a' tag for addressable events (articles)

Example reaction event for an article:
```json
{
  "kind": 7,
  "content": "+",
  "tags": [
    ["e", "<article-event-id>"],
    ["p", "<article-author-pubkey>"],
    ["k", "30023"],
    ["a", "30023:<article-author-pubkey>:<d-tag>"]
  ]
}
```

### NIP-18: Reposts
The existing repost functionality already complies with NIP-18:
- ✅ Uses kind 6 for kind 1 (ShortTextNote) reposts
- ✅ Uses kind 16 (GenericRepost) for all other event kinds including articles
- ✅ Includes 'k' tag for generic reposts indicating the reposted event kind
- ✅ Includes 'e' and 'p' tags

Example generic repost for an article:
```json
{
  "kind": 16,
  "content": "{...stringified article event...}",
  "tags": [
    ["e", "<article-event-id>"],
    ["p", "<article-author-pubkey>"],
    ["k", "30023"]
  ]
}
```

## Technical Details

### Addressable Events Detection
Articles (kind 30023) are parameterized replaceable events. The implementation uses:
```typescript
this.utilities.isParameterizedReplaceableEvent(event.kind)
```
This checks if the kind is in the range 30000-39999 as per NIP-01.

### 'a' Tag Construction
For addressable events, the 'a' tag is constructed using:
- Event kind
- Event author's pubkey
- 'd' tag value from the event

Format: `kind:pubkey:d-tag`

### Optimistic UI Updates
The reaction button implements optimistic updates for better UX:
1. Immediately updates the UI when user clicks like/unlike
2. Sends the reaction/deletion request to relays
3. Reverts the change if the operation fails
4. Reloads reactions from the network after 2 seconds to sync

## Files Modified
1. `src/app/components/event/reaction-button/reaction-button.component.ts` - New component
2. `src/app/components/event/reaction-button/reaction-button.component.html` - New template
3. `src/app/components/event/reaction-button/reaction-button.component.scss` - New styles
4. `src/app/components/article-display/article-display.component.ts` - Added reaction button import
5. `src/app/components/article-display/article-display.component.html` - Added reaction button to UI
6. `src/app/services/reaction.service.ts` - Added 'a' tag support for addressable events

## Testing
- ✅ Build passes successfully
- ✅ Linter passes with no errors
- ✅ Code review completed with all issues resolved
- ✅ Security scan (CodeQL) passes with no alerts

## Future Enhancements
- Add relay hints to 'e' and 'p' tags as recommended by NIP-25
- Add relay URL to 'e' tag in reposts as required by NIP-18 (MUST requirement)
- Support for custom emoji reactions beyond '+' and '-'
