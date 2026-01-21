import {
  Component,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  ViewChild,
  ElementRef,
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
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';
import { ApplicationService } from '../../../services/application.service';
import { DatabaseService } from '../../../services/database.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DiscoveryRelayService } from '../../../services/relays/discovery-relay';
import { Metrics } from '../../../services/metrics';
import { UserMetric } from '../../../interfaces/metrics';
import { kinds } from 'nostr-tools';

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
export class DetailsComponent implements OnInit {
  private router = inject(Router);
  private accountRelay = inject(AccountRelayService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  profileState = inject(PROFILE_STATE);
  app = inject(ApplicationService);
  database = inject(DatabaseService);
  private metricsService = inject(Metrics);

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
  metrics = signal<UserMetric | null>(null);

  infoAsJson = computed(() => {
    const infoData = this.info();
    if (!infoData) return '';
    return JSON.stringify(infoData, null, 2);
  });

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
        const info = await this.database.getInfo(this.npub(), 'user');
        this.info.set(info);

        // Load metrics for this user
        const userMetrics = await this.metricsService.getUserMetric(this.npub());
        this.metrics.set(userMetrics);
      }
    });
  }

  ngOnInit(): void {
    // Call loadMutualConnections to populate mutual connections list
    this.loadMutualConnections();
  }

  async broadcastProfile() {
    const event = await this.database.getEventByPubkeyAndKind(this.npub(), 0);

    if (event) {
      console.log('Broadcasting metadata event:', event);
      // console.log('Relay URLs:', this.profileState.relay?.relayUrls);
      // await this.relay.publish(event, this.profileState.relay?.relayUrls);
      await this.accountRelay.publish(event);
    }
  }

  async broadcastRelayList() {
    const event = await this.database.getEventByPubkeyAndKind(this.npub(), kinds.RelayList);

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
      this.logger.error('Error loading mutual connections', err as Error);
    }
  }

  onTabChanged(tabIndex: number): void {
    this.selectedTabIndex.set(tabIndex);
    // this.scrollToTop();
  }

  goBack(): void {
    this.location.back();
  }

  formatTimestamp(timestamp: number): string {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  }
}
