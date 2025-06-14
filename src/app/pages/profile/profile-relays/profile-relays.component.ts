import { Component, inject, signal, computed, effect, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { animate, style, transition, trigger } from '@angular/animations';
import { Location } from '@angular/common';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { ProfileStateService } from '../../../services/profile-state.service';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
  selector: 'app-following',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    ScrollingModule
],
  templateUrl: './profile-relays.component.html',
  styleUrl: './profile-relays.component.scss',
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
export class ProfileRelaysComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);
  
  @ViewChild('followingContainer') followingContainerRef!: ElementRef;

  isLoading = signal(true);
  error = signal<string | null>(null);
  selectedTabIndex = signal(0);
  
  npub = computed(() => this.route.snapshot.parent?.paramMap.get('npub') || '');
  userProfile = signal<any>(null);
  
  // Item size for virtual scrolling (approx. height of each item in pixels)
  readonly itemSize = 72;
  
  // Buffer size determines how many items to render outside viewport
  readonly minBufferPx = 200;
  readonly maxBufferPx = 400;
  
  constructor() {

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
  
  onTabChanged(tabIndex: number): void {
    this.selectedTabIndex.set(tabIndex);
    // this.scrollToTop();
  }
  
  goBack(): void {
    this.location.back();
  }
}
