# Metrics Service Usage Guide

## Overview

The Metrics service provides a comprehensive system for tracking user engagement and interaction metrics in the Nostria application. It stores metrics about how users interact with different pubkeys (user accounts) and provides methods to query and analyze this data.

## Key Features

### Tracked Metrics

The service tracks the following metrics for each user pubkey:

#### Profile Engagement
- **viewed**: Number of times the profile has been viewed
- **profileClicks**: Number of times profile link was clicked

#### Content Engagement
- **liked**: Number of posts we have liked by this author
- **read**: Number of articles by author we have read
- **replied**: Number of times we replied to this author
- **reposted**: Number of times we reposted this author's content
- **quoted**: Number of times we quoted this author

#### Interaction Metrics
- **messaged**: Number of direct messages sent to this author
- **mentioned**: Number of times we mentioned this author

#### Time-based Metrics
- **timeSpent**: Total time spent viewing this author's content (in seconds)
- **lastInteraction**: Timestamp of last interaction with this author
- **firstInteraction**: Timestamp of first interaction

#### Derived Metrics
- **averageTimePerView**: Calculated as timeSpent / viewed
- **engagementScore**: Weighted score based on all interactions

## Usage Examples

### Basic Usage

```typescript
import { inject } from '@angular/core';
import { Metrics } from './services/metrics';

export class MyComponent {
  private readonly metrics = inject(Metrics);

  async trackProfileView(pubkey: string) {
    await this.metrics.incrementMetric(pubkey, 'viewed');
  }

  async trackLike(pubkey: string) {
    await this.metrics.incrementMetric(pubkey, 'liked');
  }

  async trackTimeSpent(pubkey: string, seconds: number) {
    await this.metrics.addTimeSpent(pubkey, seconds);
  }
}
```

### Getting Metrics

```typescript
// Get metrics for a specific user
const userMetric = await this.metrics.getUserMetric(pubkey);

// Get metrics for multiple users
const metrics = await this.metrics.getUserMetrics([pubkey1, pubkey2, pubkey3]);

// Get all metrics
const allMetrics = await this.metrics.getMetrics();
```

### Querying Metrics

```typescript
// Get top 10 most viewed profiles
const topViewed = await this.metrics.getTopUsers('viewed', 10);

// Get top engaged users
const topEngaged = await this.metrics.getTopEngagedUsers(10);

// Custom query
const results = await this.metrics.queryMetrics({
  minViewed: 5,
  minLiked: 2,
  sortBy: 'engagementScore',
  sortOrder: 'desc',
  limit: 20
});
```

### Advanced Updates

```typescript
// Update multiple metrics at once
await this.metrics.updateMetric({
  pubkey: 'user-pubkey',
  metric: 'viewed',
  increment: 1
});

// Set absolute value
await this.metrics.updateMetric({
  pubkey: 'user-pubkey',
  metric: 'timeSpent',
  value: 3600 // 1 hour
});
```

## Integration with Algorithm Service

The metrics can be used in the Algorithm service to determine user preferences:

```typescript
async calculateProfileViewed(limit: number, ascending: boolean) {
  const following = this.accountState.followingList();
  const allMetrics = await this.metrics.getMetrics();
  
  // Filter metrics for users we follow
  const followingMetrics = allMetrics.filter(metric => 
    following.includes(metric.pubkey)
  );
  
  // Sort by engagement score
  const sortedMetrics = followingMetrics.sort((a, b) => 
    ascending 
      ? (a.engagementScore || 0) - (b.engagementScore || 0)
      : (b.engagementScore || 0) - (a.engagementScore || 0)
  );
  
  return sortedMetrics.slice(0, limit);
}
```

## Suggested Additional Metrics

Here are some additional metrics that could be easily added for more sophisticated algorithms:

### Content Quality Metrics
- **bookmarked**: Number of posts bookmarked from this author
- **shared**: Number of times content was shared outside the app
- **reportedSpam**: Number of times content was reported as spam (negative metric)

### Temporal Metrics
- **consecutiveDays**: Number of consecutive days interacting with this author
- **weeklyInteractions**: Average interactions per week
- **peakHours**: Hours when most interactions occur

### Social Metrics
- **mutualConnections**: Number of mutual connections
- **introducedBy**: Who introduced us to this user
- **influenceScore**: How much this user influences our actions

### Behavioral Metrics
- **scrollPastRate**: How often we scroll past their content without engaging
- **clickThroughRate**: Percentage of views that lead to profile clicks
- **responseTime**: Average time to respond to their messages

## Best Practices

1. **Batch Updates**: When tracking multiple metrics, consider batching updates to reduce database calls
2. **Privacy**: Ensure metrics are only stored locally and not shared
3. **Cleanup**: Implement periodic cleanup of old metrics to manage storage
4. **Performance**: Use queries with limits to avoid loading too much data
5. **Real-time Updates**: Consider implementing signals for real-time metric updates

## Error Handling

The service includes comprehensive error handling. All methods are async and will not throw exceptions in normal operation. Failed operations are logged but don't crash the application.

## Storage

Metrics are stored in IndexedDB using the existing storage service infrastructure. Each metric is stored with a composite key of `pubkey + 'metric'` type.
