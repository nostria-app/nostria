import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { animate, style, transition, trigger } from '@angular/animations';
import { Location } from '@angular/common';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProfileStateService } from '../../../services/profile-state.service';

@Component({
  selector: 'app-following',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './following.component.html',
  styleUrl: './following.component.scss',
  animations: [
    trigger('slideInOut', [
      transition(':enter', [
        style({ transform: 'translateY(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateY(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('300ms ease-in', style({ transform: 'translateY(100%)', opacity: 0 }))
      ])
    ]),
    trigger('profileShrink', [
      transition(':enter', [
        style({ transform: 'scale(1.3)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'scale(1)', opacity: 1 }))
      ])
    ])
  ]
})
export class FollowingComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  profileState = inject(ProfileStateService);
  
  isLoading = signal(true);
  error = signal<string | null>(null);
  followingList = signal<any[]>([]);
  
  npub = computed(() => this.route.snapshot.parent?.paramMap.get('npub') || '');
  userProfile = signal<any>(null);
  
  constructor() {
    effect(async () => {
      const list = this.profileState.followingList();
      debugger;
      this.loadFollowingList(list);
    });

    // effect(() => {
    //   if (this.npub()) {
    //     this.loadFollowingList();
    //   }
    // });
    
    // // Load user profile data
    // this.loadUserProfile();
  }
  
  async loadUserProfile(): Promise<void> {
    try {
      // In a real implementation, get this from a service or parent component
      // For now, using mock data
      setTimeout(() => {
        this.userProfile.set({
          name: 'Example User',
          picture: 'https://example.com/avatar.jpg'
        });
      }, 300);
    } catch (err) {
      this.error.set('Failed to load profile');
    }
  }
  
  async loadFollowingList(pubkeys: string[]): Promise<void> {
    try {
      this.isLoading.set(true);
      
      // Mock data - replace with actual implementation
      setTimeout(() => {
        const mockFollowing = Array(20).fill(null).map((_, index) => ({
          id: `user${index}`,
          npub: `npub${index}123456789abcdef`,
          name: `User ${index}`,
          picture: index % 3 === 0 ? null : `https://i.pravatar.cc/150?u=${index}`
        }));
        
        this.followingList.set(mockFollowing);
        this.isLoading.set(false);
      }, 1000);
    } catch (err) {
      this.error.set('Failed to load following list');
      this.isLoading.set(false);
    }
  }
  
  goBack(): void {
    this.location.back();
  }
  
  navigateToProfile(npub: string): void {
    this.router.navigate(['../../', npub], { relativeTo: this.route });
  }
}
