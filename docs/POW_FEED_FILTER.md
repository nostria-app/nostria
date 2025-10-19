# Proof-of-Work Feed Filter

## Overview

This feature allows users to filter events in their feed columns based on minimum Proof-of-Work (PoW) difficulty. Events that don't meet the minimum PoW requirement will be automatically filtered out from the feed.

## User Interface

### Column Configuration Dialog

When creating or editing a feed column, users can configure the PoW filter:

1. **PoW Filter Section**: Located in the column configuration dialog
2. **Difficulty Slider**: A slider control ranging from 0 to 40 bits
3. **Real-time Labels**: Shows current difficulty value and strength classification
4. **Visual Feedback**: Color-coded indicator showing filter strength

### Difficulty Classifications

- **0 bits**: No filter (all events shown)
- **1-9 bits**: Very weak
- **10-15 bits**: Weak
- **16-19 bits**: Moderate
- **20-24 bits**: Strong
- **25-29 bits**: Very Strong
- **30+ bits**: Extreme

## Technical Implementation

### Data Flow

1. **Configuration Storage**: PoW minimum difficulty is stored in `ColumnConfig.filters.powMinDifficulty`
2. **Event Filtering**: Applied at multiple points in the feed loading pipeline:
   - Real-time subscription events (public feeds)
   - Following feed loading
   - Custom feed loading
   - Pagination (load more)

### Filter Logic

The filter checks each event for:
1. **Nonce Tag Presence**: Events without a nonce tag are rejected (no PoW)
2. **Actual Difficulty**: Calculated from event ID leading zero bits using `PowService.countLeadingZeroBits()`
3. **Minimum Requirement**: Event difficulty must be >= configured minimum

### Code Locations

#### UI Components
- **Component**: `new-column-dialog.component.ts`
- **Template**: `new-column-dialog.component.html`
- **Styles**: `new-column-dialog.component.scss`

#### Service Logic
- **Service**: `feed.service.ts`
- **Helper Method**: `meetsPoWRequirement(event, minDifficulty)`
- **Applied In**:
  - `subscribeToColumn()` - Real-time event subscription
  - `aggregateAndSortEvents()` - Event aggregation
  - All incremental update methods

#### Dependencies
- **PowService**: Provides `countLeadingZeroBits()` for difficulty calculation
- **ColumnConfig Interface**: Stores filter configuration in `filters` object

### Filter Application Points

#### 1. Real-time Subscriptions (Public Feeds)
```typescript
// In subscribeToColumn()
const powMinDifficulty = (column.filters?.['powMinDifficulty'] as number) || 0;

relayService.subscribe(filter, (event: Event) => {
  if (!this.meetsPoWRequirement(event, powMinDifficulty)) {
    return; // Filter out event
  }
  // Add to feed...
});
```

#### 2. Following Feed Loading
```typescript
// In fetchEventsFromUsers()
const powMinDifficulty = (feedData.column.filters?.['powMinDifficulty'] as number) || 0;
// Passed through aggregation chain
this.aggregateAndSortEvents(userEventsMap, powMinDifficulty);
```

#### 3. Pagination
```typescript
// In fetchOlderEventsFromUsers()
const powMinDifficulty = (feedData.column.filters?.['powMinDifficulty'] as number) || 0;
// Applied when loading more events
```

## NIP-13 Compliance

This feature follows [NIP-13](https://github.com/nostr-protocol/nips/blob/master/13.md) specification:

- **Difficulty Calculation**: Counts leading zero bits in event ID hex string
- **Nonce Tag Format**: `["nonce", nonce_value, target_difficulty]`
- **Validation**: Uses same algorithm as event creation (PowService)

## Usage Examples

### Example 1: Moderate Quality Filter
Set slider to **20 bits** for a "Strong" filter that allows well-mined notes while filtering spam.

### Example 2: High Quality Filter
Set slider to **25 bits** for a "Very Strong" filter that only shows events with significant computational effort.

### Example 3: No Filter (Default)
Leave slider at **0 bits** to show all events regardless of PoW.

## Performance Considerations

### Efficiency
- **Client-side Filtering**: Minimal overhead, simple bit counting
- **No Additional Network Requests**: Uses existing event data
- **Real-time Application**: Filter applied immediately as events arrive

### User Experience
- **Transparent**: Users understand why some events are filtered
- **Configurable**: Each column can have different PoW requirements
- **Persistent**: Settings saved in column configuration

## Future Enhancements

Potential improvements:
1. **Feed-level Defaults**: Set default PoW filter for all columns in a feed
2. **Dynamic Adjustment**: Automatically adjust based on spam levels
3. **Statistics**: Show percentage of events filtered
4. **Whitelist**: Allow specific users to bypass PoW filter
5. **Tag-based Filters**: Additional filtering by other NIP-13 tags

## Related Documentation

- [NOTE_EDITOR_POW.md](./NOTE_EDITOR_POW.md) - Creating events with PoW
- [POW_INDICATOR.md](./POW_INDICATOR.md) - Visual PoW indicators on event cards
- [NIP-13](https://github.com/nostr-protocol/nips/blob/master/13.md) - Nostr PoW specification
