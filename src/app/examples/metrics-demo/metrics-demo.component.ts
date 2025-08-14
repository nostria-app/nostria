import { Component, inject, OnInit } from '@angular/core';
import { Metrics } from '../../services/metrics';
import { UserMetric } from '../../interfaces/metrics';

@Component({
  selector: 'app-metrics-demo',
  standalone: true,
  template: `
    <div class="metrics-demo">
      <h2>Metrics Service Demo</h2>

      <div class="demo-section">
        <h3>Track User Interactions</h3>
        <button (click)="trackProfileView()">Track Profile View</button>
        <button (click)="trackLike()">Track Like</button>
        <button (click)="trackReply()">Track Reply</button>
        <button (click)="trackTimeSpent()">Track Time Spent (30s)</button>
      </div>

      <div class="demo-section">
        <h3>Current Metrics for Test User</h3>
        @if (currentMetric) {
          <div class="metric-display">
            <p><strong>Pubkey:</strong> {{ currentMetric.pubkey }}</p>
            <p><strong>Profile Views:</strong> {{ currentMetric.viewed }}</p>
            <p><strong>Likes:</strong> {{ currentMetric.liked }}</p>
            <p><strong>Replies:</strong> {{ currentMetric.replied }}</p>
            <p><strong>Time Spent:</strong> {{ currentMetric.timeSpent }}s</p>
            <p>
              <strong>Engagement Score:</strong>
              {{ currentMetric.engagementScore }}
            </p>
            <p>
              <strong>Average Time per View:</strong>
              {{ currentMetric.averageTimePerView?.toFixed(2) }}s
            </p>
          </div>
        }
      </div>

      <div class="demo-section">
        <h3>Top Engaged Users</h3>
        @for (user of topUsers; track user.pubkey) {
          <div class="user-metric">
            <p>
              <strong>{{ user.pubkey.slice(0, 16) }}...</strong>
            </p>
            <p>Engagement Score: {{ user.engagementScore }}</p>
            <p>
              Views: {{ user.viewed }}, Likes: {{ user.liked }}, Replies:
              {{ user.replied }}
            </p>
          </div>
        }
      </div>

      <div class="demo-section">
        <h3>Actions</h3>
        <button (click)="loadMetrics()">Refresh Metrics</button>
        <button (click)="resetTestUser()">Reset Test User</button>
        <button (click)="createSampleData()">Create Sample Data</button>
      </div>
    </div>
  `,
  styles: [
    `
      .metrics-demo {
        padding: 20px;
        max-width: 800px;
      }

      .demo-section {
        margin-bottom: 30px;
        padding: 20px;
        border: 1px solid var(--mat-sys-color-outline);
        border-radius: 8px;
      }

      .demo-section h3 {
        margin-top: 0;
        color: var(--mat-sys-color-primary);
      }

      .metric-display,
      .user-metric {
        background: var(--mat-sys-color-surface-container);
        padding: 15px;
        border-radius: 4px;
        margin: 10px 0;
      }

      .user-metric {
        margin-bottom: 10px;
      }

      button {
        background: var(--mat-sys-color-primary);
        color: var(--mat-sys-color-on-primary);
        border: none;
        padding: 10px 16px;
        border-radius: 4px;
        margin: 5px;
        cursor: pointer;
      }

      button:hover {
        background: var(--mat-sys-color-primary-container);
        color: var(--mat-sys-color-on-primary-container);
      }
    `,
  ],
})
export class MetricsDemoComponent implements OnInit {
  private readonly metrics = inject(Metrics);

  // Test user pubkey (in real app, this would come from actual users)
  private readonly testPubkey = 'test-user-pubkey-123';

  currentMetric: UserMetric | null = null;
  topUsers: UserMetric[] = [];

  async ngOnInit() {
    await this.loadMetrics();
  }

  async trackProfileView() {
    await this.metrics.incrementMetric(this.testPubkey, 'viewed');
    await this.loadMetrics();
  }

  async trackLike() {
    await this.metrics.incrementMetric(this.testPubkey, 'liked');
    await this.loadMetrics();
  }

  async trackReply() {
    await this.metrics.incrementMetric(this.testPubkey, 'replied');
    await this.loadMetrics();
  }

  async trackTimeSpent() {
    await this.metrics.addTimeSpent(this.testPubkey, 30); // 30 seconds
    await this.loadMetrics();
  }

  async loadMetrics() {
    this.currentMetric = await this.metrics.getUserMetric(this.testPubkey);
    this.topUsers = await this.metrics.getTopEngagedUsers(5);
  }

  async resetTestUser() {
    await this.metrics.resetUserMetrics(this.testPubkey);
    await this.loadMetrics();
  }

  async createSampleData() {
    const sampleUsers = [
      'user-alice-pubkey',
      'user-bob-pubkey',
      'user-charlie-pubkey',
      'user-diana-pubkey',
      'user-eve-pubkey',
    ];

    for (const pubkey of sampleUsers) {
      // Create random metrics for each user
      const viewCount = Math.floor(Math.random() * 50) + 1;
      const likeCount = Math.floor(Math.random() * 20) + 1;
      const replyCount = Math.floor(Math.random() * 10) + 1;
      const timeSpent = Math.floor(Math.random() * 1000) + 100;

      // Track metrics for each user
      for (let i = 0; i < viewCount; i++) {
        await this.metrics.incrementMetric(pubkey, 'viewed');
      }
      for (let i = 0; i < likeCount; i++) {
        await this.metrics.incrementMetric(pubkey, 'liked');
      }
      for (let i = 0; i < replyCount; i++) {
        await this.metrics.incrementMetric(pubkey, 'replied');
      }
      await this.metrics.addTimeSpent(pubkey, timeSpent);
    }

    await this.loadMetrics();
  }
}
