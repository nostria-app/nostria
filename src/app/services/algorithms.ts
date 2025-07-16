import { inject, Injectable } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { StorageService } from './storage.service';
import { Metrics } from './metrics';
import { UserMetric } from '../interfaces/metrics';

@Injectable({
  providedIn: 'root'
})
export class Algorithms {
  private readonly accountState = inject(AccountStateService);
  private readonly storage = inject(StorageService);
  private readonly metrics = inject(Metrics);

  constructor() { }

  async calculateProfileViewed(limit: number, ascending: boolean): Promise<UserMetric[]> {
    // Get the list of users we follow
    const following = this.accountState.followingList();
    
    // Get metrics for all users we follow
    const followingMetrics = await this.metrics.getUserMetrics(following);
    
    // Sort by engagement score or another metric
    const sortedMetrics = followingMetrics.sort((a, b) => {
      const scoreA = a.engagementScore || 0;
      const scoreB = b.engagementScore || 0;
      
      return ascending ? scoreA - scoreB : scoreB - scoreA;
    });
    
    return sortedMetrics.slice(0, limit);
  }

  /**
   * Get users most likely to be interested in based on engagement patterns
   */
  async getRecommendedUsers(limit: number = 10): Promise<UserMetric[]> {
    const allMetrics = await this.metrics.getMetrics();
    
    // Filter users with meaningful engagement
    const engagedUsers = allMetrics.filter(metric => 
      (metric.engagementScore || 0) > 10 && // Minimum engagement threshold
      metric.viewed > 5 && // Viewed multiple times
      metric.lastInteraction > Date.now() - (30 * 24 * 60 * 60 * 1000) // Active in last 30 days
    );
    
    // Sort by engagement score
    return engagedUsers
      .sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))
      .slice(0, limit);
  }

  /**
   * Calculate content affinity score for a user
   */
  async calculateContentAffinity(pubkey: string): Promise<number> {
    const userMetric = await this.metrics.getUserMetric(pubkey);
    
    if (!userMetric) return 0;
    
    // Weight different types of engagement
    const affinityScore = 
      (userMetric.liked * 3) +
      (userMetric.replied * 5) +
      (userMetric.reposted * 4) +
      (userMetric.quoted * 6) +
      (userMetric.messaged * 8) +
      (userMetric.timeSpent * 0.01) + // Time spent in seconds
      (userMetric.viewed * 1);
    
    return affinityScore;
  }

  /**
   * Get users with declining engagement (might need re-engagement)
   */
  async getDeclineingEngagementUsers(limit: number = 10): Promise<UserMetric[]> {
    const allMetrics = await this.metrics.getMetrics();
    
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    // Users who had engagement but haven't interacted recently
    const decliningUsers = allMetrics.filter(metric => 
      (metric.engagementScore || 0) > 20 && // Had good engagement
      metric.lastInteraction < thirtyDaysAgo // But not recent
    );
    
    return decliningUsers
      .sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))
      .slice(0, limit);
  }

  /**
   * Get users with highest time investment (deep engagement)
   */
  async getHighTimeInvestmentUsers(limit: number = 10): Promise<UserMetric[]> {
    return await this.metrics.getTopUsers('timeSpent', limit);
  }

  /**
   * Get users with best engagement rate (quality over quantity)
   */
  async getBestEngagementRateUsers(limit: number = 10): Promise<UserMetric[]> {
    const allMetrics = await this.metrics.getMetrics();
    
    // Calculate engagement rate (engagement actions / views)
    const usersWithRate = allMetrics
      .filter(metric => metric.viewed > 0) // Must have views
      .map(metric => ({
        ...metric,
        engagementRate: (metric.liked + metric.replied + metric.reposted + metric.quoted) / metric.viewed
      }))
      .filter(metric => metric.engagementRate > 0) // Must have some engagement
      .sort((a, b) => b.engagementRate - a.engagementRate);

    return usersWithRate.slice(0, limit);
  }
}
