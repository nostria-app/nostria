import { inject, Injectable } from '@angular/core';
import { StorageService, InfoRecord } from './storage.service';
import { UserMetric, MetricUpdate, MetricQuery } from '../interfaces/metrics';
import { UtilitiesService } from './utilities.service';
import { AccountStateService } from './account-state.service';

@Injectable({
  providedIn: 'root',
})
export class Metrics {
  private readonly storage = inject(StorageService);
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

    const records = await this.storage.getInfoByType('metric');

    // Filter and map records for the current account
    return records
      .map(record => this.mapRecordToMetric(record, currentAccount))
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
    const record = await this.storage.getInfo(metricsKey, 'metric');
    const metric = record ? this.mapRecordToMetric(record, currentAccount) : null;

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
    await this.storage.deleteInfoByKeyAndType(metricsKey, 'metric');
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
      await this.storage.deleteInfoByKeyAndType(metricsKey, 'metric');
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
      messaged: 0,
      mentioned: 0,
      timeSpent: 0,
      lastInteraction: timestamp,
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
    await this.storage.saveInfo(metricsKey, 'metric', { accountPubkey, ...data });
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
      viewed: record['viewed'] || 0,
      profileClicks: record['profileClicks'] || 0,
      liked: record['liked'] || 0,
      read: record['read'] || 0,
      replied: record['replied'] || 0,
      reposted: record['reposted'] || 0,
      quoted: record['quoted'] || 0,
      messaged: record['messaged'] || 0,
      mentioned: record['mentioned'] || 0,
      timeSpent: record['timeSpent'] || 0,
      lastInteraction: record['lastInteraction'] || 0,
      averageTimePerView: record['averageTimePerView'] || 0,
      engagementScore: record['engagementScore'] || 0,
      firstInteraction: record['firstInteraction'] || Date.now(),
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
      messaged: 8,
      mentioned: 4,
      timeSpent: 0.001, // Per second
    };

    const score =
      metric.viewed * weights.viewed +
      metric.profileClicks * weights.profileClicks +
      metric.liked * weights.liked +
      metric.read * weights.read +
      metric.replied * weights.replied +
      metric.reposted * weights.reposted +
      metric.quoted * weights.quoted +
      metric.messaged * weights.messaged +
      metric.mentioned * weights.mentioned +
      metric.timeSpent * weights.timeSpent;

    return Math.round(score * 100) / 100; // Round to 2 decimal places
  }
}
