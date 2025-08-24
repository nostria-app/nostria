import { Injectable, inject } from '@angular/core';
import { Metrics } from './metrics';

@Injectable({
  providedIn: 'root',
})
export class ProfileTrackingService {
  private readonly metrics = inject(Metrics);

  /**
   * Track when a user views a profile
   */
  async trackProfileView(pubkey: string) {
    if (!pubkey) return;
    await this.metrics.incrementMetric(pubkey, 'viewed');
  }

  /**
   * Track when a user clicks on a profile
   */
  async trackProfileClick(pubkey: string) {
    if (!pubkey) return;
    await this.metrics.incrementMetric(pubkey, 'profileClicks');
  }

  /**
   * Track when a user likes a post by an author
   */
  async trackLike(pubkey: string) {
    if (!pubkey) return;
    await this.metrics.incrementMetric(pubkey, 'liked');
  }

  /**
   * Track when a user reads content from an author
   */
  async trackRead(pubkey: string) {
    if (!pubkey) return;
    await this.metrics.incrementMetric(pubkey, 'read');
  }

  /**
   * Track when a user replies to an author
   */
  async trackReply(pubkey: string) {
    if (!pubkey) return;
    await this.metrics.incrementMetric(pubkey, 'replied');
  }

  /**
   * Track when a user reposts content from an author
   */
  async trackRepost(pubkey: string) {
    if (!pubkey) return;
    await this.metrics.incrementMetric(pubkey, 'reposted');
  }

  /**
   * Track when a user quotes content from an author
   */
  async trackQuote(pubkey: string) {
    if (!pubkey) return;
    await this.metrics.incrementMetric(pubkey, 'quoted');
  }

  /**
   * Track when a user messages an author
   */
  async trackMessage(pubkey: string) {
    if (!pubkey) return;
    await this.metrics.incrementMetric(pubkey, 'messaged');
  }

  /**
   * Track when a user mentions an author
   */
  async trackMention(pubkey: string) {
    if (!pubkey) return;
    await this.metrics.incrementMetric(pubkey, 'mentioned');
  }

  /**
   * Track time spent viewing content from an author
   */
  async trackTimeSpent(pubkey: string, timeInSeconds: number) {
    if (!pubkey || timeInSeconds <= 0) return;
    await this.metrics.addTimeSpent(pubkey, timeInSeconds);
  }

  /**
   * Track multiple metrics at once for efficiency
   */
  async trackMultipleMetrics(updates: { pubkey: string; metric: string; increment?: number }[]) {
    for (const update of updates) {
      if (update.pubkey) {
        await this.metrics.updateMetric({
          pubkey: update.pubkey,
          metric: update.metric as any,
          increment: update.increment || 1,
        });
      }
    }
  }
}
