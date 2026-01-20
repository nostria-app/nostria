import { Component, inject, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { animate, style, transition, trigger } from '@angular/animations';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { ProfileStateService } from '../../../services/profile-state.service';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';
import { RelaysService, Nip11RelayInfo } from '../../../services/relays/relays';

@Component({
  selector: 'app-following',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatCardModule,
    MatDividerModule,
    MatTooltipModule,
    ScrollingModule,
  ],
  templateUrl: './profile-relays.component.html',
  styleUrl: './profile-relays.component.scss',
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
export class ProfileRelaysComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);
  private relaysService = inject(RelaysService);

  @ViewChild('followingContainer') followingContainerRef!: ElementRef;

  isLoading = signal(true);
  error = signal<string | null>(null);
  selectedTabIndex = signal(0);

  npub = computed(() => this.route.snapshot.parent?.paramMap.get('npub') || '');
  userProfile = signal<{ name?: string; picture?: string } | null>(null);

  // Track expanded relays for details view
  expandedRelays = signal<Set<string>>(new Set());

  // Track NIP-11 relay information
  nip11Info = signal<Map<string, Nip11RelayInfo | null>>(new Map());
  nip11Loading = signal<Set<string>>(new Set());

  // Item size for virtual scrolling (approx. height of each item in pixels)
  readonly itemSize = 72;

  // Buffer size determines how many items to render outside viewport
  readonly minBufferPx = 200;
  readonly maxBufferPx = 400;

  async loadUserProfile(): Promise<void> {
    try {
      setTimeout(() => {
        this.userProfile.set({
          name: 'Example User',
          picture: 'https://example.com/avatar.jpg',
        });
      }, 300);
    } catch {
      this.error.set('Failed to load profile');
    }
  }

  onTabChanged(tabIndex: number): void {
    this.selectedTabIndex.set(tabIndex);
    // this.scrollToTop();
  }

  /**
   * Get user relays using the profileState signal.
   * This provides instant display from cache, with smart updates when relay data is newer.
   */
  getUserRelays(): string[] {
    // Use the profileState.relayList() signal which is pre-loaded from cache
    // and smartly updated from relays only when newer data is available
    return this.profileState.relayList();
  }

  toggleRelayDetails(url: string): void {
    const expanded = this.expandedRelays();
    const newExpanded = new Set(expanded);

    if (newExpanded.has(url)) {
      newExpanded.delete(url);
    } else {
      newExpanded.add(url);
      // Fetch NIP-11 info when expanding if not already fetched
      if (!this.nip11Info().has(url) && !this.nip11Loading().has(url)) {
        this.fetchNip11InfoForRelay(url);
      }
    }

    this.expandedRelays.set(newExpanded);
  }

  onKeyDown(event: KeyboardEvent, url: string): void {
    if (event.key === ' ') {
      event.preventDefault(); // Prevent default space bar scrolling
      this.toggleRelayDetails(url);
    }
  }

  private async fetchNip11InfoForRelay(url: string): Promise<void> {
    // Mark as loading
    const loading = this.nip11Loading();
    const newLoading = new Set(loading);
    newLoading.add(url);
    this.nip11Loading.set(newLoading);

    try {
      const info = await this.relaysService.fetchNip11Info(url);

      // Store the result (even if null)
      const currentInfo = this.nip11Info();
      const newInfo = new Map(currentInfo);
      newInfo.set(url, info);
      this.nip11Info.set(newInfo);
    } catch (error) {
      this.logger.error(`Error fetching NIP-11 info for ${url}:`, error);
      // Store null to indicate fetch was attempted but failed
      const currentInfo = this.nip11Info();
      const newInfo = new Map(currentInfo);
      newInfo.set(url, null);
      this.nip11Info.set(newInfo);
    } finally {
      // Remove from loading set
      const loading = this.nip11Loading();
      const newLoading = new Set(loading);
      newLoading.delete(url);
      this.nip11Loading.set(newLoading);
    }
  }

  isRelayExpanded(url: string): boolean {
    return this.expandedRelays().has(url);
  }

  getNip11Info(url: string): Nip11RelayInfo | null | undefined {
    return this.nip11Info().get(url);
  }

  isNip11Loading(url: string): boolean {
    return this.nip11Loading().has(url);
  }

  formatRelayUrl(url: string): string {
    // Remove wss:// prefix for better UX
    return url.replace(/^wss:\/\//, '');
  }

  getRelayDisplayName(url: string): string {
    // Try to get NIP-11 name first
    const info = this.getNip11Info(url);
    if (info?.name) {
      return info.name;
    }

    // Extract a display name from the relay URL
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Remove common prefixes and format nicely
      let name = hostname
        .replace(/^relay\./, '')
        .replace(/^nostr\./, '')
        .replace(/^ws\./, '');

      // Capitalize first letter of each word
      name = name
        .split('.')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('.');

      return name;
    } catch {
      return 'Unknown Relay';
    }
  }

  goBack(): void {
    this.location.back();
  }

  copyRelayUrl(event: Event, url: string): void {
    event.stopPropagation(); // Prevent toggling relay details
    this.layout.copyToClipboard(url, 'relay URL');
  }
}
