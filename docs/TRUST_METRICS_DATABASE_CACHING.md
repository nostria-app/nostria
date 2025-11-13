# Trust Metrics Database Caching

## Overview

Web of Trust (NIP-85) trust metrics are now persisted in IndexedDB for improved performance and offline access. This enables querying profiles by trust rank and using trust metrics in feed algorithms.

## Implementation

### Database Storage

Trust metrics are stored in the `info` table with type `'trust'`:

```typescript
interface TrustMetrics {
  rank?: number;
  followers?: number;
  postCount?: number;
  zapAmtRecd?: number;
  zapAmtSent?: number;
  firstCreatedAt?: number;
  replyCount?: number;
  reactionsCount?: number;
  zapCntRecd?: number;
  zapCntSent?: number;
  lastUpdated?: number; // When this data was fetched
}
```

### Storage Service Methods

#### Save Trust Metrics
```typescript
await storage.saveTrustMetrics(pubkey: string, metrics: TrustMetrics): Promise<void>
```

#### Get Trust Metrics
```typescript
const metrics = await storage.getTrustMetrics(pubkey: string): Promise<TrustMetrics | null>
```

#### Query by Trust Rank
```typescript
// Get all pubkeys sorted by trust rank (highest first)
const pubkeys = await storage.getPubkeysByTrustRank(): Promise<string[]>

// Get pubkeys with rank >= 95
const highTrustPubkeys = await storage.getPubkeysByTrustRank(95): Promise<string[]>

// Get pubkeys with rank between 80-95
const mediumTrustPubkeys = await storage.getPubkeysByTrustRank(80, 95): Promise<string[]>
```

#### Delete Trust Metrics
```typescript
await storage.deleteTrustMetrics(pubkey: string): Promise<void>
```

### Trust Service

The `TrustService` now uses a multi-layered caching strategy:

1. **In-memory cache** - Fast access for recently accessed metrics
2. **Database cache** - Persistent storage across sessions
3. **Relay fetch** - Only when not in cache

#### Automatic Background Refresh

Cached metrics older than 24 hours are automatically refreshed in the background when accessed, ensuring data stays up-to-date without blocking UI.

#### Usage Example

```typescript
// Fetch metrics (checks cache first, then database, then relay)
const metrics = await trustService.fetchMetrics(pubkey);
if (metrics?.rank) {
  console.log(`Trust rank: ${metrics.rank}`);
}

// Query high-trust pubkeys
const highTrustPubkeys = await trustService.getPubkeysByTrustRank(95);

// Clear in-memory cache (database persists)
await trustService.clearCache();
```

## Use Cases

### 1. Profile Display
The profile hover card automatically loads and displays trust rank from cache:

```typescript
// In ProfileHoverCardComponent
private async loadTrustMetrics(pubkey: string): Promise<void> {
  const metrics = await this.trustService.fetchMetrics(pubkey);
  this.trustRank.set(metrics?.rank);
}
```

### 2. Feed Algorithms
Filter content by minimum trust rank:

```typescript
// Example: Only show posts from high-trust users
const highTrustPubkeys = await trustService.getPubkeysByTrustRank(95);
const filter = {
  kinds: [1],
  authors: highTrustPubkeys,
  limit: 50
};
```

### 3. User Discovery
Recommend users based on trust metrics:

```typescript
// Get top 20 highest-ranked users
const topPubkeys = await storage.getPubkeysByTrustRank();
const topProfiles = await Promise.all(
  topPubkeys.slice(0, 20).map(pk => dataService.getProfile(pk))
);
```

### 4. Content Moderation
Filter out low-trust users:

```typescript
// Example: Hide content from users with rank < 50
const metrics = await storage.getTrustMetrics(authorPubkey);
if (metrics && metrics.rank < 50) {
  // Hide or flag content
}
```

## Performance Benefits

- **Faster load times**: Trust metrics load from IndexedDB instead of relay queries
- **Offline access**: Cached metrics available without network connection
- **Reduced relay load**: Background refresh prevents unnecessary queries
- **Queryable data**: Can filter and sort users by trust rank locally

## Database Structure

Trust metrics are stored in the `info` table:
- **Key**: User pubkey (hex format)
- **Type**: `'trust'`
- **Composite Key**: `pubkey::trust`
- **Indexes**: By type, by key, by updated timestamp

Example record:
```json
{
  "key": "abc123...",
  "type": "trust",
  "compositeKey": "abc123...::trust",
  "updated": 1699900000000,
  "rank": 87,
  "followers": 1234,
  "postCount": 5678,
  "zapAmtRecd": 100000,
  "lastUpdated": 1699900000000
}
```

## Future Enhancements

1. **Algorithm Integration**: Create custom feeds filtered by trust rank
2. **Trust-based Notifications**: Prioritize notifications from high-trust users
3. **Spam Prevention**: Auto-hide content from very low-trust users
4. **Trust Trends**: Track trust rank changes over time
5. **Batch Updates**: Periodically refresh all cached metrics in background
6. **Trust Circles**: Visualize network of high-trust connections

## Configuration

Enable/disable trust features in settings:
```typescript
// LocalSettingsService
trustEnabled: boolean
trustRelay: string // Default: wss://relay.trustrank.io
```

## Notes

- Trust metrics automatically refresh after 24 hours when accessed
- Database cache persists across app restarts
- Clearing in-memory cache doesn't affect database storage
- Trust ranking is based on NIP-85 Web of Trust specification
