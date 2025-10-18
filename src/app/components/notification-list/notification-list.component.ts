import { Component, inject, effect, ChangeDetectionStrategy } from '@angular/core';
import { NotificationService } from '../../services/notification.service';
import { 
  Notification, 
  NotificationType, 
  RelayPublishingNotification,
  GeneralNotification
} from '../../services/storage.service';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatRippleModule } from '@angular/material/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-notification-list',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatBadgeModule,
    MatTooltipModule,
    MatChipsModule,
    MatDividerModule,
    MatRippleModule,
    MatProgressBarModule,
    DatePipe
  ],
  template: `
    <div class="container">
      <!-- Header -->
      <mat-card class="header-card">
        <mat-card-content>
          <div class="header-content">
            <div class="header-info">
              <div class="title-section">
                <mat-icon class="header-icon">notifications</mat-icon>
                <h1 class="header-title">Notifications</h1>
                @if (unreadNotifications().length > 0) {
                  <mat-chip color="accent" highlighted class="unread-badge">
                    {{ unreadNotifications().length }} new
                  </mat-chip>
                }
              </div>
              <p class="header-subtitle">Stay updated with your latest activities</p>
            </div>
            <div class="header-actions">
              @if (unreadNotifications().length > 0) {
                <button mat-raised-button color="primary" (click)="markAllAsRead()" class="action-button">
                  <mat-icon>done_all</mat-icon>
                  Mark All Read
                </button>
              }
              @if (notifications().length > 0) {
                <button mat-stroked-button color="warn" (click)="clearAll()" class="action-button">
                  <mat-icon>close</mat-icon>
                  Clear All
                </button>
              }
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Empty State -->
      @if (notifications().length === 0) {
        <mat-card class="empty-state">
          <mat-card-content>
            <div class="empty-content">
              <mat-icon>notifications_none</mat-icon>
              <h2>No notifications yet</h2>
              <p>You'll see your notifications here when they arrive.</p>
            </div>
          </mat-card-content>
        </mat-card>
      } @else {
        <!-- Notifications List -->
        @for (notification of notifications(); track notification.id) {
          <mat-card class="notification-card">
            <mat-card-content>
              <div class="notification-header">
                <div class="notification-info">
                  <mat-icon [color]="getIconColor(notification.type)" class="notification-icon">
                    {{ getNotificationIcon(notification.type) }}
                  </mat-icon>
                  <div class="notification-details">
                    <h3 class="notification-title">
                      {{ notification.title }}
                      @if (!notification.read) {
                        <mat-chip color="accent" class="new-chip">NEW</mat-chip>
                      }
                    </h3>
                    <div class="notification-time">
                      <mat-icon>access_time</mat-icon>
                      {{ notification.timestamp | date:'short' }}
                    </div>
                  </div>
                </div>
                <div class="notification-actions">
                  @if (!notification.read) {
                    <button 
                      mat-icon-button 
                      (click)="markAsRead(notification.id)"
                      matTooltip="Mark as read">
                      <mat-icon>check</mat-icon>
                    </button>
                  }
                  <button 
                    mat-icon-button 
                    (click)="remove(notification.id)"
                    matTooltip="Delete">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              </div>

              <!-- Notification Message -->
                @if (notification.message) {
                  <p class="notification-message">{{ notification.message }}</p>
                }

                <!-- Relay Publishing Status -->
                @if (isRelayNotification(notification)) {
                  <div class="relay-status-section">
                    <!-- Progress Bar -->
                    @if (!notification.complete) {
                      <mat-progress-bar 
                        mode="indeterminate" 
                        class="relay-progress">
                      </mat-progress-bar>
                      <div class="status-label publishing">
                        <mat-icon class="spinning">sync</mat-icon>
                        <span>Publishing to relays...</span>
                      </div>
                    }
                    
                    <!-- Status Summary -->
                    <mat-chip-set>
                      <mat-chip highlighted>
                        <mat-icon>check_circle</mat-icon>
                        {{ getSuccessCount(notification) }} Success
                      </mat-chip>
                      @if (getFailedCount(notification) > 0) {
                        <mat-chip color="warn" highlighted>
                          <mat-icon>error</mat-icon>
                          {{ getFailedCount(notification) }} Failed
                        </mat-chip>
                      }
                      @if (getPendingCount(notification) > 0) {
                        <mat-chip color="accent" highlighted>
                          <mat-icon>schedule</mat-icon>
                          {{ getPendingCount(notification) }} Pending
                        </mat-chip>
                      }
                    </mat-chip-set>

                    <!-- Completion Status -->
                    @if (notification.complete) {
                      @if (getFailedCount(notification) === 0) {
                        <mat-chip color="primary" highlighted>
                          <mat-icon>check_circle</mat-icon>
                          Successfully published to all relays
                        </mat-chip>
                      } @else if (getSuccessCount(notification) === 0) {
                        <mat-chip color="warn" highlighted>
                          <mat-icon>error</mat-icon>
                          Failed to publish to all relays
                        </mat-chip>
                      } @else {
                        <mat-chip color="accent" highlighted>
                          <mat-icon>warning</mat-icon>
                          Partially published
                        </mat-chip>
                      }
                    }

                    <!-- Relay Details Toggle -->
                    @if (hasRelayDetails(notification)) {
                      <button 
                        mat-button 
                        class="details-toggle"
                        (click)="toggleRelayDetails(notification.id)">
                        <mat-icon>{{ isDetailsExpanded(notification.id) ? 'expand_less' : 'expand_more' }}</mat-icon>
                        {{ isDetailsExpanded(notification.id) ? 'Hide' : 'Show' }} relay details
                      </button>

                      @if (isDetailsExpanded(notification.id)) {
                        <div class="relay-details">
                          @for (relay of notification.relayPromises; track relay.relayUrl) {
                            <mat-card>
                              <mat-card-content>
                                <div class="relay-info">
                                  <mat-icon [color]="relay.status === 'success' ? 'primary' : relay.status === 'failed' ? 'warn' : 'accent'">
                                    {{ relay.status === 'success' ? 'check_circle' : 
                                       relay.status === 'failed' ? 'error' : 'schedule' }}
                                  </mat-icon>
                                  <span>{{ relay.relayUrl }}</span>
                                  @if (relay.error) {
                                    <mat-icon 
                                      color="warn"
                                      [matTooltip]="relay.error.message || relay.error">
                                      info
                                    </mat-icon>
                                  }
                                </div>
                              </mat-card-content>
                            </mat-card>
                          }
                        </div>

                        @if (hasFailedRelays(notification)) {
                          <button 
                            mat-stroked-button 
                            color="warn"
                            class="retry-btn"
                            (click)="retryFailed(notification)"
                            disabled>
                            <mat-icon>refresh</mat-icon>
                            Retry Failed Relays
                          </button>
                        }
                      }
                    }
                  </div>
                }

                <!-- Action Button (for general notifications) -->
                @if (isGeneralNotification(notification) && hasAction(notification.id)) {
                  <div class="action-section">
                    <button 
                      mat-flat-button 
                      color="primary"
                      class="notification-action-btn"
                      (click)="executeAction(notification)">
                      <mat-icon>touch_app</mat-icon>
                      {{ getActionLabel(notification.id) }}
                    </button>
                  </div>
                }
            </mat-card-content>
          </mat-card>
        }
      }
    </div>
  `,
  styles: [`
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    
    /* Header Styles */
    .header-card {
      width: 100%;
      box-sizing: border-box;
    }
    
    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      width: 100%;
      gap: 24px;
    }
    
    .header-info {
      flex: 1;
      min-width: 0;
    }
    
    .title-section {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    
    .header-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: #2196f3;
    }
    
    .header-title {
      margin: 0;
      font-size: 28px;
      font-weight: 500;
    }
    
    .unread-badge {
      font-size: 12px !important;
      height: 28px !important;
    }
    
    .header-subtitle {
      margin: 0;
      font-size: 16px;
      opacity: 0.7;
      line-height: 1.4;
    }
    
    .header-actions {
      display: flex;
      gap: 12px;
      flex-shrink: 0;
      align-items: flex-start;
    }
    
    .action-button {
      min-width: 120px;
      height: 40px;
      font-weight: 500;
    }
    
    .action-button mat-icon {
      margin-right: 8px;
    }
    
    .notification-card {
      width: 100%;
      box-sizing: border-box;
    }
    
    .notification-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
      width: 100%;
    }
    
    .notification-info {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      flex: 1;
      min-width: 0;
    }
    
    .notification-icon {
      flex-shrink: 0;
      font-size: 32px;
      width: 32px;
      height: 32px;
    }
    
    .notification-details {
      flex: 1;
      min-width: 0;
    }
    
    .notification-title {
      margin: 0 0 8px 0;
      font-size: 18px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    
    .new-chip {
      font-size: 12px !important;
      height: 24px !important;
    }
    
    .notification-time {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      opacity: 0.7;
    }
    
    .notification-time mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    
    .notification-actions {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    }
    
    .empty-state {
      width: 100%;
      box-sizing: border-box;
    }
    
    .empty-content {
      text-align: center;
      padding: 64px 24px;
      width: 100%;
      box-sizing: border-box;
    }
    
    .empty-content mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: #9c27b0;
      margin: 0 auto 24px auto;
      display: block;
    }
    
    .empty-content h2 {
      margin: 0 0 16px 0;
      font-size: 24px;
      font-weight: 500;
    }
    
    .empty-content p {
      margin: 0;
      font-size: 16px;
      opacity: 0.7;
      line-height: 1.5;
      max-width: 400px;
      margin: 0 auto;
    }
    
    .relay-details {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 16px;
    }
    
    .relay-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    /* Responsive Design */
    @media (max-width: 768px) {
      .container {
        padding: 12px;
      }
      
      .header-content {
        flex-direction: column;
        gap: 16px;
        align-items: stretch;
      }
      
      .header-actions {
        align-self: stretch;
        justify-content: stretch;
      }
      
      .action-button {
        flex: 1;
        min-width: auto;
      }
      
      .header-title {
        font-size: 24px;
      }
      
      .header-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }
      
      .notification-header {
        flex-direction: column;
        gap: 12px;
      }
      
      .notification-actions {
        align-self: flex-end;
      }
      
      .notification-title {
        font-size: 16px;
      }
      
      .notification-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }
    }
    
    @media (max-width: 480px) {
      .container {
        padding: 8px;
      }
      
      .header-actions {
        flex-direction: column;
        gap: 8px;
      }
      
      .header-title {
        font-size: 20px;
      }
      
      .title-section {
        gap: 8px;
      }
      
      .notification-info {
        gap: 12px;
      }
      
      .notification-title {
        font-size: 15px;
      }
      
      .empty-content {
        padding: 48px 16px;
      }
      
      .empty-content mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
      }
      
      .empty-content h2 {
        font-size: 20px;
      }
      
      .empty-content p {
        font-size: 14px;
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

  /**
   * Get Material Design color for icons based on notification type
   */
  getIconColor(type: NotificationType): 'primary' | 'accent' | 'warn' {
    switch (type) {
      case NotificationType.SUCCESS:
        return 'primary';
      case NotificationType.ERROR:
        return 'warn';
      case NotificationType.WARNING:
        return 'accent';
      case NotificationType.RELAY_PUBLISHING:
        return 'accent';
      default:
        return 'primary';
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
