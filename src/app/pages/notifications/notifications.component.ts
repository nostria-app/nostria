import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { LayoutService } from '../../services/layout.service';
import { NotificationType, Notification } from './notification.interface';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatBadgeModule,
    MatMenuModule,
    MatDividerModule,
    ScrollingModule,
    UserProfileComponent
  ],
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss']
})
export class NotificationsComponent implements OnInit {
  private router = inject(Router);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  layout = inject(LayoutService);

  notifications = signal<Notification[]>([]);
  isLoading = signal(true);
  error = signal<string | null>(null);
  activeTabIndex = signal(0);
  
  // Notification counts by type
  mentionCount = computed(() => this.getCountByType('mention'));
  reactionCount = computed(() => this.getCountByType('reaction'));
  repostCount = computed(() => this.getCountByType('repost'));
  followCount = computed(() => this.getCountByType('follow'));
  
  // Virtual scrolling configuration
  readonly itemSize = 100;
  readonly minBufferPx = 200;
  readonly maxBufferPx = 400;

  constructor() {}

  ngOnInit(): void {
    this.fetchNotifications();
  }

  /**
   * Fetch notifications from the Nostr network
   */
  async fetchNotifications(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    
    try {
      // For demo purposes, we'll generate mock notifications
      // In a real implementation, we'd fetch events from Nostr relays
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const mockNotifications = this.generateMockNotifications();
      this.notifications.set(mockNotifications);
      
      this.logger.info('Loaded notifications:', { count: mockNotifications.length });
    } catch (error) {
      this.logger.error('Failed to load notifications', error);
      this.error.set('Failed to load notifications. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Handle tab change event
   */
  onTabChange(index: number): void {
    this.activeTabIndex.set(index);
  }

  /**
   * Navigate to the note detail page for a specific notification
   */
  viewNote(noteId: string): void {
    this.router.navigate(['/n', noteId]);
  }

  /**
   * Navigate to user profile for a specific notification
   */
  viewProfile(pubkey: string): void {
    this.layout.navigateToProfile(pubkey);
  }

  /**
   * Mark a notification as read
   */
  markAsRead(id: string): void {
    this.notifications.update(notifications => 
      notifications.map(notification => 
        notification.id === id 
          ? { ...notification, read: true } 
          : notification
      )
    );
  }

  /**
   * Mark all notifications as read
   */
  markAllAsRead(): void {
    this.notifications.update(notifications => 
      notifications.map(notification => ({ ...notification, read: true }))
    );
  }
  
  /**
   * Filter notifications by type based on active tab
   */
  filteredNotifications = computed(() => {
    const index = this.activeTabIndex();
    const notifs = this.notifications();
    
    if (index === 0) return notifs; // All notifications
    if (index === 1) return notifs.filter(n => n.type === 'mention');
    if (index === 2) return notifs.filter(n => n.type === 'reaction');
    if (index === 3) return notifs.filter(n => n.type === 'repost');
    if (index === 4) return notifs.filter(n => n.type === 'follow');
    
    return notifs;
  });

  /**
   * Get the count of unread notifications by type
   */
  getCountByType(type: NotificationType): number {
    return this.notifications().filter(n => n.type === type).length;
  }

  /**
   * Get the timestamp displayed in a human-readable format
   */
  getTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diffSeconds = Math.floor((now - timestamp) / 1000);
    
    if (diffSeconds < 60) return `${diffSeconds}s`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h`;
    
    return `${Math.floor(diffSeconds / 86400)}d`;
  }
  
  /**
   * Generate mock notifications for demo purposes
   */
  private generateMockNotifications(): Notification[] {
    const mockNotifications: Notification[] = [];
    const now = Date.now();
    
    // // Mock mentions
    // for (let i = 1; i <= 5; i++) {
    //   mockNotifications.push({
    //     id: `mention-${i}`,
    //     type: 'mention',
    //     sender: `user${i}`,
    //     senderPubkey: `pubkey${i}`,
    //     content: `This is a mention notification test #${i}. @you what do you think about this?`,
    //     noteId: `note${i}`,
    //     timestamp: now - (i * 3600000), // hours ago
    //     read: i > 2 // Some read, some unread
    //   });
    // }
    
    // // Mock reactions
    // for (let i = 1; i <= 7; i++) {
    //   mockNotifications.push({
    //     id: `reaction-${i}`,
    //     type: 'reaction',
    //     sender: `fan${i}`,
    //     senderPubkey: `pubkey${i + 10}`,
    //     content: i % 3 === 0 ? '❤️' : (i % 2 === 0 ? '👍' : '🔥'),
    //     noteId: `note${i % 3 + 5}`,
    //     timestamp: now - (i * 1500000), // Mix of times
    //     read: i > 4
    //   });
    // }
    
    // // Mock reposts
    // for (let i = 1; i <= 3; i++) {
    //   mockNotifications.push({
    //     id: `repost-${i}`,
    //     type: 'repost',
    //     sender: `reposter${i}`,
    //     senderPubkey: `pubkey${i + 20}`,
    //     content: `Your note has been reposted by @reposter${i}`,
    //     noteId: `note${i + 2}`,
    //     timestamp: now - (i * 7200000), // hours ago
    //     read: false
    //   });
    // }
    
    // // Mock follows
    // for (let i = 1; i <= 4; i++) {
    //   mockNotifications.push({
    //     id: `follow-${i}`,
    //     type: 'follow',
    //     sender: `follower${i}`,
    //     senderPubkey: `pubkey${i + 30}`,
    //     content: null,
    //     timestamp: now - (i * 86400000), // days ago
    //     read: i > 2
    //   });
    // }
    
    // Sort by timestamp (newest first)
    return mockNotifications.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get icon for a notification based on its type
   */
  getNotificationIcon(type: NotificationType): string {
    switch (type) {
      case 'mention': return 'alternate_email';
      case 'reaction': return 'favorite';
      case 'repost': return 'repeat';
      case 'follow': return 'person_add';
      default: return 'notifications';
    }
  }
}
