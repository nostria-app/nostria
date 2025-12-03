import { inject, Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { UserMetric, MetricUpdate, MetricQuery } from '../interfaces/metrics';
import { UtilitiesService } from './utilities.service';
import { AccountStateService } from './account-state.service';

interface InfoRecord {
  key: string;
  type: string;
  updated: number;
  [key: string]: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class Metrics {
  private readonly database = inject(DatabaseService);
  private readonly utilities = inject(UtilitiesService);
  private readonly accountState = inject(AccountStateService);

  // In-memory cache for quick access
  private metricsCache = new Map<string, UserMetric>();

  /**
   * Generate a composite key for account-specific metrics
   */
  private generateMetricsKey(accountPubkey: string, trackedPubkey: string): string {
    return `${accountPubkey}:${trackedPubkey}`;
  }

  /**
   * Parse a metrics key back into account and tracked pubkeys
   */
  private parseMetricsKey(key: string): { accountPubkey: string; trackedPubkey: string } | null {
    const parts = key.split(':');
    if (parts.length === 2) {
      return { accountPubkey: parts[0], trackedPubkey: parts[1] };
    }
    // Legacy format (no account context)
    return null;
  }

  /**
   * Get all metrics from storage for the current account
   */
  async getMetrics(accountPubkey?: string): Promise<UserMetric[]> {
    const currentAccount = accountPubkey || this.accountState.pubkey();

    if (!currentAccount) {
      console.warn('No account context for metrics, returning empty array');
      return [];
    }

    const records = await this.database.getInfoByType('metric');

    // Filter and map records for the current account
    return records
      .map(record => this.mapRecordToMetric(record as InfoRecord, currentAccount))
      .filter((metric): metric is UserMetric => {
        // Filter out null values and metrics not belonging to current account
        return metric !== null && metric.accountPubkey === currentAccount;
      });
  }

  /**
   * Get metrics for a specific user (tracked by current account)
   */
  async getUserMetric(pubkey: string, accountPubkey?: string): Promise<UserMetric | null> {
    const currentAccount = accountPubkey || this.accountState.pubkey();

    if (!currentAccount) {
      console.warn('No account context for getUserMetric');
      return null;
    }

    // Validate pubkey before querying
    const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!validHexPubkey) {
      console.warn('Invalid pubkey provided to getUserMetric:', pubkey);
      return null;
    }

    const metricsKey = this.generateMetricsKey(currentAccount, validHexPubkey);

    // Check in-memory cache first
    if (this.metricsCache.has(metricsKey)) {
      return this.metricsCache.get(metricsKey)!;
    }

    // Fetch from storage
    const record = await this.database.getInfo(metricsKey, 'metric');
    const metric = record ? this.mapRecordToMetric(record as InfoRecord, currentAccount) : null;

    // Cache the result
    if (metric) {
      this.metricsCache.set(metricsKey, metric);
    }

    return metric;
  }

  /**
   * Get metrics for multiple users (batch fetch)
   */
  async getUserMetrics(pubkeys: string[]): Promise<UserMetric[]> {
    // Fetch all metrics in parallel
    const metricsPromises = pubkeys.map(async (pubkey) => {
      // Validate each pubkey
      const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
      if (!validHexPubkey) {
        console.warn('Invalid pubkey in getUserMetrics, skipping:', pubkey);
        return null;
      }

      return this.getUserMetric(validHexPubkey);
    });

    const results = await Promise.all(metricsPromises);
    return results.filter((metric): metric is UserMetric => metric !== null);
  }

  /**
   * Query metrics based on criteria
   */
  async queryMetrics(query: MetricQuery): Promise<UserMetric[]> {
    const accountPubkey = query.accountPubkey || this.accountState.pubkey();
    let metrics = await this.getMetrics(accountPubkey);

    // Filter by pubkey if specified
    if (query.pubkey) {
      metrics = metrics.filter(m => m.pubkey === query.pubkey);
    }

    // Filter by account if specified
    if (query.accountPubkey) {
      metrics = metrics.filter(m => m.accountPubkey === query.accountPubkey);
    }

    // Filter by minimum values
    if (query.minViewed !== undefined) {
      metrics = metrics.filter(m => m.viewed >= query.minViewed!);
    }

    if (query.minLiked !== undefined) {
      metrics = metrics.filter(m => m.liked >= query.minLiked!);
    }

    if (query.minEngagementScore !== undefined) {
      metrics = metrics.filter(m => (m.engagementScore || 0) >= query.minEngagementScore!);
    }

    // Sort if specified
    if (query.sortBy) {
      metrics.sort((a, b) => {
        const aValue = a[query.sortBy!] || 0;
        const bValue = b[query.sortBy!] || 0;

        if (query.sortOrder === 'desc') {
          return (bValue as number) - (aValue as number);
        } else {
          return (aValue as number) - (bValue as number);
        }
      });
    }

    // Limit results if specified
    if (query.limit) {
      metrics = metrics.slice(0, query.limit);
    }

    return metrics;
  }

  /**
   * Update a metric for a user
   */
  async updateMetric(update: MetricUpdate): Promise<void> {
    const { pubkey, metric, increment = 1, value, timestamp = Date.now() } = update;
    const accountPubkey = update.accountPubkey || this.accountState.pubkey();

    if (!accountPubkey) {
      console.warn('No account context for updateMetric, skipping');
      return;
    }

    // Validate pubkey before updating metrics
    const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!validHexPubkey) {
      console.warn('Invalid pubkey provided to updateMetric, skipping:', pubkey);
      return;
    }

    // Get existing metric or create new one
    let existingMetric = await this.getUserMetric(validHexPubkey, accountPubkey);

    if (!existingMetric) {
      existingMetric = this.createEmptyMetric(accountPubkey, validHexPubkey, timestamp);
    }

    // Update the specific metric
    if (value !== undefined) {
      // Set absolute value
      (existingMetric as unknown as Record<string, number>)[metric] = value;
    } else {
      // Increment by specified amount
      (existingMetric as unknown as Record<string, number>)[metric] =
        ((existingMetric as unknown as Record<string, number>)[metric] || 0) + increment;
    }

    // Update interaction timestamps
    existingMetric.lastInteraction = timestamp;
    existingMetric.updated = timestamp;

    // Calculate derived metrics
    existingMetric.averageTimePerView =
      existingMetric.viewed > 0 ? existingMetric.timeSpent / existingMetric.viewed : 0;

    existingMetric.engagementScore = this.calculateEngagementScore(existingMetric);

    // Save to storage
    await this.saveMetric(existingMetric);
  }

  /**
   * Increment a metric by 1
   */
  async incrementMetric(
    pubkey: string,
    metric: keyof Omit<
      UserMetric,
      'pubkey' | 'accountPubkey' | 'updated' | 'firstInteraction' | 'averageTimePerView' | 'engagementScore'
    >
  ): Promise<void> {
    // Validate pubkey before incrementing
    const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!validHexPubkey) {
      console.warn('Invalid pubkey provided to incrementMetric, skipping:', pubkey);
      return;
    }

    await this.updateMetric({ pubkey: validHexPubkey, metric, increment: 1 });
  }

  /**
   * Add time spent viewing content for a user
   */
  async addTimeSpent(pubkey: string, timeSpent: number): Promise<void> {
    // Validate pubkey before adding time
    const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!validHexPubkey) {
      console.warn('Invalid pubkey provided to addTimeSpent, skipping:', pubkey);
      return;
    }

    await this.updateMetric({
      pubkey: validHexPubkey,
      metric: 'timeSpent',
      increment: timeSpent,
    });
  }

  /**
   * Engagement point values for different action types
   */
  static readonly ENGAGEMENT_POINTS = {
    LIKE: 1,
    REPOST: 3,
    ZAP: 5,
    REPLY: 10,
  } as const;

  /**
   * Check if an event has already been processed for metrics
   */
  async isEventProcessed(eventId: string, accountPubkey?: string): Promise<boolean> {
    const currentAccount = accountPubkey || this.accountState.pubkey();
    if (!currentAccount) return false;

    const key = `processed:${currentAccount}:${eventId}`;
    const record = await this.database.getInfo(key, 'metric-processed');
    return record !== null;
  }

  /**
   * Mark an event as processed for metrics
   */
  async markEventProcessed(eventId: string, accountPubkey?: string): Promise<void> {
    const currentAccount = accountPubkey || this.accountState.pubkey();
    if (!currentAccount) return;

    const key = `processed:${currentAccount}:${eventId}`;
    await this.database.saveInfo(key, 'metric-processed', {
      eventId,
      accountPubkey: currentAccount,
      processedAt: Date.now(),
    });
  }

  /**
   * Add engagement points for a specific action type
   * This method also increments the corresponding counter (liked, reposted, zapped, replied)
   */
  async addEngagementPoints(
    pubkey: string,
    actionType: keyof typeof Metrics.ENGAGEMENT_POINTS,
    eventId: string,
    accountPubkey?: string
  ): Promise<boolean> {
    const currentAccount = accountPubkey || this.accountState.pubkey();
    if (!currentAccount) {
      console.warn('No account context for addEngagementPoints');
      return false;
    }

    // Validate pubkey
    const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!validHexPubkey) {
      console.warn('Invalid pubkey provided to addEngagementPoints:', pubkey);
      return false;
    }

    // Check if event has already been processed
    const alreadyProcessed = await this.isEventProcessed(eventId, currentAccount);
    if (alreadyProcessed) {
      // console.debug(`Event ${eventId} already processed for metrics, skipping`);
      return false;
    }

    const points = Metrics.ENGAGEMENT_POINTS[actionType];

    // Map action type to metric field
    const metricMap: Record<keyof typeof Metrics.ENGAGEMENT_POINTS, keyof UserMetric> = {
      LIKE: 'liked',
      REPOST: 'reposted',
      ZAP: 'zapped',
      REPLY: 'replied',
    };

    const metricField = metricMap[actionType];

    // Update the specific counter and engagement points
    await this.updateMetric({
      pubkey: validHexPubkey,
      metric: metricField as 'liked' | 'reposted' | 'zapped' | 'replied',
      increment: 1,
      accountPubkey: currentAccount,
    });

    await this.updateMetric({
      pubkey: validHexPubkey,
      metric: 'engagementPoints',
      increment: points,
      accountPubkey: currentAccount,
    });

    // Mark event as processed
    await this.markEventProcessed(eventId, currentAccount);

    console.debug(`Added ${points} engagement points to ${validHexPubkey} for ${actionType} (event: ${eventId})`);
    return true;
  }

  /**
   * Get top users by a specific metric
   */
  async getTopUsers(metric: keyof UserMetric, limit = 10): Promise<UserMetric[]> {
    return await this.queryMetrics({
      sortBy: metric,
      sortOrder: 'desc',
      limit,
    });
  }

  /**
   * Get users with highest engagement scores
   */
  async getTopEngagedUsers(limit = 10): Promise<UserMetric[]> {
    const metrics = await this.getMetrics();

    // Calculate engagement scores for all users
    metrics.forEach(metric => {
      metric.engagementScore = this.calculateEngagementScore(metric);
    });

    return metrics
      .sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))
      .slice(0, limit);
  }

  /**
   * Reset all metrics for a user (tracked by current account)
   */
  async resetUserMetrics(pubkey: string, accountPubkey?: string): Promise<void> {
    const currentAccount = accountPubkey || this.accountState.pubkey();

    if (!currentAccount) {
      console.warn('No account context for resetUserMetrics');
      return;
    }

    // Validate pubkey before resetting
    const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!validHexPubkey) {
      console.warn('Invalid pubkey provided to resetUserMetrics, skipping:', pubkey);
      return;
    }

    const metricsKey = this.generateMetricsKey(currentAccount, validHexPubkey);
    await this.database.deleteInfoByKeyAndType(metricsKey, 'metric');
  }

  /**
   * Reset all metrics for the current account
   */
  async resetAllMetrics(accountPubkey?: string): Promise<void> {
    const currentAccount = accountPubkey || this.accountState.pubkey();

    if (!currentAccount) {
      console.warn('No account context for resetAllMetrics');
      return;
    }

    const metrics = await this.getMetrics(currentAccount);

    for (const metric of metrics) {
      const metricsKey = this.generateMetricsKey(metric.accountPubkey, metric.pubkey);
      await this.database.deleteInfoByKeyAndType(metricsKey, 'metric');
    }
  }

  // Private helper methods

  private createEmptyMetric(accountPubkey: string, pubkey: string, timestamp: number): UserMetric {
    return {
      accountPubkey,
      pubkey,
      viewed: 0,
      profileClicks: 0,
      liked: 0,
      read: 0,
      replied: 0,
      reposted: 0,
      quoted: 0,
      zapped: 0,
      messaged: 0,
      mentioned: 0,
      timeSpent: 0,
      lastInteraction: timestamp,
      engagementPoints: 0,
      averageTimePerView: 0,
      engagementScore: 0,
      firstInteraction: timestamp,
      updated: timestamp,
    };
  }

  private async saveMetric(metric: UserMetric): Promise<void> {
    const { accountPubkey, pubkey, ...data } = metric;
    const metricsKey = this.generateMetricsKey(accountPubkey, pubkey);

    // Update in-memory cache
    this.metricsCache.set(metricsKey, metric);

    // Save to storage
    await this.database.saveInfo(metricsKey, 'metric', { accountPubkey, ...data });
  }

  private mapRecordToMetric(record: InfoRecord, accountPubkey: string): UserMetric | null {
    // Parse the key to extract account and tracked pubkeys
    const parsed = this.parseMetricsKey(record.key);

    // If it's a legacy record (no account context), skip it during migration
    if (!parsed) {
      return null;
    }

    // Only return metrics for the specified account
    if (parsed.accountPubkey !== accountPubkey) {
      return null;
    }

    return {
      accountPubkey: parsed.accountPubkey,
      pubkey: parsed.trackedPubkey,
      viewed: (record['viewed'] as number) || 0,
      profileClicks: (record['profileClicks'] as number) || 0,
      liked: (record['liked'] as number) || 0,
      read: (record['read'] as number) || 0,
      replied: (record['replied'] as number) || 0,
      reposted: (record['reposted'] as number) || 0,
      quoted: (record['quoted'] as number) || 0,
      zapped: (record['zapped'] as number) || 0,
      messaged: (record['messaged'] as number) || 0,
      mentioned: (record['mentioned'] as number) || 0,
      timeSpent: (record['timeSpent'] as number) || 0,
      lastInteraction: (record['lastInteraction'] as number) || 0,
      engagementPoints: (record['engagementPoints'] as number) || 0,
      averageTimePerView: (record['averageTimePerView'] as number) || 0,
      engagementScore: (record['engagementScore'] as number) || 0,
      firstInteraction: (record['firstInteraction'] as number) || Date.now(),
      updated: record.updated || Date.now(),
    };
  }

  private calculateEngagementScore(metric: UserMetric): number {
    // Weighted engagement score calculation
    const weights = {
      viewed: 1,
      profileClicks: 2,
      liked: 3,
      read: 4,
      replied: 5,
      reposted: 4,
      quoted: 6,
      zapped: 10,
      messaged: 8,
      mentioned: 4,
      timeSpent: 0.001, // Per second
      engagementPoints: 1, // Direct contribution from point-based tracking
    };

    const score =
      metric.viewed * weights.viewed +
      metric.profileClicks * weights.profileClicks +
      metric.liked * weights.liked +
      metric.read * weights.read +
      metric.replied * weights.replied +
      metric.reposted * weights.reposted +
      metric.quoted * weights.quoted +
      metric.zapped * weights.zapped +
      metric.messaged * weights.messaged +
      metric.mentioned * weights.mentioned +
      metric.timeSpent * weights.timeSpent +
      metric.engagementPoints * weights.engagementPoints;

    return Math.round(score * 100) / 100; // Round to 2 decimal places
  }
}
