import { Component, inject, signal, computed, input, output, ChangeDetectionStrategy, effect } from '@angular/core';
import { Router } from '@angular/router';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog } from '@angular/material/dialog';
import { FormBuilder, Validators, ReactiveFormsModule, FormControl } from '@angular/forms';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { MatChipInputEvent } from '@angular/material/chips';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { FeedConfig } from '../../../services/feed.service';
import { FeedService } from '../../../services/feed.service';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { AccountStateService } from '../../../services/account-state.service';
import { Followset, StarterPack } from '../../../services/followset';
import { NostrRecord } from '../../../interfaces';
import { DataService } from '../../../services/data.service';
import { EncryptionService } from '../../../services/encryption.service';
import { LoggerService } from '../../../services/logger.service';
import { FollowingService } from '../../../services/following.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { MultiSelectDialogComponent, SelectableItem } from '../../../components/multi-select-dialog/multi-select-dialog.component';
import { CollectionSetsService } from '../../../services/collection-sets.service';

export interface FollowSet {
  id: string;
  dTag: string;
  title: string;
  description?: string;
  pubkeys: string[];
  created: number;
}

const NOSTR_KINDS = [
  { value: 0, label: 'Metadata (0)' },
  { value: 1, label: 'Text Note (1)' },
  { value: 2, label: 'Recommend Relay (2)' },
  { value: 3, label: 'Contacts (3)' },
  { value: 4, label: 'Encrypted Direct Messages (4)' },
  { value: 5, label: 'Event Deletion (5)' },
  { value: 6, label: 'Repost (6)' },
  { value: 7, label: 'Reaction (7)' },
  { value: 8, label: 'Badge Award (8)' },
  { value: 16, label: 'Generic Repost (16)' },
  { value: 20, label: 'Picture (20)' },
  { value: 21, label: 'Video Event (21)' },
  { value: 40, label: 'Channel Creation (40)' },
  { value: 41, label: 'Channel Metadata (41)' },
  { value: 42, label: 'Channel Message (42)' },
  { value: 43, label: 'Channel Hide Message (43)' },
  { value: 44, label: 'Channel Mute User (44)' },
  { value: 1063, label: 'File Metadata (1063)' },
  { value: 1068, label: 'Poll (1068)' },
  { value: 1222, label: 'Voice Message (1222)' },
  { value: 1311, label: 'Live Chat Message (1311)' },
  { value: 1984, label: 'Reporting (1984)' },
  { value: 9734, label: 'Zap Request (9734)' },
  { value: 9735, label: 'Zap (9735)' },
  { value: 10000, label: 'Mute List (10000)' },
  { value: 10001, label: 'Pin List (10001)' },
  { value: 10002, label: 'Relay List Metadata (10002)' },
  { value: 30000, label: 'Categorized People List (30000)' },
  { value: 30001, label: 'Categorized Bookmark List (30001)' },
  { value: 30023, label: 'Long-form Content (30023)' },
  { value: 30024, label: 'Draft Long-form Content (30024)' },
  { value: 30078, label: 'Application-specific Data (30078)' },
  { value: 32100, label: 'M3U Playlist (32100)' },
  { value: 34139, label: 'Playlist (34139)' },
  { value: 34235, label: 'Addressable Video (34235)' },
  { value: 34236, label: 'Addressable Short Video (34236)' },
  { value: 36787, label: 'Music Tracks (36787)' },
];

@Component({
  selector: 'app-new-feed-dialog',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatMenuModule,
    MatChipsModule,
    MatAutocompleteModule,
    MatCardModule,
    MatDividerModule,
    MatSlideToggleModule,
    ReactiveFormsModule,
    MatButtonToggleModule,
    CustomDialogComponent,
    MultiSelectDialogComponent,
  ],
  templateUrl: './new-feed-dialog.component.html',
  styleUrls: ['./new-feed-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewFeedDialogComponent {
  private fb = inject(FormBuilder);
  private feedService = inject(FeedService);
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private followingService = inject(FollowingService);
  private followset = inject(Followset);
  private dataService = inject(DataService);
  private encryption = inject(EncryptionService);
  private logger = inject(LoggerService);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private collectionSetsService = inject(CollectionSetsService);

  // Inputs
  icons = input<string[]>([]);
  feed = input<FeedConfig | undefined>(undefined);

  // Outputs
  closed = output<FeedConfig | null>();

  // Form controls
  feedForm = this.fb.group({
    label: ['', Validators.required],
    icon: ['dynamic_feed'],
    type: ['notes'],
    kinds: [[] as number[]],
    source: ['following'],
    relayConfig: ['account'],
    customRelays: [[] as string[]],
    searchQuery: [''],
    showReplies: [false],
    showReposts: [true],
  });

  // Signals and state
  isEditMode = signal(false);
  selectedFeedType = signal<string>('notes');
  selectedKinds = signal<number[]>([]); // Will be set by selectFeedType in constructor
  customRelays = signal<string[]>([]);
  selectedRelayConfig = signal<string>('account');
  showCustomRelays = computed(() => this.selectedRelayConfig() === 'custom');

  // Custom source signals
  selectedUsers = signal<NostrRecord[]>([]);
  selectedStarterPacks = signal<StarterPack[]>([]);
  availableStarterPacks = signal<StarterPack[]>([]);
  selectedFollowSets = signal<FollowSet[]>([]);
  availableFollowSets = signal<FollowSet[]>([]);

  // Interest set signals
  availableInterestHashtags = signal<string[]>([]);
  selectedInterestHashtags = signal<string[]>([]);
  showInterestSelectDialog = signal(false);

  // Multi-select dialog visibility signals
  showUserSelectDialog = signal(false);
  showStarterPackSelectDialog = signal(false);
  showFollowSetSelectDialog = signal(false);

  // Form controls for chips and autocomplete
  kindInputControl = new FormControl('');
  relayInputControl = new FormControl('');

  // Reactive signals for input values
  kindInputValue = signal('');

  // Chip separator keys
  readonly separatorKeysCodes = [ENTER, COMMA] as const;

  // Available options
  feedTypes = signal(this.feedService.getFeedTypes());
  nostrKinds = signal(NOSTR_KINDS);

  // Get following users
  followingUsers = computed(() => {
    const profiles = this.followingService.profiles();
    return this.followingService.toNostrRecords(profiles);
  });

  followingCount = computed(() => {
    return this.accountState.followingList().length;
  });

  // Filtered options for autocomplete (only for kinds now)
  filteredKinds = computed(() => {
    const input = this.kindInputValue().toLowerCase();
    const selected = this.selectedKinds();

    return this.nostrKinds().filter(kind => {
      const matchesInput =
        kind.label.toLowerCase().includes(input) || kind.value.toString().includes(input);
      const notSelected = !selected.includes(kind.value);
      return matchesInput && notSelected;
    });
  });

  // Computed properties for multi-select dialogs
  userSelectableItems = computed((): SelectableItem[] => {
    const users = this.followingUsers();
    const selectedPubkeys = this.selectedUsers().map(u => u.event.pubkey);

    return users.map(user => ({
      id: user.event.pubkey,
      title: user.data.display_name || user.data.name || 'Unknown',
      subtitle: user.data.nip05 || undefined,
      selected: selectedPubkeys.includes(user.event.pubkey)
    }));
  });

  starterPackSelectableItems = computed((): SelectableItem[] => {
    const packs = this.availableStarterPacks();
    const selectedIds = this.selectedStarterPacks().map(p => p.id);

    return packs.map(pack => ({
      id: pack.id,
      title: pack.title,
      subtitle: pack.description,
      count: pack.pubkeys.length,
      selected: selectedIds.includes(pack.id)
    }));
  });

  followSetSelectableItems = computed((): SelectableItem[] => {
    const sets = this.availableFollowSets();
    const selectedIds = this.selectedFollowSets().map(s => s.id);

    return sets.map(set => ({
      id: set.id,
      title: set.title,
      subtitle: set.description,
      count: set.pubkeys.length,
      selected: selectedIds.includes(set.id)
    }));
  });

  interestSelectableItems = computed((): SelectableItem[] => {
    const hashtags = this.availableInterestHashtags();
    const selectedHashtags = this.selectedInterestHashtags();

    return hashtags.map(hashtag => ({
      id: hashtag,
      title: `#${hashtag}`,
      subtitle: undefined,
      selected: selectedHashtags.includes(hashtag)
    }));
  });

  private initialized = false;

  constructor() {
    effect(() => {
      const feedData = this.feed();
      if (feedData && !this.initialized) {
        this.initialized = true;
        this.feedForm.patchValue({
          label: feedData.label || '',
          icon: feedData.icon || 'dynamic_feed',
          type: feedData.type || 'notes',
          kinds: feedData.kinds || [1],
          source: feedData.source || 'following',
          relayConfig: feedData.relayConfig || 'account',
          customRelays: feedData.customRelays || [],
          searchQuery: feedData.searchQuery || '',
          showReplies: feedData.showReplies || false,
          showReposts: feedData.showReposts ?? true,
        });
        this.isEditMode.set(true);
        this.selectedFeedType.set(feedData.type || 'notes');
        this.selectedKinds.set(feedData.kinds || [1]);
        this.customRelays.set(feedData.customRelays || []);
        this.selectedRelayConfig.set(feedData.relayConfig || 'account');
      }
    });

    // Set up reactive input value tracking (only for kinds now)
    this.kindInputControl.valueChanges.subscribe(value => {
      this.kindInputValue.set(value || '');
    });

    this.initializeData();

    // Initialize with default "notes" feed type kinds when not editing
    if (!this.feed()) {
      this.selectFeedType('notes');
    }
  }

  private async initializeData(): Promise<void> {
    await Promise.all([
      this.loadStarterPacks(),
      this.loadFollowSets(),
      this.loadInterestSet()
    ]);

    const feedData = this.feed();
    if (feedData) {
      this.initializeSelectedItems();
    }
  }

  selectFeedType(typeKey: string): void {
    this.selectedFeedType.set(typeKey);
    this.feedForm.patchValue({
      type: typeKey as 'photos' | 'videos' | 'notes' | 'articles' | 'music' | 'custom',
    });

    const validTypes = ['notes', 'articles', 'photos', 'videos', 'music', 'custom'] as const;
    if (validTypes.includes(typeKey as (typeof validTypes)[number])) {
      const feedType = this.feedService.getFeedType(typeKey as (typeof validTypes)[number]);
      if (feedType) {
        // Clear kinds for custom, otherwise use the feed type's default kinds
        if (typeKey === 'custom') {
          this.selectedKinds.set([]);
          this.feedForm.patchValue({ kinds: [] });
        } else if (feedType.kinds.length > 0) {
          this.selectedKinds.set(feedType.kinds);
          this.feedForm.patchValue({ kinds: feedType.kinds });
        }
      }
    }
  }

  getKindLabel(kind: number): string {
    const kindInfo = this.nostrKinds().find(k => k.value === kind);
    return kindInfo ? kindInfo.label : `Kind ${kind}`;
  }

  addKind(event: MatChipInputEvent): void {
    const value = event.value.trim();
    if (value) {
      const kindNumber = parseInt(value, 10);
      if (!isNaN(kindNumber) && !this.selectedKinds().includes(kindNumber)) {
        this.selectedKinds.update(kinds => [...kinds, kindNumber]);
        this.updateKindsForm();
      }
    }
    event.chipInput!.clear();
    this.kindInputControl.setValue('');
  }

  removeKind(kind: number): void {
    this.selectedKinds.update(kinds => kinds.filter(k => k !== kind));
    this.updateKindsForm();
  }

  kindSelected(event: MatAutocompleteSelectedEvent): void {
    const kindValue = event.option.value;
    if (!this.selectedKinds().includes(kindValue)) {
      this.selectedKinds.update(kinds => [...kinds, kindValue]);
      this.updateKindsForm();
    }
    this.kindInputControl.setValue('');
  }

  private updateKindsForm(): void {
    this.feedForm.patchValue({ kinds: this.selectedKinds() });
  }

  onRelayConfigChange(value: string): void {
    this.selectedRelayConfig.set(value);
    if (value !== 'custom') {
      this.customRelays.set([]);
      this.feedForm.patchValue({ customRelays: [] });
    }
  }

  addCustomRelay(event: MatChipInputEvent): void {
    let value = event.value.trim();
    if (value) {
      if (!value.startsWith('wss://') && !value.startsWith('ws://')) {
        value = 'wss://' + value;
      }

      if (this.isValidRelayUrl(value)) {
        if (!this.customRelays().includes(value)) {
          this.customRelays.update(relays => [...relays, value]);
          this.updateCustomRelaysForm();
        }
      }
    }
    event.chipInput!.clear();
    this.relayInputControl.setValue('');
  }

  removeCustomRelay(relay: string): void {
    this.customRelays.update(relays => relays.filter(r => r !== relay));
    this.updateCustomRelaysForm();
  }

  private updateCustomRelaysForm(): void {
    this.feedForm.patchValue({ customRelays: this.customRelays() });
  }

  private isValidRelayUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'wss:' || urlObj.protocol === 'ws:';
    } catch {
      return false;
    }
  }

  getActiveRelays(): string[] {
    const relayConfig = this.selectedRelayConfig();

    switch (relayConfig) {
      case 'account':
        return this.accountRelay.relays().map(r => r.url);
      case 'custom':
        return this.customRelays();
      default:
        return [];
    }
  }

  async loadStarterPacks(): Promise<void> {
    try {
      const starterPacks = await this.followset.fetchStarterPacks();
      this.availableStarterPacks.set(starterPacks);
    } catch (error) {
      console.error('Failed to load starter packs:', error);
    }
  }

  async loadFollowSets(): Promise<void> {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.warn('No pubkey available for loading follow sets');
        return;
      }

      const records = await this.dataService.getEventsByPubkeyAndKind(pubkey, 30000, {
        save: true,
        cache: true,
      });

      if (!records || records.length === 0) {
        this.logger.debug('No follow sets found');
        return;
      }

      const followSets: FollowSet[] = [];

      for (const record of records) {
        if (!record.event) continue;

        const event = record.event;
        const dTag = event.tags.find(t => t[0] === 'd')?.[1] || crypto.randomUUID();
        const title = event.tags.find(t => t[0] === 'title')?.[1] || event.tags.find(t => t[0] === 'name')?.[1] || `Follow Set ${dTag}`;
        const description = event.tags.find(t => t[0] === 'description')?.[1];

        const publicPubkeys = event.tags
          .filter(t => t[0] === 'p' && t[1])
          .map(t => t[1]);

        let privatePubkeys: string[] = [];
        if (event.content && event.content.trim() !== '') {
          try {
            const isEncrypted = this.encryption.isContentEncrypted(event.content);
            if (isEncrypted) {
              const decrypted = await this.encryption.autoDecrypt(event.content, pubkey, event);
              if (decrypted && decrypted.content) {
                const privateData = JSON.parse(decrypted.content);
                if (Array.isArray(privateData)) {
                  privatePubkeys = privateData
                    .filter((tag: string[]) => tag[0] === 'p' && tag[1])
                    .map((tag: string[]) => tag[1]);
                }
              }
            }
          } catch (error) {
            this.logger.error('Failed to decrypt follow set content:', error);
          }
        }

        const allPubkeys = [...new Set([...publicPubkeys, ...privatePubkeys])];

        followSets.push({
          id: event.id,
          dTag,
          title,
          description,
          pubkeys: allPubkeys,
          created: event.created_at,
        });
      }

      followSets.sort((a, b) => b.created - a.created);
      this.availableFollowSets.set(followSets);
      this.logger.debug(`Loaded ${followSets.length} follow sets`);
    } catch (error) {
      this.logger.error('Failed to load follow sets:', error);
    }
  }

  async loadInterestSet(): Promise<void> {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.warn('No pubkey available for loading interest set');
        return;
      }

      const interestSet = await this.collectionSetsService.getInterestSet(pubkey);
      if (interestSet && interestSet.hashtags.length > 0) {
        this.availableInterestHashtags.set(interestSet.hashtags);
        this.logger.debug(`Loaded ${interestSet.hashtags.length} interest hashtags`);
      } else {
        // Use default hashtags if none exist
        this.availableInterestHashtags.set(this.collectionSetsService.getDefaultHashtags());
        this.logger.debug('Using default hashtags for interest set');
      }
    } catch (error) {
      this.logger.error('Failed to load interest set:', error);
      // Fallback to defaults on error
      this.availableInterestHashtags.set(this.collectionSetsService.getDefaultHashtags());
    }
  }

  initializeSelectedItems(): void {
    const feedData = this.feed();
    if (!feedData) return;

    if (feedData.customUsers && feedData.customUsers.length > 0) {
      const profiles: NostrRecord[] = [];
      for (const pubkey of feedData.customUsers) {
        const cacheKey = `metadata-${pubkey}`;
        const profile = this.accountState['cache'].get<NostrRecord>(cacheKey);
        if (profile) {
          profiles.push(profile);
        }
      }
      this.selectedUsers.set(profiles);
    }

    if (feedData.customStarterPacks && feedData.customStarterPacks.length > 0) {
      const packs = this.availableStarterPacks().filter(pack =>
        feedData.customStarterPacks!.includes(pack.dTag)
      );
      this.selectedStarterPacks.set(packs);
    }

    if (feedData.customFollowSets && feedData.customFollowSets.length > 0) {
      const sets = this.availableFollowSets().filter(set =>
        feedData.customFollowSets!.includes(set.dTag)
      );
      this.selectedFollowSets.set(sets);
    }

    // Initialize selected interest hashtags for interests source
    if (feedData.customInterestHashtags && feedData.customInterestHashtags.length > 0) {
      this.selectedInterestHashtags.set(feedData.customInterestHashtags);
    }
  }

  // Methods to open multi-select dialogs
  openUserSelectDialog(): void {
    this.showUserSelectDialog.set(true);
  }

  openStarterPackSelectDialog(): void {
    this.showStarterPackSelectDialog.set(true);
  }

  openFollowSetSelectDialog(): void {
    this.showFollowSetSelectDialog.set(true);
  }

  openInterestSelectDialog(): void {
    this.showInterestSelectDialog.set(true);
  }

  // Methods to handle dialog results
  onUserSelectionConfirmed(selectedItems: SelectableItem[] | null): void {
    this.showUserSelectDialog.set(false);

    if (selectedItems === null) {
      return; // User cancelled
    }

    const users = this.followingUsers();
    const selected = selectedItems
      .map(item => users.find(u => u.event.pubkey === item.id))
      .filter((u): u is NostrRecord => u !== undefined);

    this.selectedUsers.set(selected);
  }

  onStarterPackSelectionConfirmed(selectedItems: SelectableItem[] | null): void {
    this.showStarterPackSelectDialog.set(false);

    if (selectedItems === null) {
      return; // User cancelled
    }

    const packs = this.availableStarterPacks();
    const selected = selectedItems
      .map(item => packs.find(p => p.id === item.id))
      .filter((p): p is StarterPack => p !== undefined);

    this.selectedStarterPacks.set(selected);
  }

  onFollowSetSelectionConfirmed(selectedItems: SelectableItem[] | null): void {
    this.showFollowSetSelectDialog.set(false);

    if (selectedItems === null) {
      return; // User cancelled
    }

    const sets = this.availableFollowSets();
    const selected = selectedItems
      .map(item => sets.find(s => s.id === item.id))
      .filter((s): s is FollowSet => s !== undefined);

    this.selectedFollowSets.set(selected);
  }

  onInterestSelectionConfirmed(selectedItems: SelectableItem[] | null): void {
    this.showInterestSelectDialog.set(false);

    if (selectedItems === null) {
      return; // User cancelled
    }

    // Extract hashtag IDs from selected items
    const selected = selectedItems.map(item => item.id);
    this.selectedInterestHashtags.set(selected);
  }

  removeUser(user: NostrRecord): void {
    this.selectedUsers.update(users => users.filter(u => u.event.pubkey !== user.event.pubkey));
  }

  removeStarterPack(pack: StarterPack): void {
    this.selectedStarterPacks.update(packs => packs.filter(p => p.id !== pack.id));
  }

  removeFollowSet(followSet: FollowSet): void {
    this.selectedFollowSets.update(sets => sets.filter(s => s.id !== followSet.id));
  }

  removeInterestHashtag(hashtag: string): void {
    this.selectedInterestHashtags.update(hashtags => hashtags.filter(h => h !== hashtag));
  }

  // Handlers for starter pack actions
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStarterPackEdit(_item: SelectableItem): void {
    // Navigate to lists page for editing the starter pack
    this.router.navigate(['/lists']);
    // Close the dialog
    this.closed.emit(null);
  }

  async onStarterPackDelete(item: SelectableItem): Promise<void> {
    const pack = this.availableStarterPacks().find(p => p.id === item.id);
    if (!pack) return;

    // TODO: Implement deletion - need to create deletion event (NIP-09)
    // For now, just log
    this.logger.info('Delete starter pack:', pack);

    // Remove from available and selected
    this.availableStarterPacks.update(packs => packs.filter(p => p.id !== item.id));
    this.selectedStarterPacks.update(packs => packs.filter(p => p.id !== item.id));
  }

  // Handlers for follow set actions
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onFollowSetEdit(_item: SelectableItem): void {
    // Navigate to lists page for editing the follow set
    this.router.navigate(['/lists']);
    // Close the dialog
    this.closed.emit(null);
  }

  async onFollowSetDelete(item: SelectableItem): Promise<void> {
    const set = this.availableFollowSets().find(s => s.id === item.id);
    if (!set) return;

    // TODO: Implement deletion - need to create deletion event (NIP-09)
    // For now, just log
    this.logger.info('Delete follow set:', set);

    // Remove from available and selected
    this.availableFollowSets.update(sets => sets.filter(s => s.id !== item.id));
    this.selectedFollowSets.update(sets => sets.filter(s => s.id !== item.id));
  }

  onClose(): void {
    this.closed.emit(null);
  }

  onSubmit(): void {
    if (this.feedForm.valid) {
      const formValue = this.feedForm.value;
      const existingFeed = this.feed();

      let relayConfig = formValue.relayConfig as 'account' | 'custom' | 'search';
      if (formValue.source === 'search') {
        relayConfig = 'search';
      }

      const feedData: FeedConfig = {
        id: existingFeed?.id || crypto.randomUUID(),
        label: formValue.label!,
        icon: formValue.icon!,
        type: formValue.type as 'photos' | 'videos' | 'notes' | 'articles' | 'music' | 'custom',
        kinds: this.selectedKinds(),
        source: (formValue.source || 'following') as 'following' | 'public' | 'custom' | 'for-you' | 'search' | 'trending' | 'interests',
        relayConfig: relayConfig,
        customRelays: formValue.relayConfig === 'custom' ? this.customRelays() : undefined,
        customUsers: formValue.source === 'custom' ? this.selectedUsers().map(u => u.event.pubkey) : undefined,
        customStarterPacks: formValue.source === 'custom' ? this.selectedStarterPacks().map(p => p.dTag) : undefined,
        customFollowSets: formValue.source === 'custom' ? this.selectedFollowSets().map(s => s.dTag) : undefined,
        customInterestHashtags: formValue.source === 'interests' ? this.selectedInterestHashtags() : undefined,
        searchQuery: formValue.source === 'search' ? (formValue.searchQuery || '').trim() : undefined,
        showReplies: formValue.showReplies || false,
        showReposts: formValue.showReposts ?? true,
        filters: {},
        createdAt: existingFeed?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      this.closed.emit(feedData);
    }
  }
}
