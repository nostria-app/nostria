import { Component, inject, signal, computed, effect, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { animate, style, transition, trigger } from '@angular/animations';
import { Location } from '@angular/common';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProfileStateService } from '../../../services/profile-state.service';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';

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
export class FollowingComponent implements OnInit, AfterViewInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private layoutService = inject(LayoutService);
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);
  
  @ViewChild('followingContainer') followingContainerRef!: ElementRef;

  isLoading = signal(true);
  error = signal<string | null>(null);
  followingList = signal<any[]>([]);
  
  npub = computed(() => this.route.snapshot.parent?.paramMap.get('npub') || '');
  userProfile = signal<any>(null);
  
  constructor() {
    effect(async () => {
      const list = this.profileState.followingList();
      if (list && list.length > 0) {
        await this.loadFollowingList(list);
        this.scrollToTop();
      }
    });
  }

  ngOnInit(): void {
    // setTimeout(() => this.scrollToTop(), 100);
  }

  ngAfterViewInit(): void {
    // setTimeout(() => this.scrollToTop(), 300);
  }
  
  /**
   * Scroll the component into view
   */
  scrollToTop(): void {
    // if (this.followingContainerRef) {
    //   this.followingContainerRef.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    //   this.logger.debug('Scrolled following component into view using ElementRef');
    //   return;
    // }
    
    // const container = document.querySelector('.following-container');
    // if (container) {
    //   container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    //   this.logger.debug('Scrolled following container into view using querySelector');
    //   return;
    // }
    debugger;
    this.layoutService.scrollToElement('.following-container');
    this.logger.debug('Attempted to scroll following container into view using layoutService');
  }
  
  async loadUserProfile(): Promise<void> {
    try {
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
      
      if (!pubkeys || pubkeys.length === 0) {
        this.followingList.set([]);
        this.isLoading.set(false);
        // setTimeout(() => this.scrollToTop(), 100);
        return;
      }
      
      const followingProfiles = pubkeys.map((pubkey, index) => ({
        id: pubkey,
        npub: pubkey,
        name: `User ${index + 1}`,
        picture: null
      }));
      
      this.followingList.set(followingProfiles);
      this.isLoading.set(false);
      
      // setTimeout(() => this.scrollToTop(), 100);
    } catch (err) {
      this.error.set('Failed to load following list');
      this.isLoading.set(false);
      this.logger.error('Error loading following list', err);
    }
  }
  
  goBack(): void {
    this.location.back();
  }
  
  navigateToProfile(npub: string): void {
    this.router.navigate(['../../', npub], { relativeTo: this.route });
    setTimeout(() => {
      this.layoutService.scrollToOptimalPosition();
    }, 300);
  }
}
