# Event Search by ID Feature

## Overview

Enhanced the search functionality to automatically detect and search for Nostr events when a user enters a 64-character hexadecimal string (event ID) that doesn't match any cached profiles.

## Implementation

### Problem
When users entered an event hex ID into the search bar, the search would continuously retry searching through cached profiles, causing an infinite loop and failing to find the event.

### Solution

Added intelligent event ID detection and a multi-tiered relay search strategy:

1. **Event ID Detection**: Recognizes valid 64-character hexadecimal strings as potential event IDs
2. **Tiered Search Strategy**:
   - First attempts to find the event in the user's account relays (fastest, most relevant)
   - Falls back to searching through observed relays sorted by popularity
   - Tries up to 20 of the most popular relays

### Search Priority

When an event ID search is triggered:

1. **Account Relays** (if user is authenticated)
   - Uses the user's configured relay list
   - Most likely to contain relevant events

2. **Popular Observed Relays**
   - Sorted by multiple criteria:
     - Connection status (connected relays first)
     - Events received count (popularity)
     - Last successful connection time
   - Limits search to top 20 relays to balance thoroughness with performance

### Code Changes

**File**: `src/app/services/search.service.ts`

#### New Dependencies
```typescript
import { UserDataService } from './user-data.service';
import { RelaysService } from './relays/relays';
import { RelayPoolService } from './relays/relay-pool';
import { StorageService } from './storage.service';
```

#### Key Features

1. **Duplicate Search Prevention**
   - Tracks last processed query with `#lastQuery`
   - Early returns if query hasn't changed
   - Uses `untracked()` to prevent reactive dependency loops

2. **Event ID Validation**
   ```typescript
   const isHexEventId = /^[0-9a-f]{64}$/i.test(searchValue);
   ```

3. **Smart Search Logic**
   - Only triggers event search when:
     - No cached profile results found
     - Query matches event ID pattern

4. **Error Handling**
   - Graceful fallback through relay list
   - User-friendly toast notifications
   - Debug logging for troubleshooting

### User Experience

1. User enters a 64-character hex string in the search bar
2. System first checks cached profiles (instant)
3. If no profiles match and format is valid:
   - Shows searching indicator
   - Tries account relays (1-2 seconds)
   - Falls back to popular relays if needed (2-5 seconds)
4. When found:
   - Automatically navigates to event page
   - Closes search interface
   - Saves event to local storage for future quick access
5. If not found after trying 20 relays:
   - Shows "Event not found" toast
   - Search interface remains open

### Performance Considerations

- **Timeout per relay**: 2 seconds
- **Maximum relays tried**: 20
- **Total maximum search time**: ~40 seconds (in worst case)
- **Parallel vs Sequential**: Searches sequentially to minimize resource usage
- **Caching**: Successfully found events are saved locally

### Benefits

1. **No More Infinite Loops**: Query tracking prevents redundant searches
2. **Smart Prioritization**: Checks most likely sources first
3. **Resource Efficient**: Limits relay queries and uses timeouts
4. **Better Discovery**: Enables finding events from any relay
5. **Offline Support**: Found events are cached for future use

### Future Enhancements

Potential improvements for consideration:

- Parallel relay queries for faster results
- Configurable relay limit and timeout values
- User preference for relay search strategy
- Show progress indicator during multi-relay search
- Allow canceling in-progress searches
