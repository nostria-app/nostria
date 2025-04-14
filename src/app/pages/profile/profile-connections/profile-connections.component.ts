import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LoadingOverlayComponent } from '../../../components/loading-overlay/loading-overlay.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NostrEvent } from '../../../interfaces';
import { ProfileStateService } from '../../../services/profile-state.service';

interface Connection {
  pubkey: string;
  npub: string;
  name?: string;
  picture?: string;
  about?: string;
  mutual?: boolean;
}

@Component({
  selector: 'app-profile-connections',
  standalone: true,
  imports: [
    CommonModule,
    MatTabsModule,
    MatIconModule,
    MatListModule,
    MatButtonModule,
    MatCardModule,
    MatTooltipModule,
    LoadingOverlayComponent
  ],
  templateUrl: './profile-connections.component.html',
  styleUrl: './profile-connections.component.scss'
})
export class ProfileConnectionsComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);

  activeTabIndex = signal(0);
  isLoading = signal(true);
  error = signal<string | null>(null);
  
  following = signal<Connection[]>([]);
  followers = signal<Connection[]>([]);
  mutuals = signal<Connection[]>([]);
  
  constructor() {
    effect(async () => {
      const list = this.profileState.followingList();
      this.loadConnections(list);
    });
  }
  
  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }
  
  async loadConnections(following: string[]): Promise<void> {
    this.isLoading.set(false);
    this.error.set(null);
    
    try {
      // Simulating a delay for loading
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Create mock connections from the following list
      const mockFollowing: Connection[] = following.map((pubkey, index) => {
        // Create a shortened npub representation
        const npub = `npub${pubkey.substring(0, 6)}...`;
        
        return {
          pubkey,
          npub,
          name: `User ${pubkey.substring(0, 4)}`,
          picture: index % 3 === 0 ? `https://i.pravatar.cc/150?img=${(index * 3) % 70}` : undefined,
          // Randomly mark some connections as mutual (30% chance)
          mutual: Math.random() < 0.3
        };
      });
      
      // For demo purposes, create followers as a mix of following and new users
      const followersCount = Math.max(5, Math.floor(following.length * 0.8));
      const mockFollowers: Connection[] = Array.from({ length: followersCount }, (_, i) => {
        // 40% of followers are from the following list (to create mutual connections)
        if (i < followersCount * 0.4 && i < following.length) {
          const followingUser = mockFollowing[i];
          return {
            ...followingUser,
            mutual: true // Mark as mutual since they're both following and followers
          };
        } else {
          // Create new follower that's not in the following list
          const uniquePubkey = `follower${i}${Math.random().toString(36).substring(2, 6)}`;
          return {
            pubkey: uniquePubkey,
            npub: `npub${uniquePubkey.substring(0, 6)}...`,
            name: `Follower ${uniquePubkey.substring(0, 4)}`,
            picture: i % 5 === 0 ? `https://i.pravatar.cc/150?img=${(i * 7) % 70 + 10}` : undefined,
            mutual: false
          };
        }
      });
      
      // Find users who are both following and followers (mutuals)
      const followingPubkeys = new Set(mockFollowing.map(f => f.pubkey));
      const followerPubkeys = new Set(mockFollowers.map(f => f.pubkey));
      
      // Update the mutual flag for following users
      mockFollowing.forEach(user => {
        if (followerPubkeys.has(user.pubkey)) {
          user.mutual = true;
        }
      });
      
      // Update the mutual flag for follower users
      mockFollowers.forEach(user => {
        if (followingPubkeys.has(user.pubkey)) {
          user.mutual = true;
        }
      });
      
      // Calculate mutual connections (those who are both followers and following)
      const mutualConnections = mockFollowing
        .filter(f => f.mutual)
        .map(conn => ({
          ...conn,
          mutual: true
        }));
      
      this.following.set(mockFollowing);
      this.followers.set(mockFollowers);
      this.mutuals.set(mutualConnections);
      
      this.logger.debug('Connections loaded:', { 
        following: mockFollowing.length, 
        followers: mockFollowers.length, 
        mutuals: mutualConnections.length 
      });
      
    } catch (err) {
      this.logger.error('Error loading connections:', err);
      this.error.set('Failed to load connections');
    } finally {
      this.isLoading.set(false);
    }
  }
  
  navigateToProfile(pubkey: string): void {
    this.router.navigate(['/p', pubkey]);
  }
  
  onTabChange(index: number): void {
    this.activeTabIndex.set(index);
  }
  
  followUser(pubkey: string, event: Event): void {
    event.stopPropagation();
    this.logger.debug('Follow requested for:', pubkey);
    // TODO: Implement actual follow functionality
  }
  
  unfollowUser(pubkey: string, event: Event): void {
    event.stopPropagation();
    this.logger.debug('Unfollow requested for:', pubkey);
    // TODO: Implement actual unfollow functionality
  }

  // Navigate back to the previous page
  goBack(): void {
    // Use router to navigate back to parent route (profile posts)
    const pubkey = this.getPubkey();
    if (pubkey) {
      this.router.navigate(['/p', pubkey, 'posts']);
    } else {
      // Fallback to browser history
      this.location.back();
    }
  }

  // Updated to fix the *ngIf to @if in the template
  // This fixes the issue in the template with the followUser button
  shouldShowFollowButton(connection: Connection): boolean {
    return !connection.mutual;
  }
}
