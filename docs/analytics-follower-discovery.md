# Analytics - Follower Discovery Feature

## Overview

The Follower Discovery feature in the Analytics component allows users to discover who follows them on the Nostr network by querying for kind 3 (contact list) events that include the user's public key.

## User Interface

The feature is accessible from the Analytics page (Premium feature) via a new tab labeled "Followers Discovery" with a search icon.

### UI Components

1. **Relay Source Selector**
   - **Account Relays**: Use the user's configured account relays
   - **Custom Relays**: Allow users to add specific relay URLs
   - **Deep Discovery**: Combine account relays and discovery relays for broader coverage

2. **Custom Relay Input** (when Custom Relays is selected)
   - Text input field for entering relay URLs (format: `wss://relay.example.com`)
   - Add button to add the relay to the list
   - Validation with user-visible error messages
   - Chip list showing all added custom relays with remove buttons

3. **Discovery Actions**
   - "Discover Followers" button to initiate the search
   - Follower count display showing total and new followers
   - Progress bar and status messages during discovery

4. **Results Display**
   - List of discovered followers with profile components
   - Visual indicators showing following status:
     - Green chip with checkmark: Already following
     - Gray chip with add icon: Not following yet
   - Scrollable list (max height: 600px)

## Technical Implementation

### Data Flow

1. User selects relay source and clicks "Discover Followers"
2. System queries selected relays for kind 3 events with user's pubkey in p-tags
3. Event authors (pubkeys) are extracted and events are immediately discarded
4. Following status is checked against user's current following list
5. Results are sorted (non-following first) and displayed
6. Results are cached in localStorage

### Nostr Protocol Details

- **Event Type**: kind 3 (Contacts/Following List per NIP-02)
- **Query Filter**: `{ kinds: [3], '#p': [userPubkey], limit: 500 }`
- **Logic**: The authors of kind 3 events that include this user's pubkey in their p-tags are the users who follow the current user

### Memory Management

- Kind 3 events are **not stored** - only author pubkeys are extracted
- Events are immediately discarded after processing
- SimplePool is created for the query and properly closed in a finally block
- Minimal memory footprint

### Caching

**Cache Key Format**: `follower-discovery-{pubkey}`

**Cache Structure**:
```typescript
interface FollowerDiscoveryCache {
  followers: DiscoveredFollower[];  // Array of follower data
  lastUpdated: number;               // Timestamp in milliseconds
  relaySource: RelaySource;          // Source used for discovery
  customRelays?: string[];           // Custom relay URLs if applicable
}
```

**Cache Behavior**:
- Saved to localStorage after successful discovery
- Loaded on component initialization
- Persists across browser sessions
- Per-user (different cache per pubkey)

### Limitations

- **Event Limit**: Currently limited to 500 kind 3 events per query
- Users with more than 500 followers may need multiple queries (future enhancement)
- Relay availability affects discovery completeness

## Code Structure

### New Interfaces

```typescript
type RelaySource = 'account' | 'custom' | 'deep';

interface DiscoveredFollower {
  pubkey: string;
  isFollowing: boolean;
  discoveredAt: number;
}

interface FollowerDiscoveryCache {
  followers: DiscoveredFollower[];
  lastUpdated: number;
  relaySource: RelaySource;
  customRelays?: string[];
}
```

### Key Methods

- `discoverFollowers()`: Main discovery method
- `getRelayUrlsForDiscovery()`: Get relays based on selected source
- `getDeepDiscoveryRelays()`: Combine relays for deep discovery
- `addCustomRelay()`: Add and validate custom relay URL
- `removeCustomRelay()`: Remove custom relay
- `loadFollowerDiscoveryCache()`: Load cached data
- `saveFollowerDiscoveryCache()`: Save data to cache

### New Signals

- `discoveredFollowers`: Array of discovered followers
- `followerDiscoveryLoading`: Loading state
- `followerDiscoveryProgress`: Progress percentage (0-100)
- `followerDiscoveryStatus`: Status message
- `selectedRelaySource`: Currently selected relay source
- `customRelayInput`: Input field value
- `customRelays`: Array of custom relay URLs
- `customRelayError`: Validation error message
- `newFollowersCount`: Computed count of non-following users

## User Guide

### How to Use

1. Navigate to Analytics page (Premium feature required)
2. Click on the "Followers Discovery" tab
3. Select your preferred relay source:
   - **Account Relays**: Fastest, uses your configured relays
   - **Custom Relays**: Add specific relays you want to query
   - **Deep Discovery**: Most comprehensive, searches multiple relay sources
4. Click "Discover Followers"
5. Wait for the discovery process to complete
6. Review the list of followers
7. Users marked "Not Following" are potential new connections

### Tips

- Use "Account Relays" for quick checks
- Use "Deep Discovery" for comprehensive follower discovery
- Use "Custom Relays" to target specific relay communities
- Results are cached - re-running discovery will update the cache
- The cache persists across browser sessions

## Future Enhancements

Potential improvements for future releases:

1. **Pagination**: Handle more than 500 followers
2. **Batch Actions**: Follow multiple discovered users at once
3. **Filtering**: Filter by following status, date discovered
4. **Sorting Options**: Sort by name, date, etc.
5. **Export**: Export follower list to CSV
6. **Schedule**: Auto-refresh follower discovery periodically
7. **Notifications**: Alert when new followers are discovered
8. **Analytics**: Track follower growth over time

## Security Considerations

- No security vulnerabilities detected by CodeQL analysis
- Custom relay URLs are validated before use
- Only wss:// and ws:// protocols accepted
- No sensitive data stored (only public pubkeys)
- SimplePool properly closed to prevent resource leaks
