import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, Router } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LoadingOverlayComponent } from '../../../components/loading-overlay/loading-overlay.component';
import { NostrEvent } from '../../../interfaces';

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
    LoadingOverlayComponent
  ],
  templateUrl: './profile-connections.component.html',
  styleUrl: './profile-connections.component.scss'
})
export class ProfileConnectionsComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);

  activeTabIndex = signal(0);
  isLoading = signal(true);
  error = signal<string | null>(null);
  
  following = signal<Connection[]>([]);
  followers = signal<Connection[]>([]);
  mutuals = signal<Connection[]>([]);
  
  constructor() {
    effect(() => {
      const pubkey = this.getPubkey();
      
      if (pubkey) {
        this.loadConnections(pubkey);
      }
    });
  }
  
  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }
  
  async loadConnections(pubkey: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    
    try {
      // Mock data for now - in a real implementation, you would fetch the actual connections
      // using the NostrService
      
      // Simulating a delay for loading
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Mock data
      const mockFollowing: Connection[] = Array.from({ length: 8 }, (_, i) => ({
        pubkey: `pubkey${i + 1}`,
        npub: `npub${i + 1}...`,
        name: `User ${i + 1}`,
        picture: i % 2 === 0 ? `https://i.pravatar.cc/150?img=${i + 10}` : undefined,
        mutual: i < 3
      }));
      
      const mockFollowers: Connection[] = Array.from({ length: 6 }, (_, i) => ({
        pubkey: `pubkey${i + 5}`,
        npub: `npub${i + 5}...`,
        name: `Follower ${i + 1}`,
        picture: i % 3 === 0 ? `https://i.pravatar.cc/150?img=${i + 20}` : undefined,
        mutual: i < 3
      }));
      
      // Calculate mutuals (those who are both followers and following)
      const mutualConnections = mockFollowing
        .filter(f => f.mutual)
        .map(conn => ({
          ...conn,
          mutual: true
        }));
      
      this.following.set(mockFollowing);
      this.followers.set(mockFollowers);
      this.mutuals.set(mutualConnections);
      
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
}
