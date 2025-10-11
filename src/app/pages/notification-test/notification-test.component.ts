import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { NotificationService } from '../../services/notification.service';
import { 
  NotificationType, 
  RelayPublishingNotification
} from '../../services/storage.service';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { NotificationListComponent } from '../../components/notification-list/notification-list.component';
import { Event } from 'nostr-tools';

/**
 * Comprehensive Notification Testing Page
 * 
 * This component provides a full testing interface for the notification system,
 * including simple notifications, relay publishing notifications, and notification management.
 * 
 * Features:
 * - Test general notifications with different types
 * - Test notifications with actions
 * - Simulate relay publishing with success/failure scenarios
 * - View and manage all notifications
 * - Real-time status updates
 */
@Component({
  selector: 'app-notification-test',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule,
    MatProgressBarModule,
    NotificationListComponent,
  ],
  template: `
    <div class="notification-test-container">
      <!-- Header -->
      <header class="test-header">
        <h1>
          <mat-icon>bug_report</mat-icon>
          Notification System Testing
        </h1>
        <p class="subtitle">Comprehensive testing interface for the notification system</p>
      </header>

      <div class="test-content">
        <!-- General Notifications Section -->
        <mat-card class="test-section">
          <mat-card-header>
            <mat-card-title>
              <mat-icon>notifications</mat-icon>
              General Notifications
            </mat-card-title>
            <mat-card-subtitle>Test basic notification types</mat-card-subtitle>
          </mat-card-header>
          
          <mat-card-content>
            <div class="button-grid">
              <button 
                mat-raised-button 
                color="primary"
                (click)="sendGeneralNotification()">
                <mat-icon>info</mat-icon>
                General
              </button>

              <button 
                mat-raised-button 
                class="success-button"
                (click)="sendSuccessNotification()">
                <mat-icon>check_circle</mat-icon>
                Success
              </button>

              <button 
                mat-raised-button 
                color="warn"
                (click)="sendErrorNotification()">
                <mat-icon>error</mat-icon>
                Error
              </button>

              <button 
                mat-raised-button 
                class="warning-button"
                (click)="sendWarningNotification()">
                <mat-icon>warning</mat-icon>
                Warning
              </button>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- Notifications with Actions Section -->
        <mat-card class="test-section">
          <mat-card-header>
            <mat-card-title>
              <mat-icon>touch_app</mat-icon>
              Interactive Notifications
            </mat-card-title>
            <mat-card-subtitle>Test notifications with action buttons</mat-card-subtitle>
          </mat-card-header>
          
          <mat-card-content>
            <div class="button-grid">
              <button 
                mat-raised-button 
                color="accent"
                (click)="sendNotificationWithAction()">
                <mat-icon>ads_click</mat-icon>
                With Action
              </button>

              <button 
                mat-raised-button 
                color="primary"
                (click)="sendConfirmationNotification()">
                <mat-icon>done_all</mat-icon>
                Confirmation
              </button>

              <button 
                mat-raised-button 
                (click)="sendMultipleNotifications()">
                <mat-icon>queue</mat-icon>
                Multiple (x5)
              </button>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- Relay Publishing Simulations Section -->
        <mat-card class="test-section relay-section">
          <mat-card-header>
            <mat-card-title>
              <mat-icon>cloud_upload</mat-icon>
              Relay Publishing Simulations
            </mat-card-title>
            <mat-card-subtitle>Test relay publishing notifications with various scenarios</mat-card-subtitle>
          </mat-card-header>
          
          <mat-card-content>
            <div class="relay-scenarios">
              <!-- All Success Scenario -->
              <div class="scenario-card">
                <div class="scenario-header">
                  <mat-icon class="success-icon">check_circle</mat-icon>
                  <h3>All Success</h3>
                </div>
                <p>Simulates successful publishing to 3 relays</p>
                <button 
                  mat-raised-button 
                  color="primary"
                  (click)="simulateAllSuccessPublishing()"
                  [disabled]="isPublishing()">
                  <mat-icon>rocket_launch</mat-icon>
                  Simulate
                </button>
              </div>

              <!-- Partial Success Scenario -->
              <div class="scenario-card">
                <div class="scenario-header">
                  <mat-icon class="warning-icon">warning</mat-icon>
                  <h3>Partial Success</h3>
                </div>
                <p>2 relays succeed, 2 relays fail</p>
                <button 
                  mat-raised-button 
                  color="accent"
                  (click)="simulatePartialSuccessPublishing()"
                  [disabled]="isPublishing()">
                  <mat-icon>shuffle</mat-icon>
                  Simulate
                </button>
              </div>

              <!-- All Failed Scenario -->
              <div class="scenario-card">
                <div class="scenario-header">
                  <mat-icon class="error-icon">error</mat-icon>
                  <h3>All Failed</h3>
                </div>
                <p>All 3 relays fail to publish</p>
                <button 
                  mat-raised-button 
                  color="warn"
                  (click)="simulateAllFailedPublishing()"
                  [disabled]="isPublishing()">
                  <mat-icon>cloud_off</mat-icon>
                  Simulate
                </button>
              </div>

              <!-- Slow Relays Scenario -->
              <div class="scenario-card">
                <div class="scenario-header">
                  <mat-icon class="info-icon">schedule</mat-icon>
                  <h3>Slow Relays</h3>
                </div>
                <p>Relays with varying response times</p>
                <button 
                  mat-raised-button 
                  (click)="simulateSlowRelaysPublishing()"
                  [disabled]="isPublishing()">
                  <mat-icon>hourglass_empty</mat-icon>
                  Simulate
                </button>
              </div>

              <!-- Realistic Mix Scenario -->
              <div class="scenario-card">
                <div class="scenario-header">
                  <mat-icon class="primary-icon">bolt</mat-icon>
                  <h3>Realistic Mix</h3>
                </div>
                <p>5 relays with mixed results & timing</p>
                <button 
                  mat-raised-button 
                  color="primary"
                  (click)="simulateRealisticPublishing()"
                  [disabled]="isPublishing()">
                  <mat-icon>psychology</mat-icon>
                  Simulate
                </button>
              </div>

              <!-- Stress Test Scenario -->
              <div class="scenario-card">
                <div class="scenario-header">
                  <mat-icon class="accent-icon">speed</mat-icon>
                  <h3>Stress Test</h3>
                </div>
                <p>10 relays to test performance</p>
                <button 
                  mat-raised-button 
                  color="accent"
                  (click)="simulateStressTestPublishing()"
                  [disabled]="isPublishing()">
                  <mat-icon>flash_on</mat-icon>
                  Simulate
                </button>
              </div>
            </div>

            @if (isPublishing()) {
              <div class="publishing-indicator">
                <mat-progress-bar mode="indeterminate" color="accent"></mat-progress-bar>
                <p>Publishing in progress...</p>
              </div>
            }
          </mat-card-content>
        </mat-card>

        <!-- Statistics Section -->
        <mat-card class="test-section stats-section">
          <mat-card-header>
            <mat-card-title>
              <mat-icon>analytics</mat-icon>
              Notification Statistics
            </mat-card-title>
          </mat-card-header>
          
          <mat-card-content>
            <div class="stats-grid">
              <div class="stat-item">
                <mat-icon>notifications</mat-icon>
                <div class="stat-content">
                  <span class="stat-label">Total</span>
                  <span class="stat-value">{{ totalCount() }}</span>
                </div>
              </div>

              <div class="stat-item">
                <mat-icon>markunread</mat-icon>
                <div class="stat-content">
                  <span class="stat-label">Unread</span>
                  <span class="stat-value">{{ unreadCount() }}</span>
                </div>
              </div>

              <div class="stat-item">
                <mat-icon>cloud_upload</mat-icon>
                <div class="stat-content">
                  <span class="stat-label">Publishing</span>
                  <span class="stat-value">{{ publishingCount() }}</span>
                </div>
              </div>

              <div class="stat-item">
                <mat-icon>schedule</mat-icon>
                <div class="stat-content">
                  <span class="stat-label">Pending</span>
                  <span class="stat-value">{{ pendingCount() }}</span>
                </div>
              </div>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- Notifications List Section -->
        <mat-card class="test-section notifications-list-section">
          <mat-card-header>
            <mat-card-title>
              <mat-icon>list</mat-icon>
              Active Notifications
            </mat-card-title>
            <mat-card-subtitle>View and manage all notifications</mat-card-subtitle>
          </mat-card-header>
          
          <mat-card-content>
            <app-notification-list />
          </mat-card-content>
        </mat-card>
      </div>
    </div>
  `,
  styles: [`
    .notification-test-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }

    .test-header {
      text-align: center;
      margin-bottom: 3rem;
      
      h1 {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        margin: 0 0 0.5rem 0;
        font-size: 2.5rem;
        
        mat-icon {
          font-size: 2.5rem;
          width: 2.5rem;
          height: 2.5rem;
        }
      }
      
      .subtitle {
        margin: 0;
        font-size: 1.125rem;
        opacity: 0.7;
      }
    }

    .test-content {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    .test-section {
      mat-card-header {
        mat-card-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1.5rem;
        }
      }

      mat-card-content {
        padding-top: 1rem;
      }
    }

    .button-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      
      button {
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }
    }

    .success-button {
      background-color: #4caf50 !important;
      color: white !important;
    }

    .warning-button {
      background-color: #ff9800 !important;
      color: white !important;
    }

    .relay-scenarios {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
      margin-bottom: 1rem;
    }

    .scenario-card {
      padding: 1.5rem;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.02);
      transition: all 0.3s ease;

      &:hover {
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        transform: translateY(-2px);
      }

      .scenario-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;

        mat-icon {
          font-size: 2rem;
          width: 2rem;
          height: 2rem;
        }

        h3 {
          margin: 0;
          font-size: 1.125rem;
        }
      }

      p {
        margin: 0 0 1rem 0;
        font-size: 0.875rem;
        opacity: 0.7;
        min-height: 2.5rem;
      }

      button {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }
    }

    .success-icon { color: #4caf50; }
    .warning-icon { color: #ff9800; }
    .error-icon { color: #f44336; }
    .info-icon { color: #2196f3; }
    .primary-icon { color: #673ab7; }
    .accent-icon { color: #ff4081; }

    .publishing-indicator {
      margin-top: 1.5rem;
      text-align: center;

      mat-progress-bar {
        margin-bottom: 0.5rem;
      }

      p {
        margin: 0;
        font-size: 0.875rem;
        opacity: 0.7;
      }
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1.5rem;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.02);
      
      mat-icon {
        font-size: 2rem;
        width: 2rem;
        height: 2rem;
        color: var(--mat-primary-color);
      }

      .stat-content {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;

        .stat-label {
          font-size: 0.875rem;
          opacity: 0.7;
        }

        .stat-value {
          font-size: 1.5rem;
          font-weight: 500;
        }
      }
    }

    .notifications-list-section {
      mat-card-content {
        padding-top: 0;
      }
    }

    @media (max-width: 768px) {
      .notification-test-container {
        padding: 1rem;
      }

      .test-header h1 {
        font-size: 1.75rem;
        
        mat-icon {
          font-size: 1.75rem;
          width: 1.75rem;
          height: 1.75rem;
        }
      }

      .relay-scenarios {
        grid-template-columns: 1fr;
      }

      .button-grid {
        grid-template-columns: 1fr;
      }

      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationTestComponent {
  private notificationService = inject(NotificationService);

  // Track if publishing is in progress
  private _isPublishing = signal(false);
  readonly isPublishing = this._isPublishing.asReadonly();

  // Computed statistics
  readonly notifications = this.notificationService.notifications;

  readonly totalCount = computed(() => this.notifications().length);

  readonly unreadCount = computed(() => 
    this.notifications().filter(n => !n.read).length
  );

  readonly publishingCount = computed(() => 
    this.notifications().filter(n => n.type === NotificationType.RELAY_PUBLISHING).length
  );

  readonly pendingCount = computed(() => {
    return this.notifications()
      .filter(n => n.type === NotificationType.RELAY_PUBLISHING)
      .reduce((count, n) => {
        const relayNotification = n as RelayPublishingNotification;
        const pending = relayNotification.relayPromises?.filter(rp => rp.status === 'pending').length || 0;
        return count + pending;
      }, 0);
  });

  constructor() {
    // Load notifications on init
    if (!this.notificationService.notificationsLoaded()) {
      this.notificationService.loadNotifications();
    }
  }

  // ========== General Notifications ==========

  sendGeneralNotification(): void {
    this.notificationService.notify(
      'General Notification',
      'This is a general notification for testing purposes. It contains basic information.',
      NotificationType.GENERAL
    );
  }

  sendSuccessNotification(): void {
    this.notificationService.notify(
      'Operation Successful',
      'Your operation has been completed successfully. All changes have been saved.',
      NotificationType.SUCCESS
    );
  }

  sendErrorNotification(): void {
    this.notificationService.notify(
      'Error Occurred',
      'An error occurred while processing your request. Please try again later.',
      NotificationType.ERROR
    );
  }

  sendWarningNotification(): void {
    this.notificationService.notify(
      'Warning',
      'Your storage is running low. Please clean up old data to free up space.',
      NotificationType.WARNING
    );
  }

  // ========== Interactive Notifications ==========

  sendNotificationWithAction(): void {
    this.notificationService.notify(
      'Action Required',
      'Click the button below to perform an action.',
      NotificationType.GENERAL,
      'Perform Action',
      () => {
        alert('Action button clicked! This demonstrates interactive notifications.');
        this.notificationService.notify(
          'Action Completed',
          'The action has been executed successfully.',
          NotificationType.SUCCESS
        );
      }
    );
  }

  sendConfirmationNotification(): void {
    this.notificationService.notify(
      'Please Confirm',
      'Do you want to proceed with this operation?',
      NotificationType.WARNING,
      'Confirm',
      () => {
        this.notificationService.notify(
          'Confirmed',
          'Your confirmation has been recorded.',
          NotificationType.SUCCESS
        );
      }
    );
  }

  sendMultipleNotifications(): void {
    const messages = [
      { title: 'First Notification', message: 'This is the first notification in the batch.' },
      { title: 'Second Notification', message: 'This is the second notification.' },
      { title: 'Third Notification', message: 'Testing multiple notifications at once.' },
      { title: 'Fourth Notification', message: 'Almost done with the batch.' },
      { title: 'Fifth Notification', message: 'Last notification in this batch!' },
    ];

    messages.forEach((msg, index) => {
      setTimeout(() => {
        this.notificationService.notify(
          msg.title,
          msg.message,
          NotificationType.GENERAL
        );
      }, index * 300); // Stagger by 300ms
    });
  }

  // ========== Relay Publishing Simulations ==========

  simulateAllSuccessPublishing(): void {
    const event = this.createMockEvent('All relays will succeed');
    const relayPromises = new Map<Promise<string>, string>();

    // 3 successful relays with different delays
    const relays = [
      'wss://relay.damus.io',
      'wss://relay.nostr.band',
      'wss://nos.lol'
    ];

    relays.forEach((relayUrl, index) => {
      const promise = new Promise<string>((resolve) => {
        setTimeout(() => resolve('success'), (index + 1) * 1000);
      });
      relayPromises.set(promise, relayUrl);
    });

    this._isPublishing.set(true);
    this.notificationService.addRelayPublishingNotification(event, relayPromises);

    // Reset publishing state after all complete
    setTimeout(() => this._isPublishing.set(false), 4000);
  }

  simulatePartialSuccessPublishing(): void {
    const event = this.createMockEvent('Partial success scenario');
    const relayPromises = new Map<Promise<string>, string>();

    // 2 successful relays
    const successfulRelays = ['wss://relay.damus.io', 'wss://nos.lol'];
    successfulRelays.forEach((relayUrl, index) => {
      const promise = new Promise<string>((resolve) => {
        setTimeout(() => resolve('success'), (index + 1) * 1500);
      });
      relayPromises.set(promise, relayUrl);
    });

    // 2 failed relays
    const failedRelays = ['wss://slow-relay.example.com', 'wss://broken-relay.example.com'];
    failedRelays.forEach((relayUrl, index) => {
      const promise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error(`Connection timeout for ${relayUrl}`)), (index + 1) * 2000);
      });
      relayPromises.set(promise, relayUrl);
    });

    this._isPublishing.set(true);
    this.notificationService.addRelayPublishingNotification(event, relayPromises);

    setTimeout(() => this._isPublishing.set(false), 5000);
  }

  simulateAllFailedPublishing(): void {
    const event = this.createMockEvent('All relays will fail');
    const relayPromises = new Map<Promise<string>, string>();

    const relays = [
      'wss://down-relay1.example.com',
      'wss://down-relay2.example.com',
      'wss://down-relay3.example.com'
    ];

    const errors = [
      'Connection refused',
      'Timeout after 5000ms',
      'Authentication failed'
    ];

    relays.forEach((relayUrl, index) => {
      const promise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error(errors[index])), (index + 1) * 1000);
      });
      relayPromises.set(promise, relayUrl);
    });

    this._isPublishing.set(true);
    this.notificationService.addRelayPublishingNotification(event, relayPromises);

    setTimeout(() => this._isPublishing.set(false), 4000);
  }

  simulateSlowRelaysPublishing(): void {
    const event = this.createMockEvent('Testing slow relay responses');
    const relayPromises = new Map<Promise<string>, string>();

    const scenarios = [
      { url: 'wss://fast-relay.example.com', delay: 500, success: true },
      { url: 'wss://medium-relay.example.com', delay: 3000, success: true },
      { url: 'wss://slow-relay.example.com', delay: 8000, success: true },
      { url: 'wss://very-slow-relay.example.com', delay: 12000, success: false },
    ];

    scenarios.forEach(scenario => {
      const promise = scenario.success
        ? new Promise<string>((resolve) => {
            setTimeout(() => resolve('success'), scenario.delay);
          })
        : new Promise<string>((_, reject) => {
            setTimeout(() => reject(new Error('Timeout - relay too slow')), scenario.delay);
          });
      
      relayPromises.set(promise, scenario.url);
    });

    this._isPublishing.set(true);
    this.notificationService.addRelayPublishingNotification(event, relayPromises);

    setTimeout(() => this._isPublishing.set(false), 13000);
  }

  simulateRealisticPublishing(): void {
    const event = this.createMockEvent('Realistic multi-relay publishing');
    const relayPromises = new Map<Promise<string>, string>();

    const scenarios = [
      { url: 'wss://relay.damus.io', delay: 800, success: true },
      { url: 'wss://relay.nostr.band', delay: 1200, success: true },
      { url: 'wss://nos.lol', delay: 1500, success: true },
      { url: 'wss://relay.snort.social', delay: 2500, success: false, error: 'Rate limited' },
      { url: 'wss://relay.current.fyi', delay: 3000, success: true },
    ];

    scenarios.forEach(scenario => {
      const promise = scenario.success
        ? new Promise<string>((resolve) => {
            setTimeout(() => resolve('success'), scenario.delay);
          })
        : new Promise<string>((_, reject) => {
            setTimeout(() => reject(new Error(scenario.error || 'Failed')), scenario.delay);
          });
      
      relayPromises.set(promise, scenario.url);
    });

    this._isPublishing.set(true);
    this.notificationService.addRelayPublishingNotification(event, relayPromises);

    setTimeout(() => this._isPublishing.set(false), 4000);
  }

  simulateStressTestPublishing(): void {
    const event = this.createMockEvent('Stress test with 10 relays');
    const relayPromises = new Map<Promise<string>, string>();

    // Create 10 relays with random success/failure and delays
    for (let i = 1; i <= 10; i++) {
      const url = `wss://relay${i}.example.com`;
      const delay = Math.random() * 4000 + 500; // 500ms to 4500ms
      const success = Math.random() > 0.3; // 70% success rate

      const promise = success
        ? new Promise<string>((resolve) => {
            setTimeout(() => resolve('success'), delay);
          })
        : new Promise<string>((_, reject) => {
            setTimeout(() => reject(new Error(`Relay ${i} failed`)), delay);
          });
      
      relayPromises.set(promise, url);
    }

    this._isPublishing.set(true);
    this.notificationService.addRelayPublishingNotification(event, relayPromises);

    setTimeout(() => this._isPublishing.set(false), 5500);
  }

  // ========== Helper Methods ==========

  /**
   * Create a mock Nostr event for testing
   */
  private createMockEvent(content: string): Event {
    const timestamp = Math.floor(Date.now() / 1000); // Nostr uses seconds
    
    return {
      id: this.generateRandomId(),
      pubkey: 'test-pubkey-' + Math.random().toString(36).substring(7),
      created_at: timestamp,
      kind: 1, // Text note
      tags: [
        ['t', 'test'],
        ['client', 'nostria-test']
      ],
      content,
      sig: 'test-signature-' + Math.random().toString(36).substring(7)
    };
  }

  /**
   * Generate a random event ID
   */
  private generateRandomId(): string {
    return Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
}
