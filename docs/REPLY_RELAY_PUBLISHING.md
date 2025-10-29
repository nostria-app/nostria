# Comprehensive Relay Publishing for All User Interactions

## Issue
When interacting with other users' content (replying, liking, reposting, quoting, or zapping), events were only being published to the author's own relays. This caused:
- Users not receiving notifications of interactions on their content
- Broken thread continuity across different relay sets
- Poor discoverability of responses and engagement

## Solution
Centralized all event publishing through `PublishService` to ensure consistent relay distribution for ALL interaction types. The `PublishService` automatically detects event kinds and extracts p-tags to publish to both your relays and all mentioned users' relays.

### Architecture

#### Core Publishing Flow
All interactions now follow this unified pattern:

```
User Action (like/reply/repost/quote/article)
    ↓
Service creates UnsignedEvent with appropriate tags (e, p, q, etc.)
    ↓
nostr.service.signAndPublish(unsignedEvent)
    ↓
PublishService.publish(signedEvent, { notifyMentioned: true })
    ↓
Automatically extracts all p-tags (mentioned users)
    ↓
Gets relay URLs for each user via UserRelaysService
    ↓
Publishes to: account relays + all mentioned users' relays
    ↓
Returns success with relay-by-relay status tracking
```

### Interaction Types Covered

#### 1. **Replies** (Kind 1 with e/p tags)
When replying to a post:
- Creates event with p-tags for all thread participants
- `PublishService` automatically publishes to all p-tagged users' relays
- Includes original author and all thread participants

**Implementation**: `note-editor-dialog.component.ts` → `nostrService.signAndPublish()` → `PublishService`

#### 2. **Quotes** (Kind 1 with q tag - NIP-18)
When quoting a post:
- Creates event with BOTH 'q' tag and 'p' tag for quoted author (per NIP-18 spec)
- `PublishService` automatically publishes to quoted user's relays via p-tag
- Includes any additional mentioned users

**Implementation**: `note-editor-dialog.component.ts` → `nostrService.signAndPublish()` → `PublishService`

**Key Fix**: Added automatic p-tag creation for quoted users:
```typescript
// Add quote tag (NIP-18)
if (this.data?.quote) {
  tags.push(['q', this.data.quote.id, relay, this.data.quote.pubkey]);
  // Also add a p-tag for proper notifications
  if (!existingPubkeys.includes(this.data.quote.pubkey)) {
    tags.push(['p', this.data.quote.pubkey]);
  }
}
```

#### 3. **Reactions/Likes** (Kind 7)
When liking or reacting to content:
- Creates reaction event with p-tag for reacted event's author
- `PublishService` automatically publishes to reacted user's relays

**Implementation**: `reaction.service.ts` → `nostr.service.signAndPublish()` → `PublishService`

#### 4. **Reposts** (Kind 6 for notes, Kind 16 for other events)
When reposting content:
- Creates repost event with p-tag for reposted author
- `PublishService` automatically publishes to reposted user's relays

**Implementation**: `repost.service.ts` → `nostr.service.signAndPublish()` → `PublishService`

#### 5. **Follows** (Kind 3)
When following new users:
- Creates contact list event
- `PublishService` publishes to your relays + newly followed users' relays
- Uses `notifyFollowed: true` option

**Implementation**: All follow operations → `nostrService.signAndPublish()` → `PublishService`

#### 6. **Articles** (Kind 30023)
When publishing articles that mention users:
- Extracts NIP-27 references and creates p-tags
- `PublishService` automatically publishes to all mentioned users' relays

**Implementation**: `article/editor/editor.component.ts` → `nostr.service.signAndPublish()` → `PublishService`

#### 7. **Zaps** (Kind 9734 zap requests)
Zap requests are handled through the Lightning LNURL flow:
- Zap request event (kind 9734) is created and signed
- Published through the LNURL service provider
- The zap receipt (kind 9735) is published by the Lightning service provider

**Implementation**: `zap.service.ts` - Uses external LNURL infrastructure

## Core Services

### PublishService
Central publishing service that handles ALL event publishing with intelligent relay selection:

```typescript
async publish(event: Event, options: PublishOptions = {}): Promise<PublishResult>
```

**Automatic Relay Distribution Logic**:
- **Kind 1, 6, 7, 16** (notes, reposts, reactions): Extracts p-tags → publishes to account + all mentioned users' relays
- **Kind 3** (follows): When `notifyFollowed: true`, publishes to account + newly followed users' relays  
- **Kind 30023** (articles): Extracts p-tags → publishes to account + all mentioned users' relays
- **All other kinds**: Publishes to account relays only

### NostrService.signAndPublish()
Convenience method that ALL services should use:

```typescript
async signAndPublish(event: UnsignedEvent): Promise<boolean> {
  const signedEvent = await this.signEvent(event);
  const options = signedEvent.kind === kinds.Contacts
    ? { notifyFollowed: true, useOptimizedRelays: false }
    : { notifyMentioned: true, useOptimizedRelays: false };
  const result = await this.publishService.publish(signedEvent, options);
  return result.success;
}
```

### UserRelaysService
Manages relay discovery and caching:
- Automatically discovers and caches user relay lists
- Efficiently handles multiple concurrent relay lookups
- Used internally by `PublishService`

## Key Improvements

### 1. Centralized Publishing
All publishing now goes through `PublishService` instead of manual relay distribution:
- ✅ Consistent behavior across all event types
- ✅ Single source of truth for relay distribution logic
- ✅ Easier to maintain and debug
- ✅ Automatic p-tag detection and relay discovery

### 2. Proper NIP-18 Quote Implementation
Quotes now correctly add BOTH 'q' and 'p' tags:
- Ensures the quoted user receives proper notifications
- Follows NIP-18 specification exactly

### 3. No Code Duplication
Removed custom publishing logic from individual components:
- `note-editor-dialog.component.ts` - Now uses `signAndPublish()`
- `article/editor/editor.component.ts` - Now uses `signAndPublish()`
- All interaction services already used `signAndPublish()`

### 4. Graceful Error Handling
- Individual relay failures don't block the entire publish
- Relay-by-relay status tracking via `NotificationService`
- Users see detailed publishing progress in notifications

## Benefits

1. **Reliable Notification Delivery**: Users consistently receive notifications when mentioned, replied to, or quoted
2. **Thread Continuity**: Full conversation threads visible across all participants' relay sets
3. **Improved Discoverability**: Interactions visible on both author's and engager's relay sets
4. **Follows Nostr Best Practices**: Aligns with decentralized, multi-relay architecture
5. **Maintainable Codebase**: Single publishing path for all event types
6. **Better User Experience**: Detailed relay publishing notifications with progress tracking

## Technical Notes

- **Automatic Relay Discovery**: `UserRelaysService` handles relay discovery and caching
- **Deduplication**: Uses Set internally to avoid publishing to same relay multiple times
- **No Optimization**: For user interactions, deliberately avoids relay optimization (`useOptimizedRelays: false`) to ensure maximum reach
- **P-tag Based**: All relay distribution is based on extracting p-tags from events
- **Notification Tracking**: Publishing progress tracked via `NotificationService` for user feedback
