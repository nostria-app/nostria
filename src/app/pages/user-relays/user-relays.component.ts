import { Component, inject, signal, effect, untracked, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { UtilitiesService } from '../../services/utilities.service';
import { DataService } from '../../services/data.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { RelaysService, Nip11RelayInfo } from '../../services/relays/relays';
import { NostrRecord } from '../../interfaces';

/**
 * Standalone component for viewing a user's relay list.
 * Used in the right panel when opened from profile header.
 * Does not depend on PROFILE_STATE - loads its own data.
 */
@Component({
  selector: 'app-user-relays',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './user-relays.component.html',
  styleUrl: './user-relays.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserRelaysComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  private utilities = inject(UtilitiesService);
  private dataService = inject(DataService);
  private panelNav = inject(PanelNavigationService);
  private relaysService = inject(RelaysService);

  isLoading = signal(true);
  error = signal<string | null>(null);

  // The pubkey we're viewing
  viewingPubkey = signal<string>('');
  viewingProfile = signal<NostrRecord | undefined>(undefined);

  // Relay list
  relayList = signal<string[]>([]);

  // Track expanded relays for details view
  expandedRelays = signal<Set<string>>(new Set());

  // Track NIP-11 relay information
  nip11Info = signal<Map<string, Nip11RelayInfo | null>>(new Map());
  nip11Loading = signal<Set<string>>(new Set());

  private hasInitialRelays = signal(false);

  constructor() {
    // Get pubkey from route params
    let pubkeyParam = this.route.snapshot.paramMap.get('pubkey');
    if (pubkeyParam) {
      // Convert npub to hex if needed
      pubkeyParam = this.utilities.safeGetHexPubkey(pubkeyParam) || pubkeyParam;
      this.viewingPubkey.set(pubkeyParam);
    }

    const historyState = typeof window !== 'undefined' ? history.state : null;
    const navState = (this.router.getCurrentNavigation()?.extras.state ?? historyState) as {
      relayList?: unknown;
    } | null;
    const preloadedRelayList = Array.isArray(navState?.relayList)
      ? navState.relayList.filter((relay): relay is string => typeof relay === 'string' && relay.trim() !== '')
      : [];

    if (preloadedRelayList.length > 0) {
      this.relayList.set(Array.from(new Set(preloadedRelayList)));
      this.hasInitialRelays.set(true);
      this.isLoading.set(false);
    }

    // Load data when pubkey is available
    effect(() => {
      const pubkey = this.viewingPubkey();
      if (pubkey) {
        untracked(() => this.loadData(pubkey));
      }
    });
  }

  private async loadData(pubkey: string): Promise<void> {
    try {
      if (!this.hasInitialRelays()) {
        this.isLoading.set(true);
      }
      this.error.set(null);

      // Load profile data
      const profile = await this.dataService.getProfile(pubkey);
      this.viewingProfile.set(profile);

      // Load relay list (kind 10002)
      const relayListEvent = await this.dataService.getRelayListEvent(pubkey);
      let relays: string[] = [];

      if (relayListEvent) {
        relays = this.utilities.getRelayUrls(relayListEvent);
      }

      // Fallback for users without usable kind 10002 relay list:
      // parse relay map from kind 3 contacts event content.
      if (relays.length === 0) {
        const contactsEvent = await this.dataService.getContactsEvent(pubkey);
        if (contactsEvent) {
          relays = this.utilities.getRelayUrlsFromFollowing(contactsEvent);
        }
      }

      this.relayList.set(Array.from(new Set(relays)));

      this.isLoading.set(false);
    } catch (err) {
      if (!this.hasInitialRelays()) {
        this.error.set('Failed to load relay list');
      }
      this.isLoading.set(false);
      this.logger.error('Error loading relay data', err);
    }
  }

  getProfileDisplayName(): string {
    const profile = this.viewingProfile();
    if (!profile) return 'User';

    if (profile.data?.display_name) return profile.data.display_name;
    if (profile.data?.name) return profile.data.name;
    if (profile.data?.nip05) return this.utilities.parseNip05(profile.data.nip05) || 'User';
    return 'User';
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
      event.preventDefault();
      this.toggleRelayDetails(url);
    }
  }

  private async fetchNip11InfoForRelay(url: string): Promise<void> {
    const loading = this.nip11Loading();
    const newLoading = new Set(loading);
    newLoading.add(url);
    this.nip11Loading.set(newLoading);

    try {
      const info = await this.relaysService.fetchNip11Info(url);

      const currentInfo = this.nip11Info();
      const newInfo = new Map(currentInfo);
      newInfo.set(url, info);
      this.nip11Info.set(newInfo);
    } catch (error) {
      this.logger.error(`Error fetching NIP-11 info for ${url}:`, error);
      const currentInfo = this.nip11Info();
      const newInfo = new Map(currentInfo);
      newInfo.set(url, null);
      this.nip11Info.set(newInfo);
    } finally {
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
    return url.replace(/^wss:\/\//, '');
  }

  getRelayDisplayName(url: string): string {
    const info = this.getNip11Info(url);
    if (info?.name) {
      return info.name;
    }

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      let name = hostname
        .replace(/^relay\./, '')
        .replace(/^nostr\./, '')
        .replace(/^ws\./, '');

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
    const isInRightPanel = this.route.outlet === 'right';

    if (isInRightPanel) {
      this.panelNav.goBackRight();
      return;
    }

    this.location.back();
  }

  copyRelayUrl(event: Event, url: string): void {
    event.stopPropagation();
    this.layout.copyToClipboard(url, 'relay URL');
  }
}
