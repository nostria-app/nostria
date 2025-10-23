import { inject, Injectable } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { StorageService } from './storage.service';
import { Metrics } from './metrics';
import { UserMetric } from '../interfaces/metrics';
import { FavoritesService } from './favorites.service';
import { UtilitiesService } from './utilities.service';
import { RegionService } from './region.service';

@Injectable({
  providedIn: 'root',
})
export class Algorithms {
  private readonly accountState = inject(AccountStateService);
  private readonly storage = inject(StorageService);
  private readonly metrics = inject(Metrics);
  private readonly favoritesService = inject(FavoritesService);
  private readonly utilities = inject(UtilitiesService);
  private readonly regionService = inject(RegionService);

  async calculateProfileViewed(limit: number, ascending: boolean): Promise<UserMetric[]> {
    // Get the list of users we follow
    const following = this.accountState.followingList();

    // If user has zero following, return empty array
    if (following.length === 0) {
      return [];
    }

    // Filter out invalid pubkeys before processing
    const validFollowing = following.filter(pubkey => this.utilities.isValidPubkey(pubkey));

    if (validFollowing.length !== following.length) {
      console.warn(
        `Filtered out ${following.length - validFollowing.length} invalid pubkeys from following list`
      );
    }

    // Get metrics for all valid users we follow
    const followingMetrics = await this.metrics.getUserMetrics(validFollowing);

    // Get favorites from the service
    const favorites = this.favoritesService.favorites();
    const validFavorites = favorites.filter(pubkey => this.utilities.isValidPubkey(pubkey));

    // Separate favorites from regular users
    const favoriteMetrics = followingMetrics.filter(metric =>
      validFavorites.includes(metric.pubkey)
    );
    const regularMetrics = followingMetrics.filter(
      metric => !validFavorites.includes(metric.pubkey)
    );

    // Sort favorites by engagement score (favorites are always at the top)
    const sortedFavorites = favoriteMetrics.sort((a, b) => {
      const scoreA = a.engagementScore || 0;
      const scoreB = b.engagementScore || 0;
      return ascending ? scoreA - scoreB : scoreB - scoreA;
    });

    // Sort regular users by engagement score
    const sortedRegular = regularMetrics.sort((a, b) => {
      const scoreA = a.engagementScore || 0;
      const scoreB = b.engagementScore || 0;
      return ascending ? scoreA - scoreB : scoreB - scoreA;
    });

    // Combine favorites first, then regular users
    const combined = [...sortedFavorites, ...sortedRegular];

    return combined.slice(0, limit);
  }

  /**
   * Get users most likely to be interested in based on engagement patterns
   */
  async getRecommendedUsers(limit = 10): Promise<UserMetric[]> {
    const allMetrics = await this.metrics.getMetrics();
    const favorites = this.favoritesService.favorites();
    const validFavorites = favorites.filter(pubkey => this.utilities.isValidPubkey(pubkey));

    // Filter users with meaningful engagement OR are favorites
    const candidateUsers = allMetrics.filter(metric => {
      // Ensure the metric itself has a valid pubkey
      if (!this.utilities.isValidPubkey(metric.pubkey)) {
        console.warn('Found metric with invalid pubkey:', metric.pubkey);
        return false;
      }

      const isFavorite = validFavorites.includes(metric.pubkey);
      const hasEngagement =
        (metric.engagementScore || 0) > 10 &&
        metric.viewed > 5 &&
        metric.lastInteraction > Date.now() - 30 * 24 * 60 * 60 * 1000;

      return hasEngagement || isFavorite;
    });

    // Add favorites that don't have metrics yet
    const metricsPublicKeys = new Set(allMetrics.map(m => m.pubkey));
    const favoritesWithoutMetrics = validFavorites.filter(pubkey => !metricsPublicKeys.has(pubkey));

    // Get current account pubkey
    const currentAccountPubkey = this.accountState.pubkey();

    // Create minimal metrics for favorites without data
    const favoriteMetrics: UserMetric[] = favoritesWithoutMetrics.map(pubkey => ({
      accountPubkey: currentAccountPubkey,
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
      lastInteraction: Date.now(),
      firstInteraction: Date.now(),
      updated: Date.now(),
      engagementScore: 1, // Very small positive score for favorites without metrics
    }));

    // Combine all candidates
    const allCandidates = [...candidateUsers, ...favoriteMetrics];

    // If no candidates found (new user with no metrics), return empty array
    if (allCandidates.length === 0) {
      return [];
    }

    // Calculate final score with favorite boost
    const scoredUsers = allCandidates.map(metric => {
      const baseScore = metric.engagementScore || 0;
      const favoriteBoost = validFavorites.includes(metric.pubkey) ? 2 : 0; // Small boost for favorites

      return {
        ...metric,
        finalScore: baseScore + favoriteBoost,
      };
    });

    // Sort by final score and return
    return scoredUsers.sort((a, b) => b.finalScore - a.finalScore).slice(0, limit);
  }

  /**
   * Calculate content affinity score for a user
   */
  async calculateContentAffinity(pubkey: string): Promise<number> {
    // Validate pubkey before processing
    if (!this.utilities.isValidPubkey(pubkey)) {
      console.warn('Invalid pubkey provided to calculateContentAffinity:', pubkey);
      return 0;
    }

    const userMetric = await this.metrics.getUserMetric(pubkey);

    if (!userMetric) return 0;

    // Weight different types of engagement
    const affinityScore =
      userMetric.liked * 3 +
      userMetric.replied * 5 +
      userMetric.reposted * 4 +
      userMetric.quoted * 6 +
      userMetric.messaged * 8 +
      userMetric.timeSpent * 0.01 + // Time spent in seconds
      userMetric.viewed * 1;

    return affinityScore;
  }

  /**
   * Get users with declining engagement (might need re-engagement)
   */
  async getDeclineingEngagementUsers(limit = 10): Promise<UserMetric[]> {
    const allMetrics = await this.metrics.getMetrics();

    // Filter out any metrics with invalid pubkeys
    const validMetrics = allMetrics.filter(metric => {
      if (!this.utilities.isValidPubkey(metric.pubkey)) {
        console.warn('Found metric with invalid pubkey in declining users:', metric.pubkey);
        return false;
      }
      return true;
    });

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Users who had engagement but haven't interacted recently
    const decliningUsers = validMetrics.filter(
      metric =>
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
  async getHighTimeInvestmentUsers(limit = 10): Promise<UserMetric[]> {
    return await this.metrics.getTopUsers('timeSpent', limit);
  }

  /**
   * Get users with best engagement rate (quality over quantity)
   */
  async getBestEngagementRateUsers(limit = 10): Promise<UserMetric[]> {
    const allMetrics = await this.metrics.getMetrics();

    // Calculate engagement rate (engagement actions / views)
    const usersWithRate = allMetrics
      .filter(metric => metric.viewed > 0) // Must have views
      .map(metric => ({
        ...metric,
        engagementRate:
          (metric.liked + metric.replied + metric.reposted + metric.quoted) / metric.viewed,
      }))
      .filter(metric => metric.engagementRate > 0) // Must have some engagement
      .sort((a, b) => b.engagementRate - a.engagementRate);

    return usersWithRate.slice(0, limit);
  }

  /**
   * Get users for article content - uses more lenient criteria since articles are rarer
   */
  async getRecommendedUsersForArticles(limit = 20): Promise<UserMetric[]> {
    const allMetrics = await this.metrics.getMetrics();
    const favorites = this.favoritesService.favorites();
    const following = this.accountState.followingList();

    // If user has zero following, return empty array
    if (following.length === 0) {
      return [];
    }

    // For articles, use much more lenient criteria
    const candidateUsers = allMetrics.filter(metric => {
      const isFavorite = favorites.includes(metric.pubkey);
      const isFollowing = following.includes(metric.pubkey);
      const hasAnyEngagement =
        (metric.engagementScore || 0) > 1 ||
        metric.viewed > 1 ||
        metric.read > 0 || // Specifically look for users whose content we've read
        metric.lastInteraction > Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days instead of 30

      return isFollowing && (hasAnyEngagement || isFavorite);
    });

    // Add favorites that don't have metrics yet
    const metricsPublicKeys = new Set(allMetrics.map(m => m.pubkey));
    const favoritesWithoutMetrics = favorites.filter(
      pubkey => !metricsPublicKeys.has(pubkey) && following.includes(pubkey)
    );

    // Get current account pubkey
    const currentAccountPubkey = this.accountState.pubkey();

    // Create minimal metrics for favorites without data
    const favoriteMetrics: UserMetric[] = favoritesWithoutMetrics.map(pubkey => ({
      accountPubkey: currentAccountPubkey,
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
      lastInteraction: Date.now(),
      firstInteraction: Date.now(),
      updated: Date.now(),
      engagementScore: 1,
    }));

    // If we don't have enough candidates, add more from following list
    const allCandidates = [...candidateUsers, ...favoriteMetrics];

    if (allCandidates.length < limit) {
      const candidatePubkeys = new Set(allCandidates.map(c => c.pubkey));
      const additionalUsers = following
        .filter(pubkey => !candidatePubkeys.has(pubkey))
        .slice(0, limit - allCandidates.length)
        .map(pubkey => ({
          accountPubkey: currentAccountPubkey,
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
          lastInteraction: Date.now(),
          firstInteraction: Date.now(),
          updated: Date.now(),
          engagementScore: 0.5,
        }));

      allCandidates.push(...additionalUsers);
    }

    // Calculate final score with read activity boost for articles
    const scoredUsers = allCandidates.map(metric => {
      const baseScore = metric.engagementScore || 0;
      const favoriteBoost = favorites.includes(metric.pubkey) ? 5 : 0;
      const readBoost = metric.read * 2; // Boost users whose content we've read

      return {
        ...metric,
        finalScore: baseScore + favoriteBoost + readBoost,
      };
    });

    // Sort by final score and return
    return scoredUsers.sort((a, b) => b.finalScore - a.finalScore).slice(0, limit);
  }
}
