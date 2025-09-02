import { inject, Injectable } from '@angular/core';
import { StorageService } from './storage.service';
import { UserMetric, MetricUpdate, MetricQuery } from '../interfaces/metrics';
import { UtilitiesService } from './utilities.service';

@Injectable({
  providedIn: 'root',
})
export class Metrics {
  private readonly storage = inject(StorageService);
  private readonly utilities = inject(UtilitiesService);

  constructor() { }

  /**
   * Get all metrics from storage
   */
  async getMetrics(): Promise<UserMetric[]> {
    const records = await this.storage.getInfoByType('metric');
    return records.map((record) => this.mapRecordToMetric(record));
  }

  /**
   * Get metrics for a specific user
   */
  async getUserMetric(pubkey: string): Promise<UserMetric | null> {
    // Validate pubkey before querying
    const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!validHexPubkey) {
      console.warn('Invalid pubkey provided to getUserMetric:', pubkey);
      return null;
    }

    const record = await this.storage.getInfo(validHexPubkey, 'metric');
    return record ? this.mapRecordToMetric(record) : null;
  }

  /**
   * Get metrics for multiple users
   */
  async getUserMetrics(pubkeys: string[]): Promise<UserMetric[]> {
    const metrics: UserMetric[] = [];

    for (const pubkey of pubkeys) {
      // Validate each pubkey
      const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
      if (!validHexPubkey) {
        console.warn('Invalid pubkey in getUserMetrics, skipping:', pubkey);
        continue;
      }

      const metric = await this.getUserMetric(validHexPubkey);
      if (metric) {
        metrics.push(metric);
      }
    }

    return metrics;
  }

  /**
   * Query metrics based on criteria
   */
  async queryMetrics(query: MetricQuery): Promise<UserMetric[]> {
    let metrics = await this.getMetrics();

    // Filter by pubkey if specified
    if (query.pubkey) {
      metrics = metrics.filter((m) => m.pubkey === query.pubkey);
    }

    // Filter by minimum values
    if (query.minViewed !== undefined) {
      metrics = metrics.filter((m) => m.viewed >= query.minViewed!);
    }

    if (query.minLiked !== undefined) {
      metrics = metrics.filter((m) => m.liked >= query.minLiked!);
    }

    if (query.minEngagementScore !== undefined) {
      metrics = metrics.filter((m) => (m.engagementScore || 0) >= query.minEngagementScore!);
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

    // Validate pubkey before updating metrics
    const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!validHexPubkey) {
      console.warn('Invalid pubkey provided to updateMetric, skipping:', pubkey);
      return;
    }

    // Get existing metric or create new one
    let existingMetric = await this.getUserMetric(validHexPubkey);

    if (!existingMetric) {
      existingMetric = this.createEmptyMetric(validHexPubkey, timestamp);
    }

    // Update the specific metric
    if (value !== undefined) {
      // Set absolute value
      (existingMetric as any)[metric] = value;
    } else {
      // Increment by specified amount
      (existingMetric as any)[metric] = ((existingMetric as any)[metric] || 0) + increment;
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
      'pubkey' | 'updated' | 'firstInteraction' | 'averageTimePerView' | 'engagementScore'
    >,
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
    metrics.forEach((metric) => {
      metric.engagementScore = this.calculateEngagementScore(metric);
    });

    return metrics
      .sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))
      .slice(0, limit);
  }

  /**
   * Reset all metrics for a user
   */
  async resetUserMetrics(pubkey: string): Promise<void> {
    // Validate pubkey before resetting
    const validHexPubkey = this.utilities.safeGetHexPubkey(pubkey);
    if (!validHexPubkey) {
      console.warn('Invalid pubkey provided to resetUserMetrics, skipping:', pubkey);
      return;
    }

    await this.storage.deleteInfoByKeyAndType(validHexPubkey, 'metric');
  }

  /**
   * Reset all metrics in the system
   */
  async resetAllMetrics(): Promise<void> {
    const metrics = await this.getMetrics();

    for (const metric of metrics) {
      await this.storage.deleteInfoByKeyAndType(metric.pubkey, 'metric');
    }
  }

  // Private helper methods

  private createEmptyMetric(pubkey: string, timestamp: number): UserMetric {
    return {
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
    const { pubkey, ...data } = metric;
    await this.storage.saveInfo(pubkey, 'metric', data);
  }

  private mapRecordToMetric(record: any): UserMetric {
    return {
      pubkey: record.key,
      viewed: record.viewed || 0,
      profileClicks: record.profileClicks || 0,
      liked: record.liked || 0,
      read: record.read || 0,
      replied: record.replied || 0,
      reposted: record.reposted || 0,
      quoted: record.quoted || 0,
      messaged: record.messaged || 0,
      mentioned: record.mentioned || 0,
      timeSpent: record.timeSpent || 0,
      lastInteraction: record.lastInteraction || 0,
      averageTimePerView: record.averageTimePerView || 0,
      engagementScore: record.engagementScore || 0,
      firstInteraction: record.firstInteraction || Date.now(),
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
