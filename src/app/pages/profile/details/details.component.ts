import {
  Component,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
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
import { ApplicationService } from '../../../services/application.service';
import { StorageService } from '../../../services/storage.service';
import { AccountRelayServiceEx } from '../../../services/relays/account-relay';
import { DiscoveryRelayServiceEx } from '../../../services/relays/discovery-relay';

@Component({
  selector: 'app-following',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    ScrollingModule,
  ],
  templateUrl: './details.component.html',
  styleUrl: './details.component.scss',
  animations: [
    trigger('slideInOut', [
      transition(':enter', [
        style({ transform: 'translateY(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateY(0)', opacity: 1 })),
      ]),
      transition(':leave', [
        animate('300ms ease-in', style({ transform: 'translateY(100%)', opacity: 0 })),
      ]),
    ]),
    trigger('profileShrink', [
      transition(':enter', [
        style({ transform: 'scale(1.3)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'scale(1)', opacity: 1 })),
      ]),
    ]),
  ],
})
export class DetailsComponent implements OnInit, AfterViewInit {
  private router = inject(Router);
  private accountRelay = inject(AccountRelayServiceEx);
  private discoveryRelay = inject(DiscoveryRelayServiceEx);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);
  app = inject(ApplicationService);
  storage = inject(StorageService);

  @ViewChild('followingContainer') followingContainerRef!: ElementRef;

  isLoading = signal(true);
  error = signal<string | null>(null);
  followingList = signal<any[]>([]);
  mutualConnectionsList = signal<any[]>([]);
  selectedTabIndex = signal(0);
  npub = computed(() => this.route.snapshot.parent?.paramMap.get('id') || '');
  userProfile = signal<any>(null);

  // Item size for virtual scrolling (approx. height of each item in pixels)
  readonly itemSize = 72;

  // Buffer size determines how many items to render outside viewport
  readonly minBufferPx = 200;
  readonly maxBufferPx = 400;

  info = signal<any>(null);

  constructor() {
    // effect(async () => {
    //   const list = this.profileState.followingList();
    //   if (list && list.length > 0) {
    //     await this.loadFollowingList(list);
    //   }
    // });

    effect(async () => {
      if (this.app.authenticated()) {
        // TODO: make sure that the "npub" is hex.
        const info = await this.storage.getInfo(this.npub(), 'user');
        this.info.set(info);
      }
    });
  }

  ngOnInit(): void {
    // Call loadMutualConnections to populate mutual connections list
    this.loadMutualConnections();
  }

  ngAfterViewInit(): void {
    // Ensure component is scrolled into view after view initialization
    // setTimeout(() => this.scrollToTop(), 350);
  }

  async broadcastProfile() {
    const event = await this.storage.getEventByPubkeyAndKind(this.npub(), 0);

    if (event) {
      console.log('Broadcasting metadata event:', event);
      // console.log('Relay URLs:', this.profileState.relay?.relayUrls);
      // await this.relay.publish(event, this.profileState.relay?.relayUrls);
      await this.accountRelay.publish(event);
    }
  }

  async broadcastRelayList() {
    const event = await this.storage.getEventByPubkeyAndKind(this.npub(), 10002);

    if (event) {
      console.log('Broadcasting Relay List event:', event);
      console.log('Relay URLs:', this.discoveryRelay.getRelayUrls());
      await this.discoveryRelay.publish(event);
    }
  }

  /**
   * Scroll the component into view
   */
  // scrollToTop(): void {
  //   this.layoutService.scrollToElement('.following-header');
  //   this.logger.debug('Scrolled following container into view');
  // }

  async loadUserProfile(): Promise<void> {
    try {
      setTimeout(() => {
        this.userProfile.set({
          name: 'Example User',
          picture: 'https://example.com/avatar.jpg',
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
        return;
      }

      const followingProfiles = pubkeys.map((pubkey, index) => ({
        id: pubkey,
        npub: pubkey,
        name: `User ${index + 1}`,
        picture: null,
      }));

      this.followingList.set(followingProfiles);
      this.isLoading.set(false);
    } catch (err) {
      this.error.set('Failed to load following list');
      this.isLoading.set(false);
      this.logger.error('Error loading following list', err);
    }
  }

  async loadMutualConnections(): Promise<void> {
    try {
      // In a real app, fetch mutual connections from an API
      // For demo purposes, we'll create mock data
      setTimeout(() => {
        const mockMutuals = Array(3)
          .fill(0)
          .map((_, index) => ({
            id: `mutual-${index}`,
            npub: `mutual-npub-${index}`,
            name: `Mutual User ${index + 1}`,
            picture: null,
          }));

        this.mutualConnectionsList.set(mockMutuals);
      }, 500);
    } catch (err) {
      this.logger.error('Error loading mutual connections', err);
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
