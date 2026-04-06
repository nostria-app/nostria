import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { Event as NostrEvent, nip19 } from 'nostr-tools';
import { CommunityService, Community, COMMUNITY_DEFINITION_KIND } from '../../../services/community.service';
import { ApplicationService } from '../../../services/application.service';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { FollowingService } from '../../../services/following.service';
import { MediaService } from '../../../services/media.service';
import { LoggerService } from '../../../services/logger.service';
import { NostrRecord } from '../../../interfaces';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { NPubPipe } from '../../../pipes/npub.pipe';

@Component({
  selector: 'app-create-community',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatChipsModule,
    MatDividerModule,
    MatTooltipModule,
    FormsModule,
    RouterLink,
    UserProfileComponent,
    NPubPipe,
  ],
  templateUrl: './create-community.component.html',
  styleUrls: ['./create-community.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateCommunityComponent implements OnInit {
  private communityService = inject(CommunityService);
  private app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private followingService = inject(FollowingService);
  private mediaService = inject(MediaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private snackBar = inject(MatSnackBar);
  private readonly logger = inject(LoggerService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Form fields
  name = signal('');
  description = signal('');
  image = signal('');
  avatar = signal('');
  rules = signal('');
  isPublishing = signal(false);

  // Edit mode
  isEditMode = signal(false);
  private editDTag = '';

  // Image upload
  isUploadingImage = signal(false);
  isUploadingAvatar = signal(false);
  hasMediaServers = computed(() => this.mediaService.mediaServers().length > 0);

  // Moderators: list of pubkeys (hex) with optional profile data
  moderatorPubkeys = signal<string[]>([]);

  // Moderator search
  moderatorSearchInput = signal('');
  private initialFollowingList: NostrRecord[] = [];

  isNpubInput = computed(() => {
    const input = this.moderatorSearchInput().trim();
    return input.startsWith('npub1');
  });

  isHexInput = computed(() => {
    const input = this.moderatorSearchInput().trim();
    return /^[0-9a-f]{64}$/i.test(input);
  });

  hasValidNpub = computed(() => {
    const input = this.moderatorSearchInput().trim();
    if (!input || !this.isNpubInput()) return false;
    try {
      const decoded = nip19.decode(input);
      return decoded.type === 'npub';
    } catch {
      return false;
    }
  });

  moderatorSearchResults = computed(() => {
    const input = this.moderatorSearchInput().trim().toLowerCase();

    // If input is an npub or hex pubkey, don't show search results
    if (this.isNpubInput() || this.isHexInput()) {
      return [];
    }

    let results: NostrRecord[];
    if (!input) {
      results = this.initialFollowingList;
    } else {
      const followingResults = this.followingService.searchProfiles(input);
      results = this.followingService.toNostrRecords(followingResults);
    }

    // Exclude already-selected moderators
    const selectedPubkeys = new Set(this.moderatorPubkeys());
    // Also exclude current user (they're auto-added)
    const currentPubkey = this.accountState.pubkey();
    if (currentPubkey) {
      selectedPubkeys.add(currentPubkey);
    }
    results = results.filter(r => !selectedPubkeys.has(r.event.pubkey));

    return results.slice(0, 30);
  });

  showModeratorSearch = signal(false);

  // Relays: pre-populated from account relays
  relayUrls = signal<string[]>([]);
  newRelayUrl = signal('');

  constructor() {
    this.followingService.activate();

    // Load initial following list
    this.loadInitialFollowingList();
  }

  ngOnInit(): void {
    // Pre-populate relays from account relay settings
    const accountRelays = this.accountRelay.getRelayUrls();
    if (accountRelays.length > 0) {
      this.relayUrls.set([...accountRelays]);
    }

    // Check for edit mode via route data or router state
    const naddrParam = this.route.snapshot.paramMap.get('naddr');
    if (naddrParam) {
      this.loadCommunityForEdit(naddrParam);
    }
  }

  private loadInitialFollowingList(): void {
    const allProfiles = this.followingService.searchProfiles('');
    this.initialFollowingList = this.followingService.toNostrRecords(allProfiles).slice(0, 50);
  }

  private async loadCommunityForEdit(naddrStr: string): Promise<void> {
    try {
      const decoded = nip19.decode(naddrStr);
      if (decoded.type !== 'naddr') {
        this.snackBar.open('Invalid community address', 'Close', { duration: 3000 });
        return;
      }

      const { pubkey, identifier, relays } = decoded.data;

      // Verify current user is the owner
      const currentPubkey = this.accountState.pubkey();
      if (currentPubkey !== pubkey) {
        this.snackBar.open('You can only edit communities you created', 'Close', { duration: 3000 });
        this.router.navigate(['/n']);
        return;
      }

      // Check router state first for pre-loaded event
      const navigation = this.router.getCurrentNavigation();
      let stateEvent = navigation?.extras?.state?.['communityEvent'] as NostrEvent | undefined;
      if (!stateEvent && this.isBrowser) {
        stateEvent = history.state?.communityEvent as NostrEvent | undefined;
      }

      let community: Community | null = null;

      if (stateEvent && stateEvent.pubkey === pubkey && stateEvent.kind === COMMUNITY_DEFINITION_KIND) {
        const dTag = stateEvent.tags.find((t: string[]) => t[0] === 'd')?.[1] || '';
        if (dTag === identifier) {
          community = this.communityService.parseCommunity(stateEvent);
        }
      }

      if (!community) {
        // Fetch from relays
        community = await this.communityService.fetchCommunity(pubkey, identifier, relays);
      }

      if (!community) {
        this.snackBar.open('Community not found', 'Close', { duration: 3000 });
        this.router.navigate(['/n']);
        return;
      }

      // Populate form with existing data
      this.isEditMode.set(true);
      this.editDTag = community.id;
      this.name.set(community.name);
      this.description.set(community.description || '');
      this.image.set(community.image || '');
      this.avatar.set(community.avatar || '');
      this.rules.set(community.rules || '');

      // Set moderators (exclude creator - they're auto-added)
      const mods = community.moderators
        .map(m => m.pubkey)
        .filter(p => p !== currentPubkey);
      this.moderatorPubkeys.set(mods);

      // Set relays
      if (community.relays.length > 0) {
        this.relayUrls.set(community.relays.map(r => r.url));
      }
    } catch (error) {
      this.logger.error('[CreateCommunity] Error loading community for edit:', error);
      this.snackBar.open('Error loading community', 'Close', { duration: 3000 });
    }
  }

  // -- Moderator search methods --

  toggleModeratorSearch(): void {
    this.showModeratorSearch.update(v => !v);
    if (this.showModeratorSearch()) {
      this.moderatorSearchInput.set('');
    }
  }

  selectModerator(profile: NostrRecord): void {
    const pubkey = profile.event.pubkey;
    if (!this.moderatorPubkeys().includes(pubkey)) {
      this.moderatorPubkeys.update(list => [...list, pubkey]);
    }
    this.moderatorSearchInput.set('');
  }

  addModeratorFromNpub(): void {
    const input = this.moderatorSearchInput().trim();
    let pubkey: string;

    if (this.isNpubInput() && this.hasValidNpub()) {
      const decoded = nip19.decode(input);
      pubkey = decoded.data as string;
    } else if (this.isHexInput()) {
      pubkey = input;
    } else {
      return;
    }

    const currentPubkey = this.accountState.pubkey();
    if (pubkey === currentPubkey) {
      this.snackBar.open('You are already added as moderator automatically', 'Close', { duration: 3000 });
      this.moderatorSearchInput.set('');
      return;
    }

    if (this.moderatorPubkeys().includes(pubkey)) {
      this.snackBar.open('Moderator already added', 'Close', { duration: 3000 });
      this.moderatorSearchInput.set('');
      return;
    }

    this.moderatorPubkeys.update(list => [...list, pubkey]);
    this.moderatorSearchInput.set('');
  }

  removeModerator(pubkey: string): void {
    this.moderatorPubkeys.update(list => list.filter(p => p !== pubkey));
  }

  // -- Image upload methods --

  async onImageFileSelected(evt: globalThis.Event): Promise<void> {
    const input = evt.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
      this.snackBar.open('Please select a valid image file', 'Close', { duration: 3000 });
      return;
    }

    this.isUploadingImage.set(true);
    try {
      const result = await this.mediaService.uploadFile(file, false, []);
      if (result.status === 'success' || result.status === 'duplicate') {
        if (result.item?.url) {
          this.image.set(result.item.url);
          this.snackBar.open('Image uploaded', 'Close', { duration: 3000 });
        }
      } else {
        this.snackBar.open(result.message || 'Failed to upload image', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('[CreateCommunity] Error uploading image:', error);
      this.snackBar.open('Error uploading image', 'Close', { duration: 3000 });
    } finally {
      this.isUploadingImage.set(false);
      // Reset input so the same file can be re-selected
      input.value = '';
    }
  }

  removeImage(): void {
    this.image.set('');
  }

  async onAvatarFileSelected(evt: globalThis.Event): Promise<void> {
    const input = evt.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
      this.snackBar.open('Please select a valid image file', 'Close', { duration: 3000 });
      return;
    }

    this.isUploadingAvatar.set(true);
    try {
      const result = await this.mediaService.uploadFile(file, false, []);
      if (result.status === 'success' || result.status === 'duplicate') {
        if (result.item?.url) {
          this.avatar.set(result.item.url);
          this.snackBar.open('Avatar uploaded', 'Close', { duration: 3000 });
        }
      } else {
        this.snackBar.open(result.message || 'Failed to upload avatar', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('[CreateCommunity] Error uploading avatar:', error);
      this.snackBar.open('Error uploading avatar', 'Close', { duration: 3000 });
    } finally {
      this.isUploadingAvatar.set(false);
      input.value = '';
    }
  }

  removeAvatar(): void {
    this.avatar.set('');
  }

  // -- Relay methods --

  addRelay(): void {
    const url = this.newRelayUrl().trim();
    if (!url) return;

    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      this.snackBar.open('Relay URL must start with wss:// or ws://', 'Close', { duration: 3000 });
      return;
    }

    if (this.relayUrls().includes(url)) {
      this.snackBar.open('Relay already added', 'Close', { duration: 3000 });
      return;
    }

    this.relayUrls.update(list => [...list, url]);
    this.newRelayUrl.set('');
  }

  removeRelay(url: string): void {
    this.relayUrls.update(list => list.filter(r => r !== url));
  }

  // -- Publish --

  async createCommunity(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.snackBar.open('Community name is required', 'Close', { duration: 3000 });
      return;
    }

    // Use existing d-tag in edit mode, generate new one otherwise
    let dTag: string;
    if (this.isEditMode()) {
      dTag = this.editDTag;
    } else {
      dTag = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 64);
    }

    if (!dTag) {
      this.snackBar.open('Invalid community name', 'Close', { duration: 3000 });
      return;
    }

    this.isPublishing.set(true);

    try {
      // Build moderators list - add current user as moderator by default
      const currentPubkey = this.accountState.pubkey();
      const moderators: { pubkey: string; relay?: string }[] = [];

      if (currentPubkey) {
        moderators.push({ pubkey: currentPubkey });
      }

      for (const pubkey of this.moderatorPubkeys()) {
        if (pubkey !== currentPubkey) {
          moderators.push({ pubkey });
        }
      }

      // Build relays list
      const relays: { url: string }[] = this.relayUrls().map(url => ({ url }));

      const result = await this.communityService.publishCommunity({
        dTag,
        name,
        description: this.description().trim() || undefined,
        image: this.image().trim() || undefined,
        avatar: this.avatar().trim() || undefined,
        rules: this.rules().trim() || undefined,
        moderators: moderators.length > 0 ? moderators : undefined,
        relays: relays.length > 0 ? relays : undefined,
      });

      if (result.success && result.event) {
        this.snackBar.open(this.isEditMode() ? 'Community updated!' : 'Community created!', 'Close', { duration: 3000 });
        // Navigate using naddr encoding
        const naddr = nip19.naddrEncode({
          kind: COMMUNITY_DEFINITION_KIND,
          pubkey: result.event.pubkey,
          identifier: dTag,
        });
        this.router.navigate(['/n', naddr], {
          state: { communityEvent: result.event },
        });
      } else {
        this.snackBar.open(result.error || 'Failed to save community', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('[CreateCommunity] Error saving community:', error);
      this.snackBar.open('Error saving community', 'Close', { duration: 3000 });
    } finally {
      this.isPublishing.set(false);
    }
  }
}
