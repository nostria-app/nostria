import { Component, inject, effect, ChangeDetectionStrategy } from '@angular/core';
import { NotificationService } from '../../services/notification.service';
import { 
  Notification, 
  NotificationType, 
  RelayPublishingNotification,
  GeneralNotification
} from '../../services/storage.service';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { DatePipe } from '@angular/common';

/**
 * Notification List Component
 * 
 * Displays all notifications with full details including:
 * - Notification type and status
 * - Relay publishing progress (for relay notifications)
 * - Action buttons for read/unread, retry, and delete
 * - Timestamps and detailed information
 */
@Component({
  selector: 'app-notification-list',
  imports: [
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatBadgeModule,
    MatTooltipModule,
    MatChipsModule,
    MatDividerModule,
    DatePipe
  ],
  template: `
    <div class="notification-list-container">
      <div class="notification-header">
        <h2>
          <mat-icon>notifications</mat-icon>
          Notifications
          @if (notifications().length > 0) {
            <span class="count-badge">{{ notifications().length }}</span>
          }
        </h2>
        <div class="header-actions">
          <button 
            mat-button
            (click)="markAllAsRead()"
            [disabled]="unreadNotifications().length === 0"
            matTooltip="Mark all as read">
            <mat-icon>done_all</mat-icon>
            Mark all read
          </button>
          <button 
            mat-button
            color="warn"
            (click)="clearAll()"
            [disabled]="notifications().length === 0"
            matTooltip="Clear all notifications">
            <mat-icon>delete_sweep</mat-icon>
            Clear all
          </button>
        </div>
      </div>

      @if (notifications().length === 0) {
        <div class="empty-state">
          <mat-icon>notifications_none</mat-icon>
          <h3>No Notifications</h3>
          <p>You don't have any notifications yet. When you do, they'll appear here.</p>
        </div>
      } @else {
        <mat-list class="notifications-list">
          @for (notification of notifications(); track notification.id) {
            <mat-list-item 
              [class.unread]="!notification.read"
              [class.relay-notification]="isRelayNotification(notification)">
              
              <!-- Icon -->
              <mat-icon matListItemIcon [class]="getNotificationIconClass(notification.type)">
                {{ getNotificationIcon(notification.type) }}
              </mat-icon>
              
              <!-- Content -->
              <div matListItemTitle class="notification-title">
                {{ notification.title }}
                @if (!notification.read) {
                  <mat-icon class="unread-indicator" matTooltip="Unread">fiber_manual_record</mat-icon>
                }
              </div>
              
              @if (notification.message) {
                <div matListItemLine class="notification-message">
                  {{ notification.message }}
                </div>
              }
              
              <!-- Relay Status (for relay notifications) -->
              @if (isRelayNotification(notification)) {
                <div matListItemLine class="relay-status">
                  <div class="relay-chips">
                    <mat-chip class="status-chip success-chip">
                      <mat-icon>check_circle</mat-icon>
                      {{ getSuccessCount(notification) }}
                    </mat-chip>
                    <mat-chip class="status-chip failed-chip">
                      <mat-icon>error</mat-icon>
                      {{ getFailedCount(notification) }}
                    </mat-chip>
                    <mat-chip class="status-chip pending-chip">
                      <mat-icon>schedule</mat-icon>
                      {{ getPendingCount(notification) }}
                    </mat-chip>
                  </div>
                  
                  @if (!notification.complete) {
                    <span class="publishing-label">
                      <mat-icon class="spinning">sync</mat-icon>
                      Publishing...
                    </span>
                  } @else if (getFailedCount(notification) === 0) {
                    <span class="complete-label success">
                      <mat-icon>check_circle</mat-icon>
                      All successful
                    </span>
                  } @else if (getSuccessCount(notification) === 0) {
                    <span class="complete-label error">
                      <mat-icon>error</mat-icon>
                      All failed
                    </span>
                  } @else {
                    <span class="complete-label warning">
                      <mat-icon>warning</mat-icon>
                      Partially successful
                    </span>
                  }
                </div>
              }

              <!-- Detailed relay list -->
              @if (isRelayNotification(notification) && hasRelayDetails(notification)) {
                <div matListItemLine class="relay-details">
                    <button 
                      mat-button 
                      class="toggle-details-btn"
                      (click)="toggleRelayDetails(notification.id)">
                      <mat-icon>{{ isDetailsExpanded(notification.id) ? 'expand_less' : 'expand_more' }}</mat-icon>
                      {{ isDetailsExpanded(notification.id) ? 'Hide' : 'Show' }} relay details
                    </button>
                    
                    @if (isDetailsExpanded(notification.id)) {
                      <div class="relay-list">
                        @for (relay of notification.relayPromises; track relay.relayUrl) {
                          <div class="relay-item" [class]="'status-' + relay.status">
                            <mat-icon class="relay-status-icon">
                              @if (relay.status === 'success') {
                                check_circle
                              } @else if (relay.status === 'failed') {
                                error
                              } @else {
                                schedule
                              }
                            </mat-icon>
                            <span class="relay-url">{{ relay.relayUrl }}</span>
                            @if (relay.error) {
                              <span class="relay-error" [matTooltip]="relay.error.message || relay.error">
                                <mat-icon>info</mat-icon>
                              </span>
                            }
                          </div>
                        }
                      </div>
                    }
                  </div>
              }

              <!-- Action button (for general notifications) -->
              @if (isGeneralNotification(notification) && hasAction(notification.id)) {
                <div matListItemLine class="action-container">
                  <button 
                    mat-stroked-button 
                    color="primary"
                    (click)="executeAction(notification)">
                    {{ getActionLabel(notification.id) }}
                  </button>
                </div>
              }
              
              <!-- Timestamp -->
              <div matListItemLine class="timestamp">
                <mat-icon>schedule</mat-icon>
                {{ notification.timestamp | date:'short' }}
              </div>

              <!-- Action buttons -->
              <div matListItemMeta class="actions">
                @if (!notification.read) {
                  <button 
                    mat-icon-button 
                    (click)="markAsRead(notification.id)"
                    matTooltip="Mark as read">
                    <mat-icon>done</mat-icon>
                  </button>
                }
                
                @if (isRelayNotification(notification) && hasFailedRelays(notification)) {
                  <button 
                    mat-icon-button 
                    color="warn"
                    (click)="retryFailed(notification)"
                    matTooltip="Retry failed relays"
                    disabled>
                    <mat-icon>refresh</mat-icon>
                  </button>
                }
                
                <button 
                  mat-icon-button 
                  (click)="remove(notification.id)"
                  matTooltip="Remove notification">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </mat-list-item>
            
            <mat-divider></mat-divider>
          }
        </mat-list>
      }
    </div>
  `,
  styles: [`
    .notification-list-container {
      width: 100%;
    }

    .notification-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding: 0 1rem;
      flex-wrap: wrap;
      gap: 1rem;

      h2 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0;
        font-size: 1.5rem;

        mat-icon {
          font-size: 1.5rem;
          width: 1.5rem;
          height: 1.5rem;
        }

        .count-badge {
          background: var(--mat-primary-color);
          color: white;
          padding: 0.125rem 0.5rem;
          border-radius: 12px;
          font-size: 0.875rem;
          font-weight: 500;
        }
      }

      .header-actions {
        display: flex;
        gap: 0.5rem;

        button {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }
      }
    }

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: rgba(0, 0, 0, 0.54);
      
      mat-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        margin-bottom: 1rem;
        opacity: 0.3;
      }

      h3 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
      }

      p {
        margin: 0;
        font-size: 1rem;
      }
    }

    .notifications-list {
      padding: 0;

      mat-list-item {
        min-height: 80px;
        padding: 1rem;
        transition: background-color 0.2s ease;

        &.unread {
          background-color: rgba(33, 150, 243, 0.08);
          border-left: 4px solid var(--mat-primary-color);
        }

        &:hover {
          background-color: rgba(0, 0, 0, 0.04);
        }

        &.relay-notification {
          min-height: 120px;
        }
      }
    }

    .notification-title {
      font-size: 1rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.5rem;

      .unread-indicator {
        font-size: 0.5rem;
        width: 0.5rem;
        height: 0.5rem;
        color: var(--mat-primary-color);
      }
    }

    .notification-message {
      font-size: 0.875rem;
      color: rgba(0, 0, 0, 0.7);
      margin-top: 0.25rem;
    }

    .relay-status {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-top: 0.5rem;
      flex-wrap: wrap;

      .relay-chips {
        display: flex;
        gap: 0.5rem;

        .status-chip {
          height: 24px;
          font-size: 0.75rem;
          
          mat-icon {
            font-size: 1rem;
            width: 1rem;
            height: 1rem;
            margin-right: 0.25rem;
          }
        }

        .success-chip {
          background-color: rgba(76, 175, 80, 0.1);
          color: #2e7d32;
        }

        .failed-chip {
          background-color: rgba(244, 67, 54, 0.1);
          color: #c62828;
        }

        .pending-chip {
          background-color: rgba(255, 152, 0, 0.1);
          color: #ef6c00;
        }
      }

      .publishing-label,
      .complete-label {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.75rem;
        font-weight: 500;

        mat-icon {
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
        }
      }

      .publishing-label {
        color: #1976d2;

        .spinning {
          animation: spin 1s linear infinite;
        }
      }

      .complete-label.success {
        color: #2e7d32;
      }

      .complete-label.error {
        color: #c62828;
      }

      .complete-label.warning {
        color: #ef6c00;
      }
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .relay-details {
      margin-top: 0.5rem;

      .toggle-details-btn {
        font-size: 0.75rem;
        height: 28px;
        line-height: 28px;
        padding: 0 0.5rem;
      }

      .relay-list {
        margin-top: 0.5rem;
        padding: 0.5rem;
        background: rgba(0, 0, 0, 0.02);
        border-radius: 4px;

        .relay-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.25rem 0;
          font-size: 0.75rem;

          .relay-status-icon {
            font-size: 1rem;
            width: 1rem;
            height: 1rem;
          }

          .relay-url {
            flex: 1;
            font-family: monospace;
          }

          .relay-error mat-icon {
            font-size: 0.875rem;
            width: 0.875rem;
            height: 0.875rem;
            cursor: help;
          }

          &.status-success .relay-status-icon {
            color: #2e7d32;
          }

          &.status-failed .relay-status-icon {
            color: #c62828;
          }

          &.status-pending .relay-status-icon {
            color: #ef6c00;
          }
        }
      }
    }

    .action-container {
      margin-top: 0.5rem;
    }

    .timestamp {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.75rem;
      color: rgba(0, 0, 0, 0.54);
      margin-top: 0.5rem;

      mat-icon {
        font-size: 0.875rem;
        width: 0.875rem;
        height: 0.875rem;
      }
    }

    .actions {
      display: flex;
      gap: 0.25rem;
      align-items: center;
    }

    // Notification type icon colors
    .icon-general { color: #1976d2; }
    .icon-success { color: #2e7d32; }
    .icon-error { color: #c62828; }
    .icon-warning { color: #ef6c00; }
    .icon-relay { color: #7b1fa2; }

    @media (max-width: 768px) {
      .notification-header {
        flex-direction: column;
        align-items: flex-start;

        .header-actions {
          width: 100%;
          justify-content: space-between;
        }
      }

      .relay-status {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationListComponent {
  private notificationService = inject(NotificationService);
  
  // Access notifications from service
  readonly notifications = this.notificationService.notifications;

  // Track which notification details are expanded
  private expandedDetails = new Set<string>();

  // Computed: unread notifications
  readonly unreadNotifications = () => this.notifications().filter(n => !n.read);

  constructor() {
    // Load notifications if not already loaded
    effect(() => {
      if (!this.notificationService.notificationsLoaded()) {
        this.notificationService.loadNotifications();
      }
    });
  }

  // ========== Type Guards ==========

  isRelayNotification(notification: Notification): notification is RelayPublishingNotification {
    return notification.type === NotificationType.RELAY_PUBLISHING;
  }

  isGeneralNotification(notification: Notification): notification is GeneralNotification {
    return notification.type === NotificationType.GENERAL;
  }

  // ========== Icon Helpers ==========

  getNotificationIcon(type: NotificationType): string {
    switch (type) {
      case NotificationType.SUCCESS:
        return 'check_circle';
      case NotificationType.ERROR:
        return 'error';
      case NotificationType.WARNING:
        return 'warning';
      case NotificationType.RELAY_PUBLISHING:
        return 'cloud_upload';
      default:
        return 'notifications';
    }
  }

  getNotificationIconClass(type: NotificationType): string {
    switch (type) {
      case NotificationType.SUCCESS:
        return 'icon-success';
      case NotificationType.ERROR:
        return 'icon-error';
      case NotificationType.WARNING:
        return 'icon-warning';
      case NotificationType.RELAY_PUBLISHING:
        return 'icon-relay';
      default:
        return 'icon-general';
    }
  }

  // ========== Relay Status Helpers ==========

  getSuccessCount(notification: RelayPublishingNotification): number {
    return notification.relayPromises?.filter(rp => rp.status === 'success').length || 0;
  }

  getFailedCount(notification: RelayPublishingNotification): number {
    return notification.relayPromises?.filter(rp => rp.status === 'failed').length || 0;
  }

  getPendingCount(notification: RelayPublishingNotification): number {
    return notification.relayPromises?.filter(rp => rp.status === 'pending').length || 0;
  }

  hasFailedRelays(notification: RelayPublishingNotification): boolean {
    return this.getFailedCount(notification) > 0;
  }

  hasRelayDetails(notification: RelayPublishingNotification): boolean {
    return !!notification.relayPromises && notification.relayPromises.length > 0;
  }

  // ========== Detail Expansion ==========

  isDetailsExpanded(notificationId: string): boolean {
    return this.expandedDetails.has(notificationId);
  }

  toggleRelayDetails(notificationId: string): void {
    if (this.expandedDetails.has(notificationId)) {
      this.expandedDetails.delete(notificationId);
    } else {
      this.expandedDetails.add(notificationId);
    }
  }

  // ========== Actions ==========

  markAsRead(id: string): void {
    this.notificationService.markAsRead(id);
  }

  markAllAsRead(): void {
    this.unreadNotifications().forEach(notification => {
      this.notificationService.markAsRead(notification.id);
    });
  }

  remove(id: string): void {
    this.notificationService.removeNotification(id);
    this.expandedDetails.delete(id);
  }

  clearAll(): void {
    if (confirm('Are you sure you want to clear all notifications? This action cannot be undone.')) {
      this.notificationService.clearNotifications();
      this.expandedDetails.clear();
    }
  }

  retryFailed(notification: RelayPublishingNotification): void {
    // This would need to be implemented with the actual retry logic
    // For now, we'll just log it
    console.log('Retry failed relays for notification:', notification.id);
    alert('Retry functionality would be implemented here. This requires the actual relay publishing service.');
  }

  executeAction(notification: GeneralNotification): void {
    // Use the service's executeAction method which handles in-memory callbacks
    this.notificationService.executeAction(notification.id);
    // Optionally mark as read after action
    this.markAsRead(notification.id);
  }

  /**
   * Check if notification has an action
   */
  hasAction(id: string): boolean {
    return this.notificationService.hasAction(id);
  }

  /**
   * Get action label for a notification
   */
  getActionLabel(id: string): string | undefined {
    return this.notificationService.getActionLabel(id);
  }
}
